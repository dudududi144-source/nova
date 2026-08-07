// NOVA Full App Proxy — serves the entire NOVA application through Cloudflare
// All requests are proxied to the backend Next.js server

const BACKEND = "https://preview-chat-dc1fb2f6-89e3-4024-9cca-d9323b5fe643.space-z.ai"

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url)
    const path = url.pathname

    // CORS headers for API responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    // Proxy ALL requests to the backend
    const backendUrl = BACKEND + path + url.search
    
    try {
      const init = {
        method: request.method,
        headers: {
          'Content-Type': request.headers.get('Content-Type') || 'text/html',
          'Accept': request.headers.get('Accept') || '*/*',
        },
        redirect: 'manual',
      }

      // Forward body for POST/PUT/DELETE
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        init.body = await request.arrayBuffer()
      }

      const resp = await fetch(backendUrl, init)
      
      // Get response headers
      const respHeaders = new Headers()
      resp.headers.forEach((value, key) => {
        // Skip headers that Cloudflare manages
        if (!['cf-ray', 'cf-cache-status', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) {
          respHeaders.set(key, value)
        }
      })
      
      // Add CORS headers for API routes
      if (path.startsWith('/api/')) {
        respHeaders.set('Access-Control-Allow-Origin', '*')
      }

      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers: respHeaders,
      })
    } catch (e) {
      // If backend is down, return error
      if (path.startsWith('/api/')) {
        return Response.json({
          ok: false,
          error: 'Backend server not reachable. Please try again in a moment.',
        }, { status: 502, headers: corsHeaders })
      }
      
      // For non-API routes, return a simple error page
      return new Response(`<!DOCTYPE html><html><head><title>NOVA</title><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#0a0a0a;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.box{text-align:center;padding:2rem}h1{color:#3b82f6}p{color:#888;margin-top:1rem}</style></head><body><div class="box"><h1>NOVA</h1><p>Connecting to server...</p><p style="font-size:0.8rem;color:#555;margin-top:2rem">The backend is starting up. Please refresh in a few seconds.</p></div></body></html>`, {
        status: 502,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      })
    }
  }
}

export default worker
