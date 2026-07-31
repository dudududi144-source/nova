import { probeApp } from './src/lib/interaction-probe'

// HTML with a real bug — button click calls undefined function
const htmlWithBug = `<!DOCTYPE html>
<html lang="en">
<head><style>body{background:#0f172a;color:#e2e8f0;font-family:sans-serif;padding:20px}</style></head>
<body>
<main>
<h1>Test App</h1>
<button id="btn1" aria-label="Click me">Click Me</button>
<button id="btn2" aria-label="Reset">Reset</button>
<input type="text" id="input1" aria-label="Name" placeholder="Enter name">
</main>
<script>
document.getElementById('btn1').addEventListener('click', function() {
  // BUG: undefinedFunction doesn't exist
  undefinedFunction();
});
document.getElementById('btn2').addEventListener('click', function() {
  // This one works
  document.getElementById('input1').value = '';
});
</script>
</body>
</html>`

console.log('Testing probe with buggy HTML...')
const result = await probeApp(htmlWithBug, false)
console.log('Probe results:')
console.log('  Errors found:', result.errors.length)
console.log('  Buttons clicked:', result.buttonsClicked)
console.log('  Inputs tested:', result.inputsTested)
console.log('  Summary:', result.summary)
if (result.errors.length > 0) {
  console.log('  First error:', result.errors[0])
}
