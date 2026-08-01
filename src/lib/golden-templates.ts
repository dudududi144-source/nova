// Golden Templates — pre-built HTML app templates that NOVA uses as seeds.
//
// When a user's mission closely matches a known template (e.g. "build a snake game"),
// NOVA can include the template HTML as a starting point in the LLM prompt. This:
// - Reduces generation time (LLM has a working baseline to refine)
// - Improves output quality (templates are hand-crafted, working apps)
// - Lowers token usage (LLM doesn't start from scratch)
//
// Templates are COMPLETE, WORKING HTML files with NOVA's dark theme. Each has a
// list of keywords used to match against user missions.
//
// Pure module — no I/O, no LLM calls. The `html` strings are static.

// ── Types ──

/** A pre-built HTML app template. */
export interface GoldenTemplate {
  /** Unique identifier, e.g. "snake-game". */
  id: string
  /** Human-readable name, e.g. "Snake Game". */
  name: string
  /** Keywords that, if present in the mission, suggest this template. Lowercase. */
  keywords: string[]
  /** Short description of what the template provides. */
  description: string
  /** Complete working HTML document (dark theme, single-file). */
  html: string
}

// ── Templates ──
// Each template is a complete, self-contained HTML file. They use NOVA's slate
// dark theme tokens so they blend with the rest of the generated apps.

const SNAKE_GAME_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Snake Game</title>
<style>
  :root {
    --bg: #0f172a;
    --card: #1e293b;
    --text: #e2e8f0;
    --primary: #3b82f6;
    --accent: #22d3ee;
    --muted: #64748b;
    --border: #334155;
    --success: #22c55e;
    --warning: #f59e0b;
    --error: #ef4444;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: system-ui, -apple-system, sans-serif;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }
  h1 { font-size: 28px; margin-bottom: 8px; color: var(--accent); }
  .score-bar {
    display: flex;
    gap: 24px;
    margin-bottom: 12px;
    font-size: 16px;
  }
  .score-bar span { color: var(--muted); }
  .score-bar b { color: var(--text); font-weight: 600; }
  canvas {
    background: var(--card);
    border: 2px solid var(--border);
    border-radius: 8px;
    display: block;
  }
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 10;
  }
  .overlay.active { display: flex; }
  .overlay-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 32px 48px;
    text-align: center;
  }
  .overlay-card h2 { font-size: 24px; margin-bottom: 16px; }
  .overlay-card p { color: var(--muted); margin-bottom: 16px; }
  .btn {
    background: var(--primary);
    color: white;
    border: none;
    padding: 10px 20px;
    border-radius: 8px;
    font-size: 16px;
    cursor: pointer;
    transition: filter 150ms ease, transform 150ms ease;
  }
  .btn:hover { filter: brightness(1.1); }
  .btn:active { transform: scale(0.97); }
  .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .hint { color: var(--muted); font-size: 13px; margin-top: 12px; }
</style>
</head>
<body>
<h1>Snake</h1>
<div class="score-bar">
  <span>Score: <b id="score">0</b></span>
  <span>High: <b id="high">0</b></span>
</div>
<canvas id="game" width="400" height="400" aria-label="Snake game board"></canvas>
<p class="hint">Arrow keys to move. P to pause.</p>

<div class="overlay" id="overlay" role="dialog" aria-modal="true">
  <div class="overlay-card">
    <h2 id="overlay-title">Game Over</h2>
    <p id="overlay-msg">Press Start to play again.</p>
    <button class="btn" id="restart-btn" aria-label="Start new game">Start</button>
  </div>
</div>

