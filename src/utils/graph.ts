import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'

import {
  getEnrichedVaultCollection,
  getVaultFolderDisplayPathFromEntryId,
  prod
} from '@/utils/vault'
import type { EnrichedVaultEntry } from '@/utils/vault'
import { createVaultLinkIndex } from '@/utils/vault-link-index'
import type { VaultLinkIndex } from '@/utils/vault-link-index'
import remarkWikiLink from '@/plugins/remark-wiki-link.js'

const EXTERNAL = /^(?:[a-z][a-z\d+.-]*:|#)/i
const EDGE_SEPARATOR = '\u0000'

export interface GraphNode {
  id: string
  name: string
  /** Top-level folder key, used for colour grouping. */
  group: string
  /** Human-readable folder name for legends. */
  folderName: string
  tags: string[]
  /** Number of unique connected notes, in either direction. */
  degree: number
  isolated: boolean
  /** Incoming-link weight kept for the backlinks relevance sort. */
  val: number
}

export interface GraphLink {
  source: string
  target: string
}

export interface GraphGroup {
  key: string
  name: string
  count: number
}

export interface GraphStats {
  notes: number
  links: number
  isolated: number
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
  backlinksMap: Record<string, string[]>
  linksMap: Record<string, string[]>
  groups: GraphGroup[]
  stats: GraphStats
}

// Cache the built graph in production. Dev should reflect content edits.
let cachedGraphData: GraphData | null = null
let vaultIndex: VaultLinkIndex | null = null

function getVaultIndex(): VaultLinkIndex {
  if (!vaultIndex) vaultIndex = createVaultLinkIndex()
  return vaultIndex
}

function resolveLink(source: string, target: string): string | undefined {
  try {
    const resolution = getVaultIndex().resolve({ source, target, kind: 'note' })
    return resolution.url.replace(/^\/vault\//, '')
  } catch {
    return undefined
  }
}

function getTopLevelFolder(entryId: string, slug: string): { key: string; name: string } {
  const parts = slug.split('/')
  if (parts.length < 2) return { key: 'root', name: 'Root notes' }

  const key = parts[0] || 'root'
  const displayPath = getVaultFolderDisplayPathFromEntryId(entryId)
  const name = displayPath.split(' / ')[0]?.trim() || key.replace(/-/g, ' ')

  return { key, name }
}

function edgeKey(source: string, target: string): { key: string; source: string; target: string } {
  return source < target
    ? { key: `${source}${EDGE_SEPARATOR}${target}`, source, target }
    : { key: `${target}${EDGE_SEPARATOR}${source}`, source: target, target: source }
}

export async function getVaultGraphData(): Promise<GraphData> {
  if (prod && cachedGraphData) return cachedGraphData

  const entries = await getEnrichedVaultCollection()
  const nodeById = new Map<string, GraphNode>()
  const groupMap = new Map<string, GraphGroup>()
  const uniqueEntries: EnrichedVaultEntry[] = []

  for (const entry of entries) {
    if (nodeById.has(entry.slug)) {
      if (!prod) {
        console.warn(`[vault-graph] Duplicate slug "${entry.slug}" skipped (${entry.id})`)
      }
      continue
    }

    const folder = getTopLevelFolder(entry.id, entry.slug)
    const node: GraphNode = {
      id: entry.slug,
      name: entry.data.title || entry.slug,
      group: folder.key,
      folderName: folder.name,
      tags: entry.data.tags ?? [],
      degree: 0,
      isolated: true,
      val: 2
    }

    nodeById.set(entry.slug, node)
    uniqueEntries.push(entry)

    const group = groupMap.get(folder.key) ?? { key: folder.key, name: folder.name, count: 0 }
    group.count += 1
    groupMap.set(folder.key, group)
  }

  const nodeIds = new Set(nodeById.keys())
  const edgeMap = new Map<string, GraphLink>()
  const neighbors = new Map<string, Set<string>>()
  const backlinksMap: Record<string, Set<string>> = {}
  const linksMap: Record<string, Set<string>> = {}
  const unresolved = new Set<string>()

  const addLink = (source: string, target: string) => {
    if (source === target) return
    if (!nodeIds.has(source) || !nodeIds.has(target)) return

    if (!linksMap[source]) linksMap[source] = new Set()
    if (!backlinksMap[target]) backlinksMap[target] = new Set()
    linksMap[source].add(target)
    backlinksMap[target].add(source)

    const edge = edgeKey(source, target)
    if (!edgeMap.has(edge.key)) {
      edgeMap.set(edge.key, { source: edge.source, target: edge.target })
    }

    if (!neighbors.has(source)) neighbors.set(source, new Set())
    if (!neighbors.has(target)) neighbors.set(target, new Set())
    neighbors.get(source)?.add(target)
    neighbors.get(target)?.add(source)
  }

  const parser = unified()
    .use(remarkParse)
    // @ts-ignore - remarkWikiLink uses `this: Processor` which conflicts with unified's Plugin type
    .use(remarkWikiLink, {
      format: 'shortestPossible',
      files: getVaultIndex().files,
      permalinks: getVaultIndex().permalinks,
      className: 'internal',
      newClassName: 'new'
    })

  for (const entry of uniqueEntries) {
    if (!entry.body) continue

    const tree = parser.parse(entry.body)

    visit(tree, (node: any) => {
      let target: string | undefined
      let isEmbed = false

      if (node.type === 'link') {
        if (!node.url || EXTERNAL.test(node.url)) return
        target = String(node.url).split('#')[0].split('?')[0]
      } else if (node.type === 'wikiLink' || node.type === 'embed') {
        const inner = String(node.value ?? '')
        target = inner.split('|')[0].split('#')[0].trim()
        isEmbed = node.type === 'embed'
      } else {
        return
      }

      if (!target) return

      const resolved = resolveLink(entry.id, target)
      if (resolved) {
        addLink(entry.slug, resolved)
      } else if (!isEmbed) {
        unresolved.add(`${entry.slug} → ${target}`)
      }
    })
  }

  const finalLinksMap: Record<string, string[]> = {}
  const finalBacklinksMap: Record<string, string[]> = {}

  for (const key in linksMap) finalLinksMap[key] = Array.from(linksMap[key])
  for (const key in backlinksMap) finalBacklinksMap[key] = Array.from(backlinksMap[key])

  const nodes = Array.from(nodeById.values()).sort((a, b) => a.id.localeCompare(b.id))
  for (const node of nodes) {
    node.degree = neighbors.get(node.id)?.size ?? 0
    node.isolated = node.degree === 0
    node.val = 2 + (finalBacklinksMap[node.id]?.length ?? 0) * 0.5
  }

  const links = Array.from(edgeMap.values()).sort(
    (a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target)
  )
  const groups = Array.from(groupMap.values()).sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name)
  )
  const stats: GraphStats = {
    notes: nodes.length,
    links: links.length,
    isolated: nodes.filter((node) => node.isolated).length
  }

  if (unresolved.size && !prod) {
    console.warn(
      `[vault-graph] ${unresolved.size} unresolved link(s) skipped`,
      Array.from(unresolved).slice(0, 10)
    )
  }

  const graphData: GraphData = {
    nodes,
    links,
    backlinksMap: finalBacklinksMap,
    linksMap: finalLinksMap,
    groups,
    stats
  }

  if (prod) cachedGraphData = graphData
  return graphData
}
