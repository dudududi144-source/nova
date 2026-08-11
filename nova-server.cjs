// NOVA — Ultra-light server (Node.js/Bun compatible)
// No Next.js, no SDK, no fs — just fetch + Z.AI API

const http = require('http');
const { URL } = require('url');

const ZAI = {
  baseUrl: 'https://internal-api.z.ai/v1',
  apiKey: 'Z.ai',
  chatId: 'chat-dc1fb2f6-89e3-4024-9cca-d9323b5fe643',
  userId: '851fa622-4608-4c34-9115-a98890c9ea22',
  token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiODUxZmE2MjItNDYwOC00YzM0LTkxMTUtYTk4ODkwYzllYTIyIiwiY2hhdF9pZCI6ImNoYXQtZGMxZmIyZjYtODllMy00MDI0LTljY2EtZDkzMjNiNWZlNjQzIiwicGxhdGZvcm0iOiJ6YWkifQ.rYEOt9X7HidHwBaJyarGUKhFx3Nvud0eoVYM3x9U0-0'
};

async function callZAI(messages, maxTokens = 8000) {
  const resp = await fetch(ZAI.baseUrl + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + ZAI.apiKey,
      'X-Z-AI-From': 'Z',
      'X-Chat-Id': ZAI.chatId,
      'X-User-Id': ZAI.userId,
      'X-Token': ZAI.token,
    },
    body: JSON.stringify({ messages, max_tokens: maxTokens, thinking: { type: 'enabled' }, stream: false }),
  });
  if (!resp.ok) throw new Error('Z.AI error: ' + resp.status);
  const data = await resp.json();
  return {
    text: data.choices?.[0]?.message?.content || '',
    tokens: (data.usage?.prompt_tokens || 0) + (data.usage?.completion_tokens || 0),
  };
}

const UI = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NOVA — Prompt to Reality</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0a;color:#fff;min-height:100vh}
.header{padding:1rem 2rem;border-bottom:1px solid #222;display:flex;align-items:center;gap:1rem}
.logo{font-size:1.5rem;font-weight:bold;background:linear-gradient(90deg,#60a5fa,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.tagline{color:#888;font-size:0.875rem}
.main{padding:2rem;max-width:900px;margin:0 auto}
h2{margin-bottom:1rem;font-size:1.5rem}
textarea{width:100%;min-height:120px;background:#111;border:1px solid #333;border-radius:8px;padding:1rem;color:#fff;font-size:1rem;resize:vertical;font-family:inherit}
textarea:focus{outline:none;border-color:#60a5fa}
.btn{background:#60a5fa;color:#000;border:none;padding:0.75rem 2rem;border-radius:6px;font-weight:600;cursor:pointer;margin-top:1rem;font-size:1rem}
.btn:hover{background:#3b82f6}.btn:disabled{opacity:0.5}
.status{margin-top:1rem;color:#888;font-size:0.875rem}
.result{margin-top:2rem}.result iframe{width:100%;height:600px;border:1px solid #333;border-radius:8px;background:#fff}
.error{color:#ef4444}.success{color:#10b981}
.templates{margin-top:1rem;display:flex;flex-wrap:wrap;gap:0.5rem}
.template{background:#111;border:1px solid #333;border-radius:4px;padding:0.5rem 1rem;font-size:0.75rem;color:#888;cursor:pointer}
.template:hover{border-color:#60a5fa;color:#fff}
</style>
</head>
<body>
<div class="header"><div class="logo">NOVA</div><div class="tagline">Prompt-to-Reality Engine</div></div>
<div class="main">
<div class="input-area">
<h2>What do you want to build?</h2>
<textarea id="mission" placeholder="e.g., Build a counter app..."></textarea>
<button class="btn" id="buildBtn" onclick="build()">Build</button>
<div id="status" class="status"></div>
<div class="templates">
<span class="template" onclick="set('counter app')">Counter</span>
<span class="template" onclick="set('todo list')">Todo</span>
<span class="template" onclick="set('calculator')">Calculator</span>
<span class="template" onclick="set('snake game')">Snake</span>
<span class="template" onclick="set('markdown editor')">Markdown</span>
</div>
</div>
<div id="result" class="result"></div>
</div>
<script>
function set(t){document.getElementById('mission').value=t}
async function build(){
  const m=document.getElementById('mission').value.trim();if(!m)return;
  const b=document.getElementById('buildBtn'),s=document.getElementById('status'),r=document.getElementById('result');
  b.disabled=true;s.textContent='Building...';r.innerHTML='';
  try{
    s.textContent='Generating...';
    const res=await fetch('/api/build',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mission:m})});
    const d=await res.json();
    if(!d.ok)throw new Error(d.error);
    s.innerHTML='<span class="success">Built! '+d.tokens+' tokens in '+(d.ms/1000).toFixed(1)+'s</span>';
    const f=document.createElement('iframe');f.srcdoc=d.html;r.innerHTML='';r.appendChild(f);
  }catch(e){s.innerHTML='<span class="error">Error: '+e.message+'</span>'}
  finally{b.disabled=false}
}
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  
  if (url.pathname === '/api/build' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const { mission } = JSON.parse(body);
      if (!mission) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'No mission' })); return; }
      
      const t0 = Date.now();
      const result = await callZAI([
        { role: 'system', content: 'You are a web developer. Create a complete, single-file HTML application. Output ONLY the HTML code — no markdown, no explanation. Include CSS in <style> tags and JS in <script> tags. Make it beautiful and functional.' },
        { role: 'user', content: mission }
      ]);
      
      let html = result.text.replace(/^\x60\x60\x60html?\n?/, '').replace(/\n?\x60\x60\x60$/, '');
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, html, tokens: result.tokens, ms: Date.now() - t0 }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(err).slice(0, 200) }));
    }
    return;
  }
  
  if (url.pathname === '/api/settings') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ keys: { zai: { configured: true, source: 'direct' } } }));
    return;
  }
  
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(UI);
});

server.listen(3000, '0.0.0.0', () => console.log('NOVA server on :3000'));