<script>
(function () {
  'use strict';
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var scoreEl = document.getElementById('score');
  var highEl = document.getElementById('high');
  var overlay = document.getElementById('overlay');
  var overlayTitle = document.getElementById('overlay-title');
  var overlayMsg = document.getElementById('overlay-msg');
  var restartBtn = document.getElementById('restart-btn');

  var GRID = 20;
  var CELLS = canvas.width / GRID; // 20x20
  var snake, dir, nextDir, food, score, high, running, paused, loopId;

  try { high = parseInt(localStorage.getItem('nova_snake_high') || '0', 10) || 0; }
  catch (e) { high = 0; }
  highEl.textContent = high;

  function reset() {
    snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    dir = { x: 1, y: 0 };
    nextDir = dir;
    score = 0;
    scoreEl.textContent = '0';
    placeFood();
    running = false;
    paused = false;
    draw();
  }

  function placeFood() {
    while (true) {
      var x = Math.floor(Math.random() * CELLS);
      var y = Math.floor(Math.random() * CELLS);
      if (!snake.some(function (s) { return s.x === x && s.y === y; })) {
        food = { x: x, y: y };
        return;
      }
    }
  }

  function draw() {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Food
    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.arc(food.x * GRID + GRID / 2, food.y * GRID + GRID / 2, GRID / 2 - 2, 0, Math.PI * 2);
    ctx.fill();

    // Snake
    snake.forEach(function (s, i) {
      ctx.fillStyle = i === 0 ? '#22d3ee' : '#3b82f6';
      ctx.fillRect(s.x * GRID + 1, s.y * GRID + 1, GRID - 2, GRID - 2);
    });
  }

  function step() {
    if (!running || paused) return;
    dir = nextDir;
    var head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    // Wall collision
    if (head.x < 0 || head.x >= CELLS || head.y < 0 || head.y >= CELLS) {
      return gameOver();
    }
    // Self collision
    if (snake.some(function (s) { return s.x === head.x && s.y === head.y; })) {
      return gameOver();
    }

    snake.unshift(head);

    if (head.x === food.x && head.y === food.y) {
      score++;
      scoreEl.textContent = score;
      if (score > high) {
        high = score;
        highEl.textContent = high;
        try { localStorage.setItem('nova_snake_high', String(high)); } catch (e) {}
      }
      placeFood();
    } else {
      snake.pop();
    }

    draw();
  }

  function start() {
    if (running && !paused) return;
    if (!running) reset();
    running = true;
    paused = false;
    overlay.classList.remove('active');
    if (loopId) clearInterval(loopId);
    loopId = setInterval(step, 120);
  }

  function pause() {
    if (!running) return;
    paused = !paused;
    if (paused) {
      overlayTitle.textContent = 'Paused';
      overlayMsg.textContent = 'Press P or Resume to continue.';
      restartBtn.textContent = 'Resume';
      overlay.classList.add('active');
    } else {
      overlay.classList.remove('active');
    }
  }

  function gameOver() {
    running = false;
    if (loopId) clearInterval(loopId);
    overlayTitle.textContent = 'Game Over';
    overlayMsg.textContent = 'Final score: ' + score + '. High: ' + high + '.';
    restartBtn.textContent = 'Play Again';
    overlay.classList.add('active');
  }

  document.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'ArrowUp' && dir.y !== 1) { nextDir = { x: 0, y: -1 }; e.preventDefault(); }
    else if (k === 'ArrowDown' && dir.y !== -1) { nextDir = { x: 0, y: 1 }; e.preventDefault(); }
    else if (k === 'ArrowLeft' && dir.x !== 1) { nextDir = { x: -1, y: 0 }; e.preventDefault(); }
    else if (k === 'ArrowRight' && dir.x !== -1) { nextDir = { x: 1, y: 0 }; e.preventDefault(); }
    else if (k === 'p' || k === 'P') { pause(); }
    else if (k === ' ' && !running) { start(); e.preventDefault(); }
  });

  restartBtn.addEventListener('click', start);

  reset();
  overlayTitle.textContent = 'Snake';
  overlayMsg.textContent = 'Eat the green food. Don\'t hit the walls or yourself.';
  restartBtn.textContent = 'Start';
  overlay.classList.add('active');
})();
</script>
</body>
</html>`

const TODO_APP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Todo App</title>
<style>
  :root {
    --bg: #0f172a;
    --card: #1e293b;
    --text: #e2e8f0;
    --primary: #3b82f6;
    --accent: #22d3ee;
    --muted: #64748b;
    --border: #334155;
    --success: #22c55e;
    --warning: #f59e0b;
    --error: #ef4444;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: system-ui, -apple-system, sans-serif;
    min-height: 100vh;
    padding: 24px;
    display: flex;
    justify-content: center;
  }
  .app {
    width: 100%;
    max-width: 560px;
  }
  h1 { font-size: 28px; margin-bottom: 20px; color: var(--accent); }
  .input-row {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
  }
  .input {
    flex: 1;
    background: var(--card);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 10px 12px;
    border-radius: 8px;
    font-size: 15px;
    outline: none;
    transition: border-color 150ms ease;
  }
  .input:focus { border-color: var(--primary); }
  .btn {
    background: var(--primary);
    color: white;
    border: none;
    padding: 10px 18px;
    border-radius: 8px;
    font-size: 15px;
    cursor: pointer;
    transition: filter 150ms ease, transform 150ms ease;
  }
  .btn:hover { filter: brightness(1.1); }
  .btn:active { transform: scale(0.97); }
  .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .filters {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }
  .filter-btn {
    background: transparent;
    color: var(--muted);
    border: 1px solid var(--border);
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
    transition: all 150ms ease;
  }
  .filter-btn.active {
    background: var(--primary);
    color: white;
    border-color: var(--primary);
  }
  .filter-btn:hover { color: var(--text); }
  ul { list-style: none; }
  .task {
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 14px;
    margin-bottom: 8px;
    transition: opacity 150ms ease;
  }
  .task.done { opacity: 0.5; }
  .task.done .task-text { text-decoration: line-through; }
  .task input[type="checkbox"] {
    width: 18px;
    height: 18px;
    accent-color: var(--primary);
    cursor: pointer;
  }
  .task-text {
    flex: 1;
    font-size: 15px;
    word-break: break-word;
  }
  .delete-btn {
    background: transparent;
    color: var(--muted);
    border: none;
    cursor: pointer;
    font-size: 18px;
    padding: 4px 8px;
    border-radius: 4px;
    transition: color 150ms ease, background 150ms ease;
  }
  .delete-btn:hover {
    color: var(--error);
    background: rgba(239, 68, 68, 0.1);
  }
  .empty {
    text-align: center;
    color: var(--muted);
    padding: 40px 0;
    font-size: 14px;
  }
  .stats {
    color: var(--muted);
    font-size: 13px;
    margin-top: 12px;
  }
</style>
</head>
<body>
<div class="app">
  <h1>Todo</h1>
  <div class="input-row">
    <input type="text" id="task-input" class="input" placeholder="Add a task..." aria-label="New task input" maxlength="200">
    <button class="btn" id="add-btn" aria-label="Add task">Add</button>
  </div>
  <div class="filters" role="tablist">
    <button class="filter-btn active" data-filter="all" role="tab">All</button>
    <button class="filter-btn" data-filter="active" role="tab">Active</button>
    <button class="filter-btn" data-filter="done" role="tab">Completed</button>
  </div>
  <ul id="task-list" aria-live="polite"></ul>
  <div class="empty" id="empty">No tasks yet. Add one above.</div>
  <div class="stats" id="stats"></div>
</div>

<script>
(function () {
  'use strict';
  var input = document.getElementById('task-input');
  var addBtn = document.getElementById('add-btn');
  var list = document.getElementById('task-list');
  var empty = document.getElementById('empty');
  var stats = document.getElementById('stats');
  var filterBtns = document.querySelectorAll('.filter-btn');

  var tasks = [];
  var filter = 'all';
  var nextId = 1;

  function save() {
    try { localStorage.setItem('nova_todos', JSON.stringify(tasks)); } catch (e) {}
  }
  function load() {
    try {
      var raw = localStorage.getItem('nova_todos');
      if (raw) {
        tasks = JSON.parse(raw) || [];
        nextId = tasks.reduce(function (m, t) { return Math.max(m, t.id + 1); }, 1);
      }
    } catch (e) { tasks = []; }
  }

  function render() {
    list.innerHTML = '';
    var visible = tasks.filter(function (t) {
      if (filter === 'active') return !t.done;
      if (filter === 'done') return t.done;
      return true;
    });

    if (visible.length === 0) {
      empty.style.display = 'block';
      empty.textContent = tasks.length === 0
        ? 'No tasks yet. Add one above.'
        : 'No ' + filter + ' tasks.';
    } else {
      empty.style.display = 'none';
    }

    visible.forEach(function (t) {
      var li = document.createElement('li');
      li.className = 'task' + (t.done ? ' done' : '');

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = t.done;
      cb.setAttribute('aria-label', 'Mark task complete');
      cb.addEventListener('change', function () { toggle(t.id); });

      var span = document.createElement('span');
      span.className = 'task-text';
      span.textContent = t.text;

      var del = document.createElement('button');
      del.className = 'delete-btn';
      del.textContent = '\u00d7';
      del.setAttribute('aria-label', 'Delete task');
      del.addEventListener('click', function () { remove(t.id); });

      li.appendChild(cb);
      li.appendChild(span);
      li.appendChild(del);
      list.appendChild(li);
    });

    var active = tasks.filter(function (t) { return !t.done; }).length;
    var done = tasks.length - active;
    stats.textContent = tasks.length + ' total \u00b7 ' + active + ' active \u00b7 ' + done + ' done';
  }

  function add() {
    var text = input.value.trim();
    if (!text) return;
    tasks.unshift({ id: nextId++, text: text, done: false });
    input.value = '';
    save();
    render();
  }

  function toggle(id) {
    var t = tasks.find(function (x) { return x.id === id; });
    if (t) { t.done = !t.done; save(); render(); }
  }

  function remove(id) {
    tasks = tasks.filter(function (x) { return x.id !== id; });
    save();
    render();
  }

  addBtn.addEventListener('click', add);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') add();
  });
  filterBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      filterBtns.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      filter = btn.getAttribute('data-filter');
      render();
    });
  });

  load();
  render();
  input.focus();
})();
</script>
</body>
</html>`

