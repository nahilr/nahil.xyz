import type { GraphData, GraphNode } from '@/utils/graph'
import { getFolderHue } from '@/utils/graph-palette'

type ForceGraphFactory = () => (element: HTMLElement) => any

interface RenderLink {
  source: string | RenderNode
  target: string | RenderNode
}

interface Palette {
  dark: boolean
  primary: string
  foreground: string
  background: string
  isolated: string
  mutedRaw: string
}

interface LabelRect {
  left: number
  right: number
  top: number
  bottom: number
}

interface RenderNode extends GraphNode {
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number
  fy?: number
  __startX?: number
  __startY?: number
  __finalX?: number
  __finalY?: number
  __delay?: number
  __progress?: number
}

export interface VaultGraphOptions {
  mode: 'local' | 'global'
  activeSlug?: string
  isolatedRing?: boolean
}

export interface VaultGraphHandle {
  fit(): void
  resize(): void
  zoomIn(): void
  zoomOut(): void
  destroy(): void
}

let forceGraphPromise: Promise<ForceGraphFactory> | null = null

function loadForceGraph(): Promise<ForceGraphFactory> {
  if (!forceGraphPromise) {
    forceGraphPromise = import('force-graph')
      .then((module) => {
        const candidate = (module as { default?: unknown }).default ?? module
        return candidate as unknown as ForceGraphFactory
      })
      .catch((error) => {
        forceGraphPromise = null
        throw error
      })
  }
  return forceGraphPromise
}

/** Start downloading/parsing the graph engine without creating a graph. */
export function preloadVaultGraph(): Promise<void> {
  return loadForceGraph().then(
    () => undefined,
    () => undefined
  )
}

function readPalette(): Palette {
  const style = getComputedStyle(document.documentElement)
  const dark = document.documentElement.classList.contains('dark')
  const value = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  const color = (name: string, alpha: number, fallback = '150 5% 50%') =>
    `hsl(${value(name, fallback)} / ${alpha})`

  return {
    dark,
    primary: color('--primary', 1, dark ? '195 95% 85%' : '200 29% 45%'),
    foreground: color('--foreground', 0.92, dark ? '0 0% 98%' : '240 10% 3.9%'),
    background: color('--background', 0.82, dark ? '240 20.54% 5.2%' : '210 33% 99%'),
    isolated: color('--muted-foreground', 0.55),
    mutedRaw: value('--muted-foreground', '240 5% 50%')
  }
}

function groupColor(group: string, palette: Palette): string {
  const hue = getFolderHue(group)
  return palette.dark ? `hsl(${hue} 38% 68%)` : `hsl(${hue} 32% 40%)`
}

function radiusOf(node: GraphNode): number {
  if (node.isolated) return 3.2
  return Math.min(10, 3.2 + 1.7 * Math.log1p(Math.max(0, node.degree)))
}

function buildColors(nodes: RenderNode[], palette: Palette): Map<string, string> {
  const colors = new Map<string, string>()
  for (const node of nodes) {
    colors.set(node.id, node.isolated ? palette.isolated : groupColor(node.group, palette))
  }
  return colors
}

function isTransparent(color: string): boolean {
  if (!color || color === 'transparent') return true
  const match = color.match(/^rgba?\(([^)]+)\)$/)
  if (!match) return false
  const parts = match[1].split(',').map((part) => part.trim())
  return parts.length === 4 && Number(parts[3]) === 0
}

function readSurface(element: HTMLElement, fallback: string): string {
  let current: HTMLElement | null = element
  while (current) {
    const background = getComputedStyle(current).backgroundColor
    if (!isTransparent(background)) return background
    current = current.parentElement
  }
  return fallback
}

type RingItem = RenderNode[]

