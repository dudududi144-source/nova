// NOVA Gateway Worker — NVIDIA Build API
// Same pattern as PromptForge
// User enters their NVIDIA API key in the UI — stored in memory (localStorage)

const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === '/api/health') {
        return new Response(JSON.stringify({ status: 'healthy', timestamp: Date.now() }), { headers: CORS });
      } else if (url.pathname === '/api/test-key' && request.method === 'POST') {
        return await handleTestKey(request);
      } else if (url.pathname === '/api/models' && request.method === 'POST') {
        return await handleModels(request);
      } else if (url.pathname === '/api/build' && request.method === 'POST') {
        return await handleBuild(request);
      } else {
        return serveUI();
      }
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
    }
  }
};

async function handleTestKey(request) {
  try {
    const body = await request.json();
    const apiKey = body.apiKey || "";
    if (!apiKey) {
      return new Response(JSON.stringify({ ok: false, error: 'apiKey is required' }), { status: 400, headers: CORS });
    }

    const resp = await fetch(NVIDIA_API_URL + "/models", {
      headers: { 'Authorization': 'Bearer ' + apiKey },
      signal: AbortSignal.timeout(10000)
    });

    if (resp.ok) {
      const data = await resp.json();
      const modelCount = (data.data || []).length;
      return new Response(JSON.stringify({
        ok: true,
        message: 'Connected to NVIDIA Build API',
        models_available: modelCount
      }), { headers: CORS });
    } else {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Invalid API key (HTTP ' + resp.status + ')'
      }), { status: 401, headers: CORS });
    }
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: CORS });
  }
}

async function handleModels(request) {
  try {
    const body = await request.json();
    const apiKey = body.apiKey || "";
    if (!apiKey) {
      return new Response(JSON.stringify({ ok: false, error: 'apiKey is required' }), { status: 400, headers: CORS });
    }

    const resp = await fetch(NVIDIA_API_URL + "/models", {
      headers: { 'Authorization': 'Bearer ' + apiKey }
    });

    if (!resp.ok) {
      return new Response(JSON.stringify({ ok: false, error: 'NVIDIA API error: ' + resp.status }), { status: resp.status, headers: CORS });
    }

    const data = await resp.json();
    const models = (data.data || []).map(m => m.id);
    return new Response(JSON.stringify({ ok: true, models, total: models.length }), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: CORS });
  }
}

async function handleBuild(request) {
  try {
    const body = await request.json();
    const apiKey = body.apiKey || "";
    const mission = body.mission || "";
    const model = body.model || "meta/llama-3.1-8b-instruct";

    if (!apiKey) {
      return new Response(JSON.stringify({ ok: false, error: 'NVIDIA API key is required. Enter your key in the Connect box.' }), { status: 400, headers: CORS });
    }
    if (!mission) {
      return new Response(JSON.stringify({ ok: false, error: 'mission is required' }), { status: 400, headers: CORS });
    }

    const t0 = Date.now();

    const resp = await fetch(NVIDIA_API_URL + "/chat/completions", {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: 'You are a web developer. Create a complete, single-file HTML application. Output ONLY the HTML code — no markdown, no explanation. Include CSS in <style> tags and JS in <script> tags. Make it beautiful, responsive, and fully functional.'
          },
          { role: 'user', content: mission }
        ],
        max_tokens: 4096,
        temperature: 0.3
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return new Response(JSON.stringify({
        ok: false,
        error: 'NVIDIA API error: ' + resp.status + ' - ' + errText.substring(0, 200)
      }), { status: resp.status, headers: CORS });
    }

    const data = await resp.json();
    let html = (data.choices && data.choices[0]) ? data.choices[0].message.content : "";
    const tokens = (data.usage && data.usage.total_tokens) ? data.usage.total_tokens : 0;

    // Remove markdown fences
    const fence = '```';
    if (html.includes(fence)) {
      const parts = html.split(fence);
      if (parts.length >= 3) {
        html = parts[1];
        const lines = html.split('\n');
        if (['html', ''].includes(lines[0].trim().toLowerCase())) {
          html = lines.slice(1).join("\n");
        }
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      html: html.trim(),
      tokens: tokens,
      ms: Date.now() - t0,
      model: model
    }), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: CORS });
  }
}