const CALCULATOR_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Calculator</title>
<style>
  :root {
    --bg: #0f172a;
    --card: #1e293b;
    --text: #e2e8f0;
    --primary: #3b82f6;
    --accent: #22d3ee;
    --muted: #64748b;
    --border: #334155;
    --success: #22c55e;
    --warning: #f59e0b;
    --error: #ef4444;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: system-ui, -apple-system, sans-serif;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }
  .calc {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 20px;
    width: 100%;
    max-width: 320px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  }
  .display {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 18px 16px;
    margin-bottom: 16px;
    text-align: right;
    min-height: 80px;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }
  .history {
    color: var(--muted);
    font-size: 14px;
    min-height: 18px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .current {
    color: var(--text);
    font-size: 32px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }
  button {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px 0;
    font-size: 18px;
    cursor: pointer;
    transition: filter 150ms ease, transform 150ms ease, background 150ms ease;
  }
  button:hover { filter: brightness(1.2); }
  button:active { transform: scale(0.95); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button.op {
    background: var(--primary);
    color: white;
    border-color: var(--primary);
  }
  button.eq {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
    font-weight: 700;
  }
  button.clear {
    background: var(--error);
    color: white;
    border-color: var(--error);
  }
  button.zero {
    grid-column: span 2;
  }
</style>
</head>
<body>
<div class="calc" role="application" aria-label="Calculator">
  <div class="display">
    <div class="history" id="history" aria-live="polite"></div>
    <div class="current" id="current" aria-live="polite">0</div>
  </div>
  <div class="grid">
    <button class="clear" data-action="clear" aria-label="Clear">C</button>
    <button data-action="back" aria-label="Backspace">\u232b</button>
    <button class="op" data-op="/" aria-label="Divide">\u00f7</button>
    <button class="op" data-op="*" aria-label="Multiply">\u00d7</button>

    <button data-digit="7">7</button>
    <button data-digit="8">8</button>
    <button data-digit="9">9</button>
    <button class="op" data-op="-" aria-label="Subtract">\u2212</button>

    <button data-digit="4">4</button>
    <button data-digit="5">5</button>
    <button data-digit="6">6</button>
    <button class="op" data-op="+" aria-label="Add">+</button>

    <button data-digit="1">1</button>
    <button data-digit="2">2</button>
    <button data-digit="3">3</button>
    <button class="eq" data-action="equals" aria-label="Equals" style="grid-row: span 2;">=</button>

    <button class="zero" data-digit="0">0</button>
    <button data-action="dot">.</button>
  </div>
</div>

<script>
(function () {
  'use strict';
  var currentEl = document.getElementById('current');
  var historyEl = document.getElementById('history');

  var current = '0';
  var previous = null;
  var op = null;
  var justEvaluated = false;

  function render() {
    currentEl.textContent = current;
    if (previous !== null && op) {
      historyEl.textContent = previous + ' ' + opSymbol(op);
    } else {
      historyEl.textContent = '';
    }
  }

  function opSymbol(o) {
    return { '+': '+', '-': '\u2212', '*': '\u00d7', '/': '\u00f7' }[o] || o;
  }

  function inputDigit(d) {
    if (justEvaluated) { current = '0'; justEvaluated = false; }
    if (current === '0') current = d;
    else if (current.length < 12) current += d;
    render();
  }

  function inputDot() {
    if (justEvaluated) { current = '0'; justEvaluated = false; }
    if (current.indexOf('.') === -1) current += '.';
    render();
  }

  function clearAll() {
    current = '0';
    previous = null;
    op = null;
    justEvaluated = false;
    render();
  }

  function backspace() {
    if (justEvaluated) { clearAll(); return; }
    if (current.length > 1) current = current.slice(0, -1);
    else current = '0';
    render();
  }

  function chooseOp(nextOp) {
    if (op !== null && previous !== null && !justEvaluated) {
      compute();
    }
    previous = parseFloat(current);
    op = nextOp;
    justEvaluated = false;
    current = '0';
    render();
  }

  function compute() {
    if (op === null || previous === null) return;
    var a = previous;
    var b = parseFloat(current);
    var r;
    switch (op) {
      case '+': r = a + b; break;
      case '-': r = a - b; break;
      case '*': r = a * b; break;
      case '/':
        if (b === 0) {
          current = 'Error';
          previous = null;
          op = null;
          justEvaluated = true;
          render();
          return;
        }
        r = a / b;
        break;
      default: return;
    }
    // Round to avoid float noise like 0.1+0.2=0.30000000000000004
    r = Math.round(r * 1e10) / 1e10;
    current = String(r);
    previous = null;
    op = null;
    justEvaluated = true;
    render();
  }

  document.querySelectorAll('button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var d = btn.getAttribute('data-digit');
      var o = btn.getAttribute('data-op');
      var a = btn.getAttribute('data-action');
      if (d !== null) inputDigit(d);
      else if (o !== null) chooseOp(o);
      else if (a === 'dot') inputDot();
      else if (a === 'clear') clearAll();
      else if (a === 'back') backspace();
      else if (a === 'equals') compute();
    });
  });

  document.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k >= '0' && k <= '9') { inputDigit(k); e.preventDefault(); }
    else if (k === '.') { inputDot(); e.preventDefault(); }
    else if (k === '+' || k === '-' || k === '*' || k === '/') { chooseOp(k); e.preventDefault(); }
    else if (k === 'Enter' || k === '=') { compute(); e.preventDefault(); }
    else if (k === 'Backspace') { backspace(); e.preventDefault(); }
    else if (k === 'Escape' || k === 'c' || k === 'C') { clearAll(); e.preventDefault(); }
  });

  render();
})();
</script>
</body>
</html>`

export const GOLDEN_TEMPLATES: GoldenTemplate[] = [
  {
    id: 'snake-game',
    name: 'Snake Game',
    keywords: ['snake', 'snake game', 'game', 'arcade', 'canvas game'],
    description: 'Classic Snake game on HTML5 Canvas with score, high-score, pause, and game-over screen.',
    html: SNAKE_GAME_HTML,
  },
  {
    id: 'todo-app',
    name: 'Todo App',
    keywords: ['todo', 'todos', 'task', 'tasks', 'todo list', 'task list', 'checklist'],
    description: 'Todo list with add/complete/delete, All/Active/Completed filters, and persistent storage.',
    html: TODO_APP_HTML,
  },
  {
    id: 'calculator',
    name: 'Calculator',
    keywords: ['calculator', 'calc', 'arithmetic', 'math', 'math calculator'],
    description: 'Standard calculator with digit pad, +-\u00d7\u00f7 operations, keyboard support, and history.',
    html: CALCULATOR_HTML,
  },
]

// ── Template matching ──

/**
 * Find the best-matching golden template for a user mission.
 * Scores each template by counting keyword matches (word-boundary aware)
 * against the lowercased mission. Returns the highest-scoring template,
 * or null if no template has at least one keyword match.
 *
 * Word-boundary matching prevents false positives (e.g. "css" matching "basilisk"
 * or "todo" matching "autodo"). Multi-word keywords like "snake game" match if
 * the literal phrase appears in the mission.
 */
export function findTemplate(mission: string): GoldenTemplate | null {
  if (!mission || !mission.trim()) return null
  const lower = ' ' + mission.toLowerCase() + ' '

  let best: GoldenTemplate | null = null
  let bestScore = 0

  for (const tpl of GOLDEN_TEMPLATES) {
    let score = 0
    for (const kw of tpl.keywords) {
      const k = kw.toLowerCase()
      if (k.includes(' ')) {
        // Multi-word keyword: literal substring match
        if (lower.includes(k)) score += 3
      } else {
        // Single-word keyword: match on word boundaries
        // \b in JS regex works with ASCII word chars; keywords here are all ASCII.
        const re = new RegExp('\\b' + escapeRegex(k) + '\\b')
        if (re.test(lower)) score += 2
      }
    }
    if (score > bestScore) {
      bestScore = score
      best = tpl
    }
  }

  // Require at least one match (score >= 2 for single-word, >= 3 for multi-word)
  return bestScore >= 2 ? best : null
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Build a seeded prompt that includes the template HTML as a starting point.
 * The LLM is instructed to use the template as a baseline and adapt it to the
 * specific mission (add features, change styling, etc.).
 *
 * The template HTML is included inline so the LLM has direct access to it.
 */
export function buildSeededPrompt(mission: string, template: GoldenTemplate): string {
  return `MISSION:
${mission}

STARTING TEMPLATE:
A working "${template.name}" template is provided below as a starting point.
Use it as the baseline and adapt it to the specific mission:
- Keep the parts that already work (game loop, CRUD operations, keyboard handling, etc.).
- Modify the UI, features, or behavior to match the mission.
- If the mission asks for something the template doesn't have, ADD it.
- If the mission asks for something simpler than the template, SIMPLIFY it.
- Output the COMPLETE modified HTML — not a diff, not instructions.

TEMPLATE DESCRIPTION:
${template.description}

TEMPLATE HTML:
${template.html}

Now output the complete HTML that fulfills the mission, using the template as a starting point:`
}