function getRingItems(
  nodes: RenderNode[],
  links: RenderLink[],
  nodeById: Map<string, RenderNode>
): RingItem[] {
  if (nodes.length === 0) return []

  const adjacency = new Map<string, Set<string>>()
  for (const node of nodes) adjacency.set(node.id, new Set())

  for (const link of links) {
    const source = idOf(link.source)
    const target = idOf(link.target)
    adjacency.get(source)?.add(target)
    adjacency.get(target)?.add(source)
  }

  const visited = new Set<string>()
  const components: RingItem[] = []

  for (const node of nodes) {
    if (visited.has(node.id)) continue

    const stack = [node.id]
    const component: RenderNode[] = []
    visited.add(node.id)

    while (stack.length > 0) {
      const current = stack.pop() as string
      const currentNode = nodeById.get(current)
      if (currentNode) component.push(currentNode)

      for (const next of adjacency.get(current) ?? []) {
        if (visited.has(next)) continue
        visited.add(next)
        stack.push(next)
      }
    }

    components.push(component)
  }

  components.sort((a, b) => b.length - a.length)

  // A graph without a meaningful core puts every note on the ring.
  if (components[0]?.length <= 1) return components

  return components.slice(1).sort((a, b) => (a[0]?.id ?? '').localeCompare(b[0]?.id ?? ''))
}

function placeRingItems(items: RingItem[], centerX: number, centerY: number, radius: number) {
  if (items.length === 0) return

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    const angle = (index / items.length) * Math.PI * 2 - Math.PI / 2
    const anchorX = centerX + Math.cos(angle) * radius
    const anchorY = centerY + Math.sin(angle) * radius

    if (item.length === 1) {
      const node = item[0]
      node.x = anchorX
      node.y = anchorY
      node.fx = anchorX
      node.fy = anchorY
      continue
    }

    const clusterRadius = Math.min(34, 10 + item.length * 4)
    for (let nodeIndex = 0; nodeIndex < item.length; nodeIndex += 1) {
      const node = item[nodeIndex]
      const nodeAngle = (nodeIndex / item.length) * Math.PI * 2 - Math.PI / 2
      node.x = anchorX + Math.cos(nodeAngle) * clusterRadius
      node.y = anchorY + Math.sin(nodeAngle) * clusterRadius
      node.fx = node.x
      node.fy = node.y
    }
  }
}

function idOf(value: string | RenderNode): string {
  return typeof value === 'string' ? value : value.id
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}

