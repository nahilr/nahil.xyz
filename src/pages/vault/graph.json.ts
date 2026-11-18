import type { APIRoute } from 'astro'

import { getVaultGraphData } from '@/utils/graph'

export const prerender = true

export const GET: APIRoute = async () => {
  const { nodes, links, groups, stats } = await getVaultGraphData()
  return new Response(JSON.stringify({ nodes, links, groups, stats }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600'
    }
  })
}