function serveUI() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NOVA — The Prompt-to-Reality Engine</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #fff; min-height: 100vh; }
.header { padding: 1rem 2rem; border-bottom: 1px solid #222; display: flex; align-items: center; gap: 1rem; }
.logo { font-size: 1.5rem; font-weight: bold; background: linear-gradient(90deg, #60a5fa, #a78bfa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.tagline { color: #888; font-size: 0.875rem; }
.main { padding: 2rem; max-width: 900px; margin: 0 auto; }
h2 { margin-bottom: 1rem; font-size: 1.5rem; }

/* API Key Box */
.api-box { margin-bottom: 1.5rem; padding: 1.25rem; background: #111; border: 1px solid #333; border-radius: 8px; }
.api-box h3 { font-size: 0.875rem; color: #60a5fa; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.5rem; }
.api-box .desc { font-size: 0.75rem; color: #666; margin-bottom: 0.75rem; }
.api-input-row { display: flex; gap: 0.5rem; }
.api-input { flex: 1; background: #0a0a0a; border: 1px solid #333; border-radius: 6px; padding: 0.625rem 0.875rem; color: #fff; font-size: 0.875rem; font-family: monospace; }
.api-input:focus { outline: none; border-color: #60a5fa; }
.api-btn { background: #10b981; color: #000; border: none; padding: 0.625rem 1.25rem; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.875rem; white-space: nowrap; }
.api-btn:hover { background: #059669; }
.api-status { margin-top: 0.5rem; font-size: 0.75rem; }
.api-connected { color: #10b981; }
.api-error { color: #ef4444; }
.api-link { color: #60a5fa; text-decoration: none; font-size: 0.75rem; }
.api-link:hover { text-decoration: underline; }

/* Build Area */
textarea { width: 100%; min-height: 100px; background: #111; border: 1px solid #333; border-radius: 8px; padding: 1rem; color: #fff; font-size: 1rem; resize: vertical; font-family: inherit; }
textarea:focus { outline: none; border-color: #60a5fa; }
.btn { background: #60a5fa; color: #000; border: none; padding: 0.75rem 2rem; border-radius: 6px; font-weight: 600; cursor: pointer; margin-top: 1rem; font-size: 1rem; }
.btn:hover { background: #3b82f6; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

.model-select { margin-top: 0.75rem; background: #111; border: 1px solid #333; border-radius: 6px; padding: 0.5rem 0.875rem; color: #fff; font-size: 0.875rem; }
.model-select:focus { outline: none; border-color: #60a5fa; }

.status { margin-top: 1rem; color: #888; font-size: 0.875rem; }
.result { margin-top: 1.5rem; }
.result iframe { width: 100%; height: 600px; border: 1px solid #333; border-radius: 8px; background: #fff; }
.error { color: #ef4444; }
.success { color: #10b981; }

.templates { margin-top: 0.75rem; display: flex; flex-wrap: wrap; gap: 0.5rem; }
.template { background: #111; border: 1px solid #333; border-radius: 4px; padding: 0.4rem 0.875rem; font-size: 0.75rem; color: #888; cursor: pointer; transition: all 0.2s; }
.template:hover { border-color: #60a5fa; color: #fff; }

.build-area { opacity: 0.5; pointer-events: none; transition: opacity 0.3s; }
.build-area.active { opacity: 1; pointer-events: auto; }
</style>
</head>
<body>
<div class="header">
<div class="logo">NOVA</div>
<div class="tagline">Prompt-to-Reality Engine — NVIDIA Build API</div>
</div>
<div class="main">

<!-- API Key Connection Box -->
<div class="api-box">
<h3>🔑 NVIDIA API Connection</h3>
<div class="desc">Enter your NVIDIA Build API key to activate NOVA. Get a free key at <a class="api-link" href="https://build.nvidia.com" target="_blank">build.nvidia.com</a></div>
<div class="api-input-row">
<input class="api-input" id="apiKey" type="password" placeholder="nvapi-..." />
<button class="api-btn" id="connectBtn" onclick="connectKey()">Connect</button>
</div>
<div id="apiStatus" class="api-status"></div>
</div>

<!-- Build Area -->
<div class="build-area" id="buildArea">
<h2>What do you want to build?</h2>
<textarea id="mission" placeholder="e.g., Build a counter app with increment and decrement buttons..."></textarea>
<select class="model-select" id="model">
<option value="meta/llama-3.1-8b-instruct">Llama 3.1 8B (Fast)</option>
<option value="meta/llama-3.1-70b-instruct">Llama 3.1 70B (Smart)</option>
<option value="mistralai/mistral-nemotron-12b-instruct">Mistral Nemotron 12B</option>
<option value="nvidia/llama-3.1-nemotron-70b-instruct">Nemotron 70B</option>
<option value="qwen/qwen2.5-coder-7b-instruct">Qwen 2.5 Coder 7B</option>
<option value="qwen/qwen2.5-coder-32b-instruct">Qwen 2.5 Coder 32B</option>
<option value="deepseek-ai/deepseek-r1">DeepSeek R1</option>
</select>
<button class="btn" id="buildBtn" onclick="build()">Build</button>
<div id="status" class="status"></div>
<div class="templates">
<span class="template" onclick="set('counter app')">Counter</span>
<span class="template" onclick="set('todo list')">Todo</span>
<span class="template" onclick="set('calculator')">Calculator</span>
<span class="template" onclick="set('snake game')">Snake</span>
<span class="template" onclick="set('markdown editor')">Markdown</span>
<span class="template" onclick="set('clock with alarm')">Clock</span>
<span class="template" onclick="set('color palette generator')">Colors</span>
<span class="template" onclick="set('password generator')">Password Gen</span>
<span class="template" onclick="set('weather dashboard')">Weather</span>
<span class="template" onclick="set('music player')">Music Player</span>
</div>
<div id="result" class="result"></div>
</div>

</div>

<script>
let apiKey = localStorage.getItem('nova_nvidia_key') || '';

// Restore key on load
if (apiKey) {
  document.getElementById('apiKey').value = apiKey;
  connectKey();
}

function set(t) { document.getElementById('mission').value = t; }

async function connectKey() {
  const key = document.getElementById('apiKey').value.trim();
  const s = document.getElementById('apiStatus');
  const btn = document.getElementById('connectBtn');
  
  if (!key) {
    s.innerHTML = '<span class="api-error">Please enter your API key</span>';
    return;
  }
  
  btn.disabled = true;
  btn.textContent = 'Connecting...';
  s.innerHTML = '<span style="color:#888">Testing connection...</span>';
  
  try {
    const r = await fetch('/api/test-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key })
    });
    const d = await r.json();
    
    if (d.ok) {
      apiKey = key;
      localStorage.setItem('nova_nvidia_key', key);
      s.innerHTML = '<span class="api-connected">✓ ' + d.message + ' (' + d.models_available + ' models available)</span>';
      document.getElementById('buildArea').classList.add('active');
      btn.textContent = 'Connected';
      btn.style.background = '#10b981';
    } else {
      s.innerHTML = '<span class="api-error">✗ ' + d.error + '</span>';
      btn.textContent = 'Connect';
      btn.disabled = false;
    }
  } catch(e) {
    s.innerHTML = '<span class="api-error">Error: ' + e.message + '</span>';
    btn.textContent = 'Connect';
    btn.disabled = false;
  }
}

async function build() {
  const m = document.getElementById('mission').value.trim();
  if (!m) return;
  if (!apiKey) {
    document.getElementById('apiStatus').innerHTML = '<span class="api-error">Please connect your API key first</span>';
    return;
  }
  
  const model = document.getElementById('model').value;
  const b = document.getElementById('buildBtn');
  const s = document.getElementById('status');
  const r = document.getElementById('result');
  
  b.disabled = true;
  s.textContent = 'Building with ' + model + '...';
  r.innerHTML = '';
  
  try {
    const res = await fetch('/api/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mission: m, model: model, apiKey: apiKey })
    });
    const d = await res.json();
    
    if (!d.ok) throw new Error(d.error);
    
    s.innerHTML = '<span class="success">✓ Built! ' + d.tokens + ' tokens in ' + (d.ms/1000).toFixed(1) + 's</span>';
    const f = document.createElement('iframe');
    f.srcdoc = d.html;
    r.innerHTML = '';
    r.appendChild(f);
  } catch(e) {
    s.innerHTML = '<span class="error">Error: ' + e.message + '</span>';
  } finally {
    b.disabled = false;
  }
}
</script>
</body>
</html>`;
  
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
