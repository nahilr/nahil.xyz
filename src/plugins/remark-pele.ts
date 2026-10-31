import type { Root } from 'mdast'
import type { Plugin } from 'unified'
import { visit } from 'unist-util-visit'
import type { VaultLinkIndex } from '@/utils/vault-link-index'

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }
    return entities[character]
  })

const getSourcePath = (filePath: string | undefined) => {
  const marker = '/src/content/vault/'
  const normalized = filePath?.replace(/\\/g, '/') ?? ''
  const index = normalized.indexOf(marker)
  return index === -1 ? '' : normalized.slice(index + marker.length)
}

const remarkPele = (vaultIndex: VaultLinkIndex): Plugin<[], Root> => () => (tree, file) => {
  const source = getSourcePath(file?.path)
  visit(tree, 'code', (node, index, parent) => {
    if (node.lang !== 'mermaid' || !parent || typeof index !== 'number') return

    const vaultLinks: Record<string, string> = {}
    const linkPattern = /^\s*click\s+\S+\s+(?:href\s+)?["']([^"']+)["']/gim
    for (const match of node.value.matchAll(linkPattern)) {
      const target = match[1]
      if (!target) continue
      const resolved = vaultIndex.resolveNoteReference(source, target)
      if (resolved) vaultLinks[target] = resolved.url
    }

    parent.children[index] = {
      type: 'html',
      value: `<pre class="pele-diagram" data-vault-links="${escapeHtml(JSON.stringify(vaultLinks))}">${escapeHtml(node.value)}</pre>`
    }
  })
}

export default remarkPele