export async function createVaultGraph(
  container: HTMLElement,
  data: Pick<GraphData, 'nodes' | 'links'>,
  options: VaultGraphOptions
): Promise<VaultGraphHandle> {
  const factory = await loadForceGraph()
  if (!container.isConnected) throw new Error('Graph container is no longer in the document')

  const parent = container.parentElement
  if (!parent) throw new Error('Graph container has no wrapper')
  const wrapper: HTMLElement = parent

  let palette = readPalette()
  const renderNodes: RenderNode[] = data.nodes.map((node) => ({ ...node }))
  const renderLinks: RenderLink[] = data.links.map((link) => ({
    source: link.source,
    target: link.target
  }))
  const nodeCount = renderNodes.length
  const activeSlug = options.activeSlug
  const showRing = options.mode === 'global' && Boolean(options.isolatedRing)
  const nodeMap = new Map(renderNodes.map((node) => [node.id, node]))
  const ringItems = showRing ? getRingItems(renderNodes, renderLinks, nodeMap) : []
  const ringIds = new Set(ringItems.flat().map((node) => node.id))
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  let colors = buildColors(renderNodes, palette)
  let surface = readSurface(wrapper, palette.background)
  let hoverNodeId: string | null = null
  let ring: { x: number; y: number; radius: number } | null = null
  let formationProgress = 1
  let formationActive = false
  let formationFrame = 0
  let destroyed = false
  let hasFitAfterStop = false
  let resizeFrame = 0
  let lastWidth = 0
  let lastHeight = 0

  if (ringItems.length > 0) {
    const coreCount = Math.max(nodeCount - ringIds.size, 1)
    const ringRadius = Math.max(240, Math.sqrt(coreCount) * 52)
    placeRingItems(ringItems, 0, 0, ringRadius)
    ring = { x: 0, y: 0, radius: ringRadius }
  }

  const graph = factory()(container)

  function isConnectedLink(link: RenderLink): boolean {
    if (!hoverNodeId) return false
    const source = idOf(link.source)
    const target = idOf(link.target)
    return source === hoverNodeId || target === hoverNodeId
  }

  function makeLinkColor() {
    const fade = 0.2 + 0.8 * formationProgress
    return (link: RenderLink) =>
      `hsl(${palette.mutedRaw} / ${(isConnectedLink(link) ? 0.55 : 0.22) * fade})`
  }

  function makeLinkWidth() {
    return (link: RenderLink) => (isConnectedLink(link) ? 1.6 : 1)
  }

  function drawNode(node: RenderNode, context: CanvasRenderingContext2D, globalScale: number) {
    const x = node.x ?? 0
    const y = node.y ?? 0
    const progress = node.__progress ?? 1
    const radius = radiusOf(node) * (0.25 + 0.75 * progress)
    const alpha = Math.min(1, progress * 1.15)

    context.globalAlpha = alpha

    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.fillStyle =
      node.id === activeSlug ? palette.primary : (colors.get(node.id) ?? palette.isolated)
    context.fill()

    if (node.id === activeSlug || node.id === hoverNodeId) {
      const scale = Number.isFinite(globalScale) && globalScale > 0 ? globalScale : 1
      context.beginPath()
      context.arc(x, y, radius + 1.5 / scale, 0, Math.PI * 2)
      context.strokeStyle = node.id === activeSlug ? palette.foreground : palette.primary
      context.lineWidth = 2 / scale
      context.stroke()
    }

    context.globalAlpha = 1
  }

  function shouldShowLabel(node: RenderNode, globalScale: number): boolean {
    if (node.id === activeSlug || node.id === hoverNodeId) return true
    if (options.mode === 'global') return globalScale >= 1.35
    return nodeCount <= 12 || globalScale >= 1.5
  }

  function labelPriority(node: RenderNode): number {
    if (node.id === activeSlug) return 1000
    if (node.id === hoverNodeId) return 500
    return node.degree
  }

  function drawRing(context: CanvasRenderingContext2D, globalScale: number) {
    if (!ring || !Number.isFinite(globalScale) || globalScale <= 0) return

    const fade = Math.max(0, Math.min(1, (formationProgress - 0.45) / 0.55))
    if (fade <= 0) return

    context.save()
    context.globalAlpha = fade
    context.beginPath()
    context.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2)
    context.strokeStyle = `hsl(${palette.mutedRaw} / 0.22)`
    context.lineWidth = 1 / globalScale
    context.setLineDash([4 / globalScale, 8 / globalScale])
    context.stroke()
    context.restore()
  }

  function drawLabels(context: CanvasRenderingContext2D, globalScale: number) {
    if (formationProgress < 0.85) return
    if (!Number.isFinite(globalScale) || globalScale <= 0) return

    const fontSize = 11 / globalScale
    const lineHeight = fontSize + 2 / globalScale
    const labels = renderNodes
      .filter((node) => shouldShowLabel(node, globalScale))
      .sort((a, b) => labelPriority(b) - labelPriority(a))
    const occupied: LabelRect[] = []

    for (const node of labels) {
      const x = node.x
      const y = node.y
      if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) continue

      const text = truncate(node.name, 28)
      context.font = `${node.id === activeSlug ? 600 : 500} ${fontSize}px "Satoshi", sans-serif`
      const width = context.measureText(text).width
      const left = x - width / 2
      const right = x + width / 2
      const top = y + radiusOf(node) + 3 / globalScale
      const bottom = top + lineHeight
      const collides = occupied.some(
        (rect) => left < rect.right && right > rect.left && top < rect.bottom && bottom > rect.top
      )

      if (collides && node.id !== activeSlug && node.id !== hoverNodeId) continue
      occupied.push({ left, right, top, bottom })

      context.textAlign = 'center'
      context.textBaseline = 'top'
      context.lineWidth = 3 / globalScale
      context.strokeStyle = surface
      context.strokeText(text, x, top)
      context.fillStyle = palette.foreground
      context.fillText(text, x, top)
    }
  }

  function fitGraph(): boolean {
    if (formationActive) return false
    if (renderNodes.length === 0) return false

    if (renderNodes.length === 1) {
      const node = renderNodes[0]
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return false
      graph.centerAt(node.x ?? 0, node.y ?? 0, 0)
      graph.zoom(2.4, 0)
      return true
    }

    const bbox = graph.getGraphBbox?.()
    if (
      !bbox ||
      !Number.isFinite(bbox.x[0]) ||
      !Number.isFinite(bbox.x[1]) ||
      !Number.isFinite(bbox.y[0]) ||
      !Number.isFinite(bbox.y[1])
    ) {
      return false
    }

    graph.zoomToFit(0, options.mode === 'global' ? 40 : 22)
    return true
  }

  function fitWhenReady(attempt = 0) {
    if (fitGraph() || attempt >= 60) return
    requestAnimationFrame(() => fitWhenReady(attempt + 1))
  }

  function getFormationCenter(): { x: number; y: number } {
    if (ring) return { x: ring.x, y: ring.y }

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity

    for (const node of renderNodes) {
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue
      const x = node.x as number
      const y = node.y as number
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return { x: 0, y: 0 }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
  }

  function beginFormation() {
    if (reduceMotion) {
      formationProgress = 1
      for (const node of renderNodes) node.__progress = 1
      return
    }

    const center = getFormationCenter()
    const duration = options.mode === 'global' ? 480 : 380
    const stagger = options.mode === 'global' ? 100 : 70
    const total = duration + stagger

    for (let index = 0; index < renderNodes.length; index += 1) {
      const node = renderNodes[index]
      node.__finalX = node.x ?? center.x
      node.__finalY = node.y ?? center.y

      const angle = index * 2.399963229728653
      const startRadius = 6 + (index % 24) * 1.4
      node.__startX = center.x + Math.cos(angle) * startRadius
      node.__startY = center.y + Math.sin(angle) * startRadius
      node.__delay = ((index % 10) / 10) * stagger
      node.__progress = 0
      node.x = node.__startX
      node.y = node.__startY
    }

    formationProgress = 0
    formationActive = true
    graph.enableNodeDrag(false)

    const startedAt = performance.now()
    const step = (now: number) => {
      if (destroyed) return
      const elapsed = now - startedAt
      const overall = Math.min(1, elapsed / total)

      for (const node of renderNodes) {
        const local = Math.min(1, Math.max(0, (elapsed - (node.__delay ?? 0)) / duration))
        const eased = 1 - Math.pow(1 - local, 3)
        const startX = node.__startX ?? center.x
        const startY = node.__startY ?? center.y
        const finalX = node.__finalX ?? center.x
        const finalY = node.__finalY ?? center.y

        node.__progress = eased
        node.x = startX + (finalX - startX) * eased
        node.y = startY + (finalY - startY) * eased

        if (ringIds.has(node.id)) {
          node.fx = node.x
          node.fy = node.y
        }
      }

      formationProgress = overall
      graph.linkColor(makeLinkColor())
      const currentZoom = Number(graph.zoom())
      if (Number.isFinite(currentZoom)) graph.zoom(currentZoom, 0)

      if (elapsed < total) {
        formationFrame = requestAnimationFrame(step)
        return
      }

      for (const node of renderNodes) {
        node.__progress = 1
        node.x = node.__finalX ?? center.x
        node.y = node.__finalY ?? center.y
      }
      formationProgress = 1
      formationActive = false
      graph.enableNodeDrag(true)
      graph.linkColor(makeLinkColor())
      if (Number.isFinite(currentZoom)) graph.zoom(currentZoom, 0)
    }

    formationFrame = requestAnimationFrame(step)
  }

  function beginFormationWhenReady(attempt = 0) {
    if (fitGraph()) {
      beginFormation()
      return
    }
    if (attempt < 30) {
      requestAnimationFrame(() => beginFormationWhenReady(attempt + 1))
      return
    }
    beginFormation()
    fitWhenReady()
  }

  function resize() {
    const nextWidth = wrapper.clientWidth
    const nextHeight = wrapper.clientHeight
    if (!nextWidth || !nextHeight || (nextWidth === lastWidth && nextHeight === lastHeight)) return

    lastWidth = nextWidth
    lastHeight = nextHeight
    graph.width(nextWidth).height(nextHeight)

    if (resizeFrame) cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0
      fitWhenReady()
    })
  }

  graph
    .width(wrapper.clientWidth || 320)
    .height(wrapper.clientHeight || 220)
    .nodeId('id')
    .nodeLabel('')
    .nodeRelSize(1)
    .nodeVal((node: RenderNode) => radiusOf(node) ** 2)
    .nodeCanvasObject(drawNode)
    .linkColor(makeLinkColor())
    .linkWidth(makeLinkWidth())
    .linkDirectionalArrowLength(0)
    .onNodeHover((node: RenderNode | null) => {
      const next = node?.id ?? null
      if (next === hoverNodeId) return
      hoverNodeId = next
      graph.linkColor(makeLinkColor()).linkWidth(makeLinkWidth())
    })
    .onNodeClick((node: RenderNode, event: MouseEvent) => {
      const url = `/vault/${node.id}`
      if (event.metaKey || event.ctrlKey || event.shiftKey) {
        window.open(url, '_blank', 'noopener,noreferrer')
        return
      }
      window.location.href = url
    })
    .onNodeDrag(() => {
      // Keep the simulation alive while a node is being moved so neighbours
      // can settle around it without animating on first paint.
      graph.cooldownTicks(80)
    })
    .onRenderFramePre(drawRing)
    .onRenderFramePost(drawLabels)
    .onEngineStop(() => {
      graph.cooldownTicks(0)
      if (hasFitAfterStop) return
      hasFitAfterStop = true
      fitWhenReady()
    })
    .d3VelocityDecay(0.35)
    .warmupTicks(reduceMotion ? 200 : options.mode === 'global' ? 160 : 120)
    .cooldownTicks(0)
    .cooldownTime(4000)

  const charge = graph.d3Force('charge')
  charge?.strength((node: RenderNode) =>
    ringIds.has(node.id) ? 0 : options.mode === 'global' ? -110 : -90
  )
  charge?.distanceMax(options.mode === 'global' ? 600 : 240)

  const linkForce = graph.d3Force('link')
  linkForce?.distance(options.mode === 'global' ? 48 : 36)

  const center = graph.d3Force('center')
  center?.strength(options.mode === 'global' ? 0.06 : 0.3)

  graph.graphData({ nodes: renderNodes, links: renderLinks })
  lastWidth = wrapper.clientWidth
  lastHeight = wrapper.clientHeight

  hasFitAfterStop = true
  if (!reduceMotion) {
    formationProgress = 0
    for (const node of renderNodes) node.__progress = 0
  }

  const finalizeLayout = (attempt = 0) => {
    const positioned =
      renderNodes.length === 1
        ? Number.isFinite(renderNodes[0].x) && Number.isFinite(renderNodes[0].y)
        : renderNodes.some(
            (node) =>
              !ringIds.has(node.id) &&
              Number.isFinite(node.x) &&
              Number.isFinite(node.y) &&
              (Math.abs(node.x as number) > 0.01 || Math.abs(node.y as number) > 0.01)
          )

    if (!positioned && attempt < 20) {
      requestAnimationFrame(() => finalizeLayout(attempt + 1))
      return
    }

    // Pin detached notes outside the connected core, using the layout that
    // the force warm-up produced so the ring does not cut through the graph.
    if (ringItems.length > 0 && ringIds.size < renderNodes.length) {
      const connected = renderNodes.filter(
        (node) => !ringIds.has(node.id) && Number.isFinite(node.x) && Number.isFinite(node.y)
      )

      if (connected.length > 0) {
        let minX = Infinity
        let maxX = -Infinity
        let minY = Infinity
        let maxY = -Infinity

        for (const node of connected) {
          const x = node.x as number
          const y = node.y as number
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }

        const centerX = (minX + maxX) / 2
        const centerY = (minY + maxY) / 2
        const ringRadius = Math.max(Math.max(maxX - minX, maxY - minY) / 2 + 90, 220)
        placeRingItems(ringItems, centerX, centerY, ringRadius)
        ring = { x: centerX, y: centerY, radius: ringRadius }
      }
    }

    beginFormationWhenReady()
  }

  requestAnimationFrame(() => finalizeLayout())

  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(wrapper)

  const themeObserver = new MutationObserver(() => {
    palette = readPalette()
    surface = readSurface(wrapper, palette.background)
    colors = buildColors(renderNodes, palette)
    graph.linkColor(makeLinkColor()).linkWidth(makeLinkWidth())
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class']
  })

  function zoomIn() {
    const current = Number(graph.zoom()) || 1
    graph.zoom(Math.min(6, current * 1.35), 0)
  }

  function zoomOut() {
    const current = Number(graph.zoom()) || 1
    graph.zoom(Math.max(0.15, current / 1.35), 0)
  }

  function destroy() {
    destroyed = true
    formationActive = false
    resizeObserver.disconnect()
    themeObserver.disconnect()
    if (resizeFrame) cancelAnimationFrame(resizeFrame)
    if (formationFrame) cancelAnimationFrame(formationFrame)
    graph._destructor?.()
  }

  return {
    fit: fitWhenReady,
    resize,
    zoomIn,
    zoomOut,
    destroy
  }
}
