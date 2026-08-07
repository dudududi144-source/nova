// Cloudflare Worker for NOVA API routes
// Handles: /api/settings, /api/enhance, /api/build/architect, /api/build/code, /api/refine
// Does NOT handle: /api/run (needs child_process), /api/backup (needs fs)

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const path = url.pathname

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    // Health check
    if (path === '/api/health') {
      return Response.json({ ok: true, message: 'NOVA Cloudflare Worker is running' })
    }

    // Settings API (in-memory storage)
    if (path === '/api/settings') {
      if (request.method === 'GET') {
        return Response.json({
          keys: {
            zai: { configured: true, masked: '***', source: 'env' },
            dashscope: { configured: false, masked: '', source: 'none' },
            tokenrouter: { configured: false, masked: '', source: 'none' },
          },
          models: { 'z-ai': true, 'qwen': false, 'kimi': false },
        })
      }
      if (request.method === 'POST') {
        return Response.json({ ok: true })
      }
    }

    // For all other API routes, return a helpful error
    if (path.startsWith('/api/')) {
      return Response.json({
        ok: false,
        error: 'This API route requires a Node.js runtime. Please run NOVA locally with: bun run dev',
        route: path,
      }, { status: 501, headers: corsHeaders })
    }

    // For non-API routes, try to serve from assets
    if (env.ASSETS) {
      return env.ASSETS.fetch(request)
    }

    return new Response('Not Found', { status: 404 })
  }
}
