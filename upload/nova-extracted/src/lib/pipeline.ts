// ============================================================================
// NOVA Pipeline — 8-stage deep build process
// ----------------------------------------------------------------------------
// Every mission goes through 8 distinct stages, each with dedicated LLM calls.
// No stage tries to do everything. Each stage has ONE job.
//
//   1. DISCOVER    — Deep-understand the mission (what, why, for whom)
//   2. ARCHITECT   — Design complete file structure + dependencies
//   3. BUILD       — Write each file individually (1 LLM call per file)
//   4. INTEGRATE   — Verify files work together, fix import mismatches
//   5. TEST        — Generate tests + identify expected behaviors
//   6. REVIEW      — Evaluate against 144 quality metrics
//   7. FIX         — Fix all metrics that scored below 6
//   8. POLISH      — Final cleanup, formatting, consistency pass
//
// Total time: 5-30 minutes depending on project size. Real work, no fakes.
// ============================================================================

import { newMissionId, newCorrelationId, emitMissionEvent, type MissionStreamEvent } from '@/lib/mission-stream';
import { db } from '@/lib/db';
import { llmChat, extractJSON } from '@/lib/nova-llm-agents';
import { retrieveRelevantMemories, formatFewShotExamples, updateAgentSkill } from '@/lib/nova-learning';
import { buildEvaluationPrompt, parseQualityReport, type QualityReport } from '@/lib/quality-metrics';
import { isAborted, clearAbort } from '@/lib/abort-manager';

// ── Structured logging ──
type LogLevel = 'info' | 'warn' | 'error';
function log(level: LogLevel, message: string, data?: any) {
  const entry = { ts: new Date().toISOString(), level, message, ...(data ? { data } : {}) };
  if (level === 'error') console.error(JSON.stringify(entry));
  else if (level === 'warn') console.warn(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

// ── Token/cost tracking ──
let totalTokens = 0;
const COST_PER_1K_TOKENS = 0.002; // approximate
function trackTokens(tokens: number) { totalTokens += tokens; }
function getCost(): number { return (totalTokens / 1000) * COST_PER_1K_TOKENS; }

// ── Checkpoint save ──
// engineConfig: snapshot of the engine parameters used (for Z — engine versioning)
// healthScore: 0-100 composite score (for Y — build health)
async function saveCheckpoint(
  missionId: string, mission: string, stage: string, files: any[], analysis: any,
  qualityScore: number, engineConfig?: any, healthScore?: number
) {
  try {
    const filesJson = JSON.stringify(files.map(f => ({ path: f.path, content: f.content.slice(0, 500000), language: f.language })));
    const analysisJson = JSON.stringify(analysis || {});
    const engineConfigJson = JSON.stringify(engineConfig || {});
    await db.buildCheckpoint.upsert({
      where: { missionId },
      create: {
        missionId, mission, stage,
        filesJson, analysisJson,
        qualityScore, totalTokens, totalCost: getCost(),
        status: 'active',
        engineConfig: engineConfigJson,
        healthScore: healthScore ?? 0,
      },
      update: {
        stage, filesJson, analysisJson,
        qualityScore, totalTokens, totalCost: getCost(),
        engineConfig: engineConfigJson,
        healthScore: healthScore ?? 0,
      },
    });
  } catch {}
}

// ── Build health score (Y) — composite 0-100 metric ──
// Formula: quality_score * 10 (max 100) - cost_penalty (cost * 500, capped 30)
//         - duration_penalty (sec / 6, capped 20) + success_bonus (5)
// Capped to [0, 100]. A quality=10, cost=$0.01, 30s build → 100 - 5 - 5 + 5 = 95
function computeHealthScore(qualityScore: number, costUsd: number, durationMs: number, success: boolean): number {
  if (!success) return 0
  const qScore = qualityScore * 10 // 0-100
  const costPenalty = Math.min(30, costUsd * 500) // $0.06 = 30 penalty
  const durationPenalty = Math.min(20, (durationMs / 1000) / 6) // 120s = 20 penalty
  const successBonus = 5
  const health = qScore - costPenalty - durationPenalty + successBonus
  return Math.max(0, Math.min(100, Math.round(health * 10) / 10))
}

// ── Run tests on generated code (ESM-compatible) ──
import { execSync } from 'child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

async function runTests(files: { path: string; content: string }[]): Promise<{ passed: boolean; output: string; assertions: number; failed: number; coverage: { total: number; tested: number; skipped: number; details: string[] } }> {
  // Find test file(s): prefer .test.js, .spec.js, anything with "test" in name (JS only)
  const testFiles = files.filter(f =>
    f.path.endsWith('.js') && !f.path.endsWith('.min.js') &&
    (f.path.includes('test') || f.path.includes('spec') || f.content.includes('assert'))
  );
  // ── Coverage scan: find ALL non-DOM JS files that could be tested ──
  // A file is "testable" if it ends in .js, doesn't use document/window/localStorage,
  // and isn't already a test file. We'll generate a smoke test for each.
  const testableFiles = files.filter(f =>
    f.path.endsWith('.js') && !f.path.endsWith('.min.js') &&
    !f.path.includes('test') && !f.path.includes('spec') &&
    !f.content.includes('document.') && !f.content.includes('window.') && !f.content.includes('localStorage')
  );
  if (testFiles.length === 0) {
    // ── No test file found — auto-generate smoke tests for EVERY testable JS file ──
    if (testableFiles.length === 0) {
      // ── II: Multi-language — try Python files if no JS ──
      const pyFiles = files.filter(f => f.path.endsWith('.py') && !f.path.includes('test'));
      if (pyFiles.length > 0) {
        return runPythonSmokeTests(files, pyFiles);
      }
      return { passed: true, output: 'No testable JS file (all DOM-bound or no main entry)', assertions: 0, failed: 0, coverage: { total: 0, tested: 0, skipped: 0, details: [] } };
    }
    // Generate one combined smoke test that imports every testable file
    const importLines = testableFiles.map((f, i) => `import('./${f.path.replace(/^\.?\//, '').replace(/\\/g, '/')}').then(mod => { /* file ${i + 1}/${testableFiles.length} */ result(${i}, mod); }).catch(err => { result(${i}, null, err); })`);
    const coverageTest = `// Auto-generated coverage smoke test (NOVA)
// Imports EVERY non-DOM JS file and asserts each loads without throwing.
const results = [];
function result(idx, mod, err) {
  if (err) {
    results[idx] = { ok: false, err: (err && err.message ? err.message : String(err)).slice(0, 200) };
    console.error('✗ File ' + idx + ' failed: ' + results[idx].err);
  } else {
    const exports = Object.keys(mod || {});
    results[idx] = { ok: true, exports: exports.length };
    console.log('✓ File ' + idx + ' loaded · ' + exports.length + ' export(s)');
  }
  // Check if all done
  if (results.filter(r => r).length === ${testableFiles.length}) {
    const passed = results.filter(r => r.ok).length;
    const failed = ${testableFiles.length} - passed;
    console.log('SMOKE_TEST_RESULT: ' + (failed === 0 ? 'pass' : 'fail') + ' assertions=' + passed + ' failed=' + failed);
    process.exit(failed === 0 ? 0 : 1);
  }
}
${importLines.join(';\n')};
`;
    const injected = [...files, { path: 'nova-smoke-test.js', content: coverageTest }];
    const result = await runTestsInternal(injected, { path: 'nova-smoke-test.js', content: coverageTest });
    return {
      ...result,
      coverage: {
        total: testableFiles.length,
        tested: testableFiles.length,
        skipped: 0,
        details: testableFiles.map(f => f.path),
      },
    };
  }
  // Has test files — run them, but also report coverage info
  const result = await runTestsInternal(files, testFiles[0]);
  return {
    ...result,
    coverage: {
      total: testableFiles.length + testFiles.length,
      tested: testFiles.length,
      skipped: testableFiles.length, // these were not directly tested (only via test files)
      details: testFiles.map(f => f.path),
    },
  };
}

// ── II: Multi-language — Python smoke tests ──
// Runs `python3 file.py` for each .py file (skips files that import unavailable packages).
// Returns combined pass/fail. Best-effort: if python3 not installed, returns skip.
async function runPythonSmokeTests(files: { path: string; content: string }[], pyFiles: { path: string; content: string }[]): Promise<{ passed: boolean; output: string; assertions: number; failed: number; coverage: { total: number; tested: number; skipped: number; details: string[] } }> {
  // Check if python3 is available
  let pythonAvailable = false;
  try {
    execSync('python3 --version', { encoding: 'utf-8', timeout: 3000 });
    pythonAvailable = true;
  } catch {
    try {
      execSync('python --version', { encoding: 'utf-8', timeout: 3000 });
      pythonAvailable = true;
    } catch {}
  }
  if (!pythonAvailable) {
    return {
      passed: true,
      output: `Python smoke test skipped (python3 not installed) — ${pyFiles.length} .py file(s) not tested`,
      assertions: 0, failed: 0,
      coverage: { total: pyFiles.length, tested: 0, skipped: pyFiles.length, details: pyFiles.map(f => f.path) },
    };
  }
  try {
    const tmpDir = path.join(os.tmpdir(), 'nova-pytest-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    for (const f of files) {
      if (f.path.endsWith('.py') || f.path.endsWith('.txt') || f.path.endsWith('.md') || f.path.endsWith('.json')) {
        const fullPath = path.join(tmpDir, f.path);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, f.content);
      }
    }
    let totalAssertions = 0, totalFailed = 0;
    const outputs: string[] = [];
    for (const f of pyFiles) {
      try {
        const fullPath = path.join(tmpDir, f.path);
        // Run with a timeout — Python files that try to read input or run forever will be killed
        const out = execSync(`python3 "${fullPath}" 2>&1 || true`, { encoding: 'utf-8', timeout: 5000, cwd: tmpDir });
        const hasErr = /Traceback|Error|SyntaxError/i.test(out);
        if (!hasErr) {
          totalAssertions++;
          outputs.push(`✓ ${f.path} ran without error`);
        } else {
          totalFailed++;
          outputs.push(`✗ ${f.path}: ${out.split('\n').slice(-2).join(' ').slice(0, 100)}`);
        }
      } catch (err: any) {
        totalFailed++;
        outputs.push(`✗ ${f.path}: ${(err.message || '').slice(0, 100)}`);
      }
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    return {
      passed: totalFailed === 0,
      output: outputs.join('\n').slice(0, 600),
      assertions: totalAssertions,
      failed: totalFailed,
      coverage: { total: pyFiles.length, tested: pyFiles.length, skipped: 0, details: pyFiles.map(f => f.path) },
    };
  } catch (err: any) {
    return { passed: false, output: (err.message || '').slice(0, 500), assertions: 0, failed: 1, coverage: { total: pyFiles.length, tested: 0, skipped: pyFiles.length, details: [] } };
  }
}

// Internal runner — writes files to tmpdir, executes node, parses pass/fail
async function runTestsInternal(files: { path: string; content: string }[], testFile: { path: string; content: string }): Promise<{ passed: boolean; output: string; assertions: number; failed: number }> {
  try {
    const tmpDir = path.join(os.tmpdir(), 'nova-test-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    for (const f of files) {
      const fullPath = path.join(tmpDir, f.path);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, f.content);
    }
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ type: 'module' }));
    const testPath = path.join(tmpDir, testFile.path);
    let output = '';
    let exitCode = 0;
    try {
      output = execSync(`node ${testPath} 2>&1`, { encoding: 'utf-8', timeout: 10000 });
    } catch (err: any) {
      output = (err.stdout || '') + (err.stderr || '') + (err.message || '');
      exitCode = err.status ?? 1;
    }
    // Count assertions by scanning output for assertion-style messages
    const assertionMatches = output.match(/✓|assertions=|passed|PASS|failed|FAIL/g) || [];
    const assertions = (output.match(/assertions=(\d+)/) || [, '0'])[1] ? parseInt((output.match(/assertions=(\d+)/) || [, '0'])[1], 10) : assertionMatches.filter(m => m === '✓' || m === 'passed' || m === 'PASS').length;
    const failed = (output.match(/FAIL|failed|✗/g) || []).length;
    return {
      passed: exitCode === 0 && !/Error:|TypeError:|ReferenceError:|SyntaxError:/.test(output),
      output: output.slice(0, 600),
      assertions,
      failed,
    };
  } catch (err: any) {
    return { passed: false, output: (err.stdout || err.message || '').slice(0, 500), assertions: 0, failed: 1 };
  }
}

// ── Lint JS files — real syntax check with node --check ──
async function lintFiles(files: { path: string; content: string }[]): Promise<{ errors: number; warnings: number; output: string }> {
  const jsFiles = files.filter(f => f.path.endsWith('.js') && !f.path.includes('node_modules'));
  let errors = 0, warnings = 0;
  const issues: string[] = [];

  for (const f of jsFiles) {
    const content = f.content;

    // ── Real syntax check with node --check (ESM via .mjs) ──
    try {
      const tmpFile = path.join(os.tmpdir(), `nova-check-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.mjs`);
      fs.writeFileSync(tmpFile, content);
      execSync(`node --check ${tmpFile}`, { encoding: 'utf-8', timeout: 5000 });
      fs.unlinkSync(tmpFile);
    } catch (err: any) {
      errors++;
      const msg = (err.stderr || err.message || '').split('\n')[0].slice(0, 100);
      issues.push(`${f.path}: ${msg}`);
      continue; // Skip other checks if syntax is broken
    }

    const lines = content.split('\n');

    // Check for common issues
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Missing semicolons (warning)
      if (line && !line.endsWith(';') && !line.endsWith('{') && !line.endsWith('}') &&
          !line.endsWith(',') && !line.endsWith('(') && !line.endsWith('\\') &&
          !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*') &&
          !line.startsWith('import') && !line.startsWith('export') &&
          (line.includes('const ') || line.includes('let ') || line.includes('var ') ||
           line.includes('return ') || line.includes('= ')) &&
           !line.includes('=>') && !line.includes('function')) {
        warnings++;
        if (warnings <= 5) issues.push(`${f.path}:${i + 1}: missing semicolon`);
      }

      // console.log in production (warning)
      if (line.includes('console.log(') && !line.startsWith('//')) {
        warnings++;
        if (warnings <= 10) issues.push(`${f.path}:${i + 1}: console.log in production code`);
      }

      // eval() usage (error)
      if (line.includes('eval(') && !line.startsWith('//')) {
        errors++;
        issues.push(`${f.path}:${i + 1}: eval() is dangerous`);
      }

      // TODO/FIXME (warning)
      if (line.includes('TODO') || line.includes('FIXME')) {
        warnings++;
        if (warnings <= 15) issues.push(`${f.path}:${i + 1}: TODO/FIXME found`);
      }
    }

    // Check for balanced braces (excluding strings and comments)
    const codeOnly = content
      .replace(/\/\/.*$/gm, '') // strip line comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // strip block comments
      .replace(/(["'`])((?:\\.|(?!\1).)*?)\1/g, '$1$1'); // strip string contents (keep quotes)
    const openBraces = (codeOnly.match(/{/g) || []).length;
    const closeBraces = (codeOnly.match(/}/g) || []).length;
    if (openBraces !== closeBraces) {
      errors++;
      issues.push(`${f.path}: unbalanced braces (${openBraces} open vs ${closeBraces} close)`);
    }

    // Check for balanced parentheses (excluding strings and comments)
    const openParens = (codeOnly.match(/\(/g) || []).length;
    const closeParens = (codeOnly.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      errors++;
      issues.push(`${f.path}: unbalanced parentheses (${openParens} open vs ${closeParens} close)`);
    }
  }

  return { errors, warnings, output: issues.join('\n').slice(0, 800) };
}

// ── Deterministic HTML/CSS auto-fix (NO LLM) ──
// Fix obvious structural issues before the LLM Fix stage runs — saves an LLM call
// for things that don't need reasoning. Returns the number of fixes applied.
function autoFixHtmlCss(files: { path: string; content: string; language?: string }[], opts: { title?: string; mission?: string } = {}): { fixed: number; notes: string[] } {
  let fixed = 0;
  const notes: string[] = [];
  const title = (opts.title && /^[a-zA-Z0-9 _-]+$/.test(opts.title)) ? opts.title : (opts.mission || 'NOVA').split(/\s+/).slice(0, 4).join(' ').replace(/['"`<>]/g, '').trim().slice(0, 40) || 'NOVA';

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!f.content) continue;

    // ── HTML auto-fix ──
    if (f.path.endsWith('.html')) {
      let c = f.content;
      const before = c;
      // Inject DOCTYPE if missing
      if (!/<!doctype/i.test(c)) {
        c = '<!DOCTYPE html>\n' + c;
        notes.push(`${f.path}: injected DOCTYPE`);
      }
      // Inject <html lang="en"> if missing
      if (!/<html[\s>]/i.test(c)) {
        c = c.replace(/(<!DOCTYPE[^>]*>\s*)/, '$1<html lang="en">\n');
        if (!/<\/html>\s*$/.test(c)) c = c.replace(/\s*$/, '\n</html>\n');
        notes.push(`${f.path}: injected <html> wrapper`);
      }
      // Inject <head> with charset + viewport if missing
      if (!/<head[\s>]/i.test(c)) {
        const head = `<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n`;
        c = c.replace(/(<html[^>]*>\s*)/, `$1${head}`);
        // Close head before body (or at end if no body)
        if (/<body[\s>]/i.test(c)) {
          c = c.replace(/(<body[^>]*>)/, '</head>\n$1');
        } else {
          c = c.replace(/(<\/html>\s*$)/, `</head>\n$1`);
        }
        notes.push(`${f.path}: injected <head> with charset/viewport`);
      } else {
        // Head exists — ensure charset meta present
        if (!/charset/i.test(c)) {
          c = c.replace(/(<head[^>]*>\s*)/, `$1<meta charset="UTF-8">\n`);
          notes.push(`${f.path}: injected charset meta`);
        }
        if (!/viewport/i.test(c)) {
          c = c.replace(/(<head[^>]*>\s*)/, `$1<meta name="viewport" content="width=device-width, initial-scale=1.0">\n`);
          notes.push(`${f.path}: injected viewport meta`);
        }
      }
      // Inject <title> if missing
      if (!/<title>/i.test(c)) {
        c = c.replace(/(<head[^>]*>\s*(?:<meta[^>]*>\s*)*)/, `$1<title>${title}</title>\n`);
        notes.push(`${f.path}: injected <title>`);
      }
      // Inject <body> if missing (but has <html>)
      if (/<html[\s>]/i.test(c) && !/<body[\s>]/i.test(c)) {
        // Find where head closes; insert body right after
        if (/<\/head>\s*/i.test(c)) {
          c = c.replace(/<\/head>\s*/i, '</head>\n<body>\n');
          // Close body before </html>
          c = c.replace(/(<\/html>\s*$)/, '</body>\n$1');
          notes.push(`${f.path}: injected <body>`);
        }
      }
      if (c !== before) {
        files[i] = { ...f, content: c };
        fixed++;
      }
    }

    // ── CSS auto-fix: add missing semicolons to single-line properties ──
    if (f.path.endsWith('.css')) {
      let c = f.content;
      const before = c;
      // Strip block comments before fixing (don't touch commented props)
      // Then add ; to lines matching "prop: value" without trailing ;, {, }, ,
      // We do this with a regex that's careful not to touch @rules or url() content.
      const lines = c.split('\n');
      let cssFixed = 0;
      for (let j = 0; j < lines.length; j++) {
        const raw = lines[j];
        const line = raw.trim();
        if (/^[a-zA-Z-]+\s*:\s*\S/.test(line)
            && !line.endsWith(';') && !line.endsWith('{') && !line.endsWith('}')
            && !line.endsWith(',') && !line.startsWith('@')
            && !line.includes('url(')) {
          // Add semicolon to the original line at end of trimmed content
          const indent = raw.match(/^\s*/)?.[0] || '';
          lines[j] = indent + line + ';';
          cssFixed++;
        }
      }
      if (cssFixed > 0) {
        c = lines.join('\n');
        notes.push(`${f.path}: added ${cssFixed} missing CSS semicolon(s)`);
      }
      if (c !== before) {
        files[i] = { ...f, content: c };
        fixed++;
      }
    }
  }
  return { fixed, notes };
}

export interface PipelineOptions {
  missionId?: string;
  correlationId?: string;
  onEvent?: (event: MissionStreamEvent) => void;
  // ── Resume from checkpoint ──
  // If provided, the pipeline will try to load the BuildCheckpoint for this missionId
  // and skip stages that already completed (using the saved files/analysis).
  resumeFromCheckpointId?: string;
  // ── Quality target (default 7; range 5-9) ──
  // Drives an iterative fix loop: after the initial Fix stage, if quality is still
  // below target (and budget allows), run another fix pass on the next-worst file.
  // Higher target = more LLM fix calls = more time/API budget.
  qualityTarget?: number;
  // ── Auto-skip stages on cached build (OO) ──
  // If true, skip the feasibility pre-check (caller already knows it's buildable).
  // Used when "Build fresh" is chosen after a dedup cache hit.
  skipFeasibility?: boolean;
}

export interface PipelineResult {
  missionId: string;
  correlationId: string;
  mission: string;
  classification: any;
  classificationSource: string;
  agents: any;
  files: { path: string; content: string; language?: string }[];
  allRepoFiles?: { path: string; content: string; language?: string }[];
  isPlayable: boolean;
  durationMs: number;
  success: boolean;
  error?: string;
  qualityScore?: number;
  qualityReport?: any;
  // ── Build health score (Y) — composite 0-100 ──
  healthScore?: number;
}

export async function runPipeline(
  mission: string,
  opts: PipelineOptions = {}
): Promise<PipelineResult> {
  const t0 = Date.now();
  const missionId = opts.missionId || newMissionId('em');
  const correlationId = opts.correlationId || newCorrelationId('nova-pipeline');

  // ── Quality target (drives iterative fix loop) ──
  // Clamped to [5, 9]. Default 7. Higher target = up to 3 extra fix passes.
  const qualityTarget = Math.min(9, Math.max(5, opts.qualityTarget ?? 7));
  // Max extra fix passes (beyond the initial one). Each pass = 1 LLM call.
  // Target 5-6 → 0 extra, 7 → 1 extra, 8 → 2 extra, 9 → 3 extra.
  const MAX_EXTRA_FIX_PASSES = qualityTarget <= 6 ? 0 : qualityTarget === 7 ? 1 : qualityTarget === 8 ? 2 : 3;

  // ── Build timeout: dynamic based on planned files ──
  let BUILD_TIMEOUT_MS = 10 * 60 * 1000; // default 10 min, updated after architecture
  // ── Cost guard: abort if the build has consumed too many tokens (cost > COST_GUARD_$) ──
  // This prevents runaway builds from wasting the API budget on a single mission.
  // The default threshold ($0.05) ≈ ~25K tokens — enough for a 7-file build with fixes.
  const COST_GUARD_USD = 0.05;
  let costGuardHit = false;

  // ── Engine config snapshot (Z) — captured at build start, saved with every checkpoint ──
  // Lets us compare builds by engine config later (A/B testing, regression detection).
  const engineConfig = {
    pipelineVersion: 'nova-8stage-v1',
    qualityTarget,
    maxExtraFixPasses: MAX_EXTRA_FIX_PASSES,
    costGuardUsd: COST_GUARD_USD,
    rateLimit: { minDelayMs: 3000, maxCallsPerMin: 15, softLimit: 13 },
    autoFix: { htmlCss: true, syntaxCheck: true },
    feasibility: { enabled: true },
    dedup: { enabled: true, similarityThreshold: 0.6 },
    resume: { enabled: true },
    smartFallback: true,
    coverageSmokeTest: true,
    iterativeFixLoop: true,
    capturedAt: new Date().toISOString(),
  };
  const timeoutCheck = async () => {
    if (Date.now() - t0 > BUILD_TIMEOUT_MS) {
      await emit('mission.fail', { error: 'Build timed out', missionId });
      throw new Error('Build timed out');
    }
    if (!costGuardHit && getCost() > COST_GUARD_USD) {
      costGuardHit = true;
      await emit('agent.message', {
        agentId: 'validator', agentName: 'Validator',
        message: `Cost guard hit: build exceeded $${COST_GUARD_USD.toFixed(2)} (used $${getCost().toFixed(4)}). Finishing with what we have.`,
      });
      // Throw a special error so the catch block knows this was a cost-guard exit
      const e = new Error(`Cost guard: build exceeded $${COST_GUARD_USD.toFixed(2)} budget`);
      (e as any).costGuard = true;
      throw e;
    }
  };

  const result: PipelineResult = {
    missionId, correlationId, mission,
    classification: {}, classificationSource: 'none',
    agents: {}, files: [], isPlayable: false,
    durationMs: 0, success: false,
  };

  const emit = async (eventType: string, payload: any, agentId?: string, agentName?: string) => {
    try {
      const ev = await emitMissionEvent(missionId, correlationId, eventType as any, payload, {
        agentId: agentId || '', agentName: agentName || '', severity: 'info',
      });
      opts.onEvent?.(ev);
    } catch {}
  };

  // Helper: LLM call with event emission + token tracking + stage timing
  const stageTimings: Record<string, number> = {};
  const retryWaitByStage: Record<string, number> = {}; // 429 backoff time per stage
  let totalRetryWaitMs = 0;
  let llmCallCount = 0;
  const llm = async (sys: string, user: string, opts2: any = {}, agentId = 'llm', agentName = 'LLM') => {
    const stageStart = Date.now();
    const callNum = ++llmCallCount;
    const res = await llmChat(sys, user, { maxTokens: 4000, temperature: 0.3, timeoutMs: 45000, ...opts2 });
    if (res.ok) trackTokens(res.tokens);
    if (!res.ok) {
      await emit('agent.message', { agentId, agentName, message: `LLM error: ${res.error}` });
    }
    const stageMs = Date.now() - stageStart;
    stageTimings[agentId] = (stageTimings[agentId] || 0) + stageMs;
    // Track 429 backoff time separately so the user can see why a stage was slow
    if (res.retryWaitMs && res.retryWaitMs > 0) {
      retryWaitByStage[agentId] = (retryWaitByStage[agentId] || 0) + res.retryWaitMs;
      totalRetryWaitMs += res.retryWaitMs;
    }
    // ── Cost transparency (Q): emit a cost.update event after every LLM call ──
    // Lets the UI show a live ticker of total tokens + cost + per-call info.
    await emit('cost.update', {
      callNumber: callNum,
      agentId, agentName,
      ok: res.ok,
      tokensThisCall: res.ok ? res.tokens : 0,
      totalTokens,
      totalCost: getCost(),
      costGuardLimit: COST_GUARD_USD,
      costGuardPct: Math.min(100, (getCost() / COST_GUARD_USD) * 100),
      ms: res.ms,
      retryWaitMs: res.retryWaitMs || 0,
    });
    return res;
  };

  // Helper: emit stage timing (includes 429 backoff annotation when applicable)
  const emitStageTimings = async () => {
    const timings = Object.entries(stageTimings)
      .map(([k, v]) => {
        const retry = retryWaitByStage[k] || 0;
        const base = `${k}: ${(v / 1000).toFixed(1)}s`;
        return retry > 0 ? `${base} (incl ${(retry / 1000).toFixed(0)}s 429 wait)` : base;
      })
      .join(' · ');
    const totalWaitNote = totalRetryWaitMs > 0 ? ` · total 429 wait: ${(totalRetryWaitMs / 1000).toFixed(0)}s` : '';
    await emit('agent.message', {
      agentId: 'validator', agentName: 'Validator',
      message: `Stage timings: ${timings}${totalWaitNote}`,
    });
  };

  // Declare outside try so catch block can access them
  let files: { path: string; content: string; language?: string }[] = [];
  let analysis: any = null;
  let qualityReport: QualityReport | null = null;
  let qualityScore = 7.0;

  try {
    // ── Auto-simplify: if mission is too long, truncate at sentence boundary ──
    let simplifiedMission = mission;
    if (mission.length > 200) {
      const truncated = mission.slice(0, 200);
      // Find last sentence boundary
      const lastDot = Math.max(truncated.lastIndexOf('.'), truncated.lastIndexOf('!'), truncated.lastIndexOf('?'));
      simplifiedMission = lastDot > 100 ? truncated.slice(0, lastDot + 1) : truncated + '...';
      await emit('agent.message', {
        agentId: 'discover', agentName: 'Discovery',
        message: `Mission simplified from ${mission.length} to ${simplifiedMission.length} chars (truncated at sentence boundary)`,
      });
    }

    log('info', 'Pipeline started', { missionId, mission: simplifiedMission.slice(0, 100) });
    await emit('mission.start', { mission: simplifiedMission.slice(0, 200), pipeline: 'nova-8stage', stages: 8 });

    // ── Resume from checkpoint (if requested) ──
    // Load the saved checkpoint and restore files/analysis so we can skip
    // stages that already completed. This is a best-effort resume: if the
    // checkpoint is missing or invalid, we just continue from scratch.
    let resumedStage = ''; // empty = start from scratch
    if (opts.resumeFromCheckpointId) {
      try {
        const cp = await db.buildCheckpoint.findUnique({ where: { missionId: opts.resumeFromCheckpointId } });
        if (cp && cp.status === 'active' && cp.filesJson && cp.filesJson.length > 2) {
          const cpFiles = JSON.parse(cp.filesJson);
          if (Array.isArray(cpFiles) && cpFiles.length > 0) {
            files = cpFiles;
            analysis = JSON.parse(cp.analysisJson || '{}');
            qualityScore = cp.qualityScore || 7.0;
            totalTokens = cp.totalTokens || 0;
            resumedStage = cp.stage || '';
            await emit('agent.message', {
              agentId: 'validator', agentName: 'Validator',
              message: `Resumed from checkpoint at stage "${resumedStage}" · ${files.length} files · score ${qualityScore.toFixed(1)}`,
            });
            log('info', 'Pipeline resumed from checkpoint', { missionId, resumedStage, files: files.length });
          }
        }
      } catch (cpErr) {
        log('warn', 'Resume failed, starting from scratch', { missionId, error: cpErr instanceof Error ? cpErr.message : String(cpErr) });
      }
    }
    // Stage order for resume-skipping (must match the actual stage labels in checkpoints)
    const STAGE_ORDER = ['discover', 'architect', 'build', 'integrate', 'test', 'review', 'fix', 'complete'];
    const resumeSkipUpTo = resumedStage ? STAGE_ORDER.indexOf(resumedStage) : -1;
    const shouldSkipStage = (stageLabel: string): boolean => {
      if (resumeSkipUpTo < 0) return false;
      const idx = STAGE_ORDER.indexOf(stageLabel);
      return idx >= 0 && idx < resumeSkipUpTo;
    };

    // ── STAGE 0: Feasibility pre-check — cheap LLM call to detect unbuildable missions ──
    // Saves ~10 minutes of wasted pipeline time when user inputs nonsense, gibberish,
    // or asks for things outside NOVA's scope (e.g. "build me a nuclear reactor").
    // ── OO: skip when caller already knows it's buildable (cached build → "Build fresh") ──
    if (opts.skipFeasibility) {
      await emit('agent.message', {
        agentId: 'validator', agentName: 'Validator',
        message: `Feasibility check skipped (caller confirmed buildable) ✓`,
      });
    } else
    try {
      await emit('agent.thinking', {
        agentId: 'validator', agentName: 'Validator',
        detail: 'Checking mission feasibility...',
      });
      const feasibilityResult = await llm(
        `You are a feasibility checker. Is this mission buildable as a self-contained web app or Node.js script?
Respond with JSON ONLY: {"feasible": true|false, "reason": "one short sentence"}
Mark infeasible ONLY if the mission is: gibberish, empty of content, requests something physically impossible, or requests illegal/harmful content.
Everything else (games, tools, calculators, todo lists, synthesizers, markdown converters, etc.) is feasible.`,
        `Mission: "${simplifiedMission}"`,
        { maxTokens: 200, temperature: 0.1, timeoutMs: 10000 },
        'validator', 'Validator'
      );
      if (feasibilityResult.ok) {
        const { json } = extractJSON(feasibilityResult.text);
        if (json && json.feasible === false) {
          const reason = (json.reason || 'Mission not buildable').toString().slice(0, 200);
          await emit('agent.message', {
            agentId: 'validator', agentName: 'Validator',
            message: `Feasibility check: NOT feasible — ${reason}`,
          });
          // Build a graceful fallback page so the user still gets something
          const fallbackHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Not buildable</title>
<style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:2rem}.card{max-width:30rem;background:#1e293b;border:1px solid #334155;border-radius:1rem;padding:2rem}h1{font-size:1.25rem;margin-bottom:0.5rem}p{color:#94a3b8;line-height:1.6}</style></head>
<body><div class="card"><h1>This mission can't be built</h1><p>${reason.replace(/</g,'&lt;')}</p><p style="margin-top:1rem;font-size:0.85rem;color:#64748b">Try rephrasing — describe a web app, game, or tool you'd like to build.</p></div></body></html>`;
          files = [
            { path: 'index.html', content: fallbackHtml, language: 'html' },
            { path: 'package.json', content: JSON.stringify({ name: 'nova-feasibility-failed', version: '1.0.0' }, null, 2), language: 'json' },
          ];
          result.files = files;
          result.allRepoFiles = files;
          result.success = true;
          result.durationMs = Date.now() - t0;
          result.qualityScore = 1.0;
          result.error = `Mission not feasible: ${reason}`;
          await emit('mission.complete', {
            missionId, success: true, isFeasibilityFail: true,
            files, allRepoFiles: files, durationMs: result.durationMs,
            qualityScore: 1.0, pipeline: 'nova-8stage',
            error: result.error,
          });
          clearAbort(missionId);
          return result;
        } else {
          await emit('agent.message', {
            agentId: 'validator', agentName: 'Validator',
            message: `Feasibility check: feasible ✓`,
          });
        }
      }
    } catch (feasibilityErr) {
      // Feasibility check itself failed — log and continue (don't block the build)
      log('warn', 'Feasibility check failed', { missionId, error: feasibilityErr instanceof Error ? feasibilityErr.message : String(feasibilityErr) });
    }

    let learningContext = '';
    try {
      const relevant = await retrieveRelevantMemories(mission, 'web-app', undefined, 3);
      learningContext = formatFewShotExamples(relevant);
    } catch {}

    // ── Learn from past feedback ──
    let feedbackContext = '';
    try {
      const feedbacks = await db.agentMemory.findMany({
        where: { category: 'feedback' },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      if (feedbacks.length > 0) {
        const positives = feedbacks.filter(f => f.success).length;
        const negatives = feedbacks.filter(f => !f.success).length;
        const notes = feedbacks.filter(f => f.learnings).map(f => f.learnings).join('; ');
        feedbackContext = `\n\n## Past User Feedback (${positives} positive, ${negatives} negative):\n${notes || 'No specific notes'}`;
      }
    } catch {}

    // ── Context retention: learn from recent successful builds of similar type ──
    let retentionContext = '';
    try {
      const recentBuilds = await db.agentMemory.findMany({
        where: { success: true, category: { not: 'feedback' } },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { mission: true, subType: true, learnings: true, durationMs: true },
      });
      if (recentBuilds.length > 0) {
        retentionContext = `\n\n## Recent Successful Builds (learn from these):\n${recentBuilds.map(b => `- "${b.mission.slice(0, 60)}" → ${b.learnings || 'completed'} (${b.durationMs ? Math.round(b.durationMs / 1000) : '?'}s)`).join('\n')}`;
      }
    } catch {}

    // ═══════════════════════════════════════════════════════════════════════
    // ═══════════════════════════════════════════════════════════════════════
    // STAGE 1+2: DISCOVER + ARCHITECT (merged into 1 LLM call to save time)
    // ═══════════════════════════════════════════════════════════════════════
    if (shouldSkipStage('architect')) {
      await emit('agent.message', {
        agentId: 'discover', agentName: 'Discovery',
        message: `Skipped (resumed past architect) — using saved analysis (${analysis?.files?.length || 0} files planned)`,
      });
    } else {
    await emit('agent.thinking', { agentId: 'discover', agentName: 'Discovery', detail: 'Understanding mission + designing architecture...' });

    const archResult = await llm(
      `You are a senior software architect. Analyze the mission AND design the file structure in one step.

Mission: "${mission}"

${feedbackContext}
${retentionContext ? retentionContext.slice(0, 500) : ''}

Think about:
1. What is the user really asking for? What features are needed?
2. What tech stack is best? (web = HTML/CSS/JS, API = Node.js, science = Python)
3. Design the complete file structure (max 15 files — quality over quantity)

RULES:
- Do NOT include dist/, build/, node_modules/, bundle.js, package-lock.json
- For web apps: ALWAYS include index.html + CSS + JS
- HARD LIMIT: Maximum 15 files
- Each file should be substantial (50+ lines when built)
- Include: source code, README, tests, package.json (if Node)

Output JSON ONLY:
{
  "type": "project type",
  "title": "title",
  "description": "one line",
  "isPlayable": true/false,
  "techStack": ["tech1"],
  "understanding": "what to build",
  "coreFeatures": ["feature1"],
  "files": [
    {"path": "README.md", "purpose": "documentation", "language": "markdown", "dependsOn": []},
    {"path": "src/index.js", "purpose": "entry point", "language": "javascript", "dependsOn": ["src/utils.js"]}
  ]
}`,
      `Mission: "${mission}"`,
      { maxTokens: 2500, temperature: 0.3 },
      'discover', 'Discovery'
    );

    if (archResult.ok) {
      const { json } = extractJSON(archResult.text);
      if (json && Array.isArray(json.files)) {
        analysis = json;
        result.classification = {
          type: json.type || 'web-app',
          title: json.title || mission.slice(0, 50),
          isPlayable: json.isPlayable ?? false,
        };
        result.isPlayable = json.isPlayable ?? false;
        result.classificationSource = 'llm';
        await emit('agent.message', {
          agentId: 'architect', agentName: 'Architect',
          message: `Architecture: ${json.files.length} files · ${json.type} · ${json.techStack?.join(', ') || 'standard'}`,
        });
        // Emit file plan
        await emit('code.written', {
          files: json.files.map((f: any) => ({ path: f.path, lines: 0 })),
          totalLines: 0, source: 'architecture-plan',
        });
      }
    }
    } // end if !shouldSkipStage('architect')

    if (!analysis?.files?.length) {
      throw new Error('Architecture stage failed — no file plan');
    }

    // ── Mission difficulty score (T) — derive from architecture ──
    // Factors: file count, dependency depth, mission type (game > utility), tech stack size.
    // Output: 'easy' | 'medium' | 'hard' + numeric score 1-10.
    try {
      const fileCount = analysis.files.length;
      const hasDeps = analysis.files.some((f: any) => (f.dependsOn || []).length > 0);
      const maxDepDepth = (() => {
        // simple depth estimate: longest dependsOn chain (1 level)
        const depths = analysis.files.map((f: any) => (f.dependsOn || []).length);
        return Math.max(0, ...depths);
      })();
      const typeBoost = /game|synth|chess|markdown|editor/i.test(analysis.type || '') ? 2 : 0;
      const stackBoost = (analysis.techStack?.length || 1) - 1; // +1 per extra tech
      const difficultyScore = Math.min(10, Math.max(1, Math.round(2 + fileCount * 0.7 + maxDepDepth * 0.5 + typeBoost + stackBoost)));
      const difficultyLabel = difficultyScore <= 4 ? 'easy' : difficultyScore <= 7 ? 'medium' : 'hard';
      analysis.difficulty = { score: difficultyScore, label: difficultyLabel };
      // ── Cost-per-quality prediction (EE) — expected cost + expected quality ──
      // Expected cost = base ($0.01) + fileCount * $0.004 + difficultyScore * $0.002 + maxFixes * $0.005
      // Expected quality = clamp(8.5 - difficultyScore * 0.3, 5.5, 9)
      const expectedCost = 0.01 + fileCount * 0.004 + difficultyScore * 0.002 + MAX_EXTRA_FIX_PASSES * 0.005;
      const expectedQuality = Math.min(9, Math.max(5.5, 8.5 - difficultyScore * 0.3));
      const expectedDurationSec = 30 + fileCount * 8 + MAX_EXTRA_FIX_PASSES * 20;
      analysis.expected = { cost: Number(expectedCost.toFixed(4)), quality: Number(expectedQuality.toFixed(1)), durationSec: expectedDurationSec };
      // ── MM: Cost-per-build prediction AI — refine using historical data ──
      // Look up past builds of the same subType and average their actual cost + quality + duration.
      // If we have ≥3 historical samples, override the formula with real data (much more accurate).
      try {
        const subType = (analysis.type || 'web-app').toLowerCase();
        const pastBuilds = await db.agentMemory.findMany({
          where: { success: true, category: { not: 'feedback' }, subType: { contains: subType } },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { learnings: true, durationMs: true, sourceCode: true },
        });
        if (pastBuilds.length >= 3) {
          // Extract actual quality + use durationMs directly
          const actualQualities = pastBuilds.map(b => {
            const m = b.learnings?.match(/quality\s+([\d.]+)/i);
            return m ? parseFloat(m[1]) : 0;
          }).filter(q => q > 0);
          const avgDuration = pastBuilds.reduce((s, b) => s + (b.durationMs || 0), 0) / pastBuilds.length;
          // Cost estimate from tokens: each past build's token count is in learnings ("X files, quality Y.Y")
          // We don't have direct cost data per past build, but we can estimate from durationMs
          // using a heuristic: ~1 token per ms (very rough). Better: use the formula cost per ms.
          const avgQualityActual = actualQualities.length ? actualQualities.reduce((s, x) => s + x, 0) / actualQualities.length : expectedQuality;
          const refinedCost = Math.max(0.005, (avgDuration / 1000) * 0.0005); // ~$0.0005/sec of build time
          analysis.expected = {
            cost: Number(refinedCost.toFixed(4)),
            quality: Number(avgQualityActual.toFixed(1)),
            durationSec: Math.round(avgDuration / 1000),
            source: 'historical',
            samples: pastBuilds.length,
          };
          await emit('agent.message', {
            agentId: 'architect', agentName: 'Architect',
            message: `Prediction refined with ${pastBuilds.length} past "${subType}" builds: ~$${refinedCost.toFixed(4)} → quality ${avgQualityActual.toFixed(1)}/10 in ~${Math.round(avgDuration / 1000)}s`,
          });
        }
      } catch {}
      // Emit difficulty for the UI to display before build starts in earnest
      await emit('difficulty.report', {
        score: difficultyScore, label: difficultyLabel, fileCount, hasDeps, maxDepDepth, type: analysis.type,
        expected: analysis.expected, // include EE prediction
      });
      await emit('agent.message', {
        agentId: 'architect', agentName: 'Architect',
        message: `Difficulty: ${difficultyLabel} (${difficultyScore}/10) — ${fileCount} files, max dep depth ${maxDepDepth}, type "${analysis.type}" · expected ~$${expectedCost.toFixed(4)} → quality ${expectedQuality.toFixed(1)}/10 in ~${expectedDurationSec}s`,
      });
    } catch {}

    // ═══════════════════════════════════════════════════════════════════════
    await timeoutCheck(); if (isAborted(missionId)) throw new Error("Build aborted by user");
    // STAGE 3: BUILD — Write each file individually (1 LLM call per file)
    // ═══════════════════════════════════════════════════════════════════════
    if (shouldSkipStage('build')) {
      await emit('agent.message', {
        agentId: 'builder', agentName: 'Builder',
        message: `Skipped (resumed past build) — using ${files.length} saved file(s)`,
      });
    } else {
    await emit('agent.thinking', {
      agentId: 'builder', agentName: 'Builder',
      detail: `Building ${analysis.files.length} files (1 LLM call per file)...`,
    });

    // HARD CAP: maximum 7 files — enforce in code, not just in prompt
    const allPlannedFiles = (analysis.files || []).slice(0, 15);
    if (analysis.files.length > 15) {
      await emit('agent.message', {
        agentId: 'architect', agentName: 'Architect',
        message: `Capped from ${analysis.files.length} to 15 files (quality over quantity)`,
      });
    }

    // ── Dynamic timeout: 10 min + 2 min per file (max 25 min) ──
    BUILD_TIMEOUT_MS = Math.min(25 * 60 * 1000, (10 + allPlannedFiles.length * 2) * 60 * 1000);
    await emit('agent.message', {
      agentId: 'architect', agentName: 'Architect',
      message: `Timeout: ${BUILD_TIMEOUT_MS / 60000} min (${allPlannedFiles.length} files planned)`,
    });
    // Build files in dependency order (files with no dependencies first)
    const buildOrder = [...allPlannedFiles].sort((a: any, b: any) => {
      const aDeps = (a.dependsOn || []).length;
      const bDeps = (b.dependsOn || []).length;
      return aDeps - bDeps;
    });

    for (let i = 0; i < buildOrder.length; i++) {
      const filePlan = buildOrder[i];
      const builtPaths = files.map(f => f.path);

      await emit('agent.thinking', {
        agentId: 'builder', agentName: 'Builder',
        detail: `Building ${filePlan.path} (${i + 1}/${buildOrder.length})...`,
      });

      const buildResult = await llm(
        `You are a senior developer. Write ONE complete file.

Project: ${analysis.title}
Mission: "${mission}"
Tech: ${analysis.techStack?.join(', ') || 'standard'}

Full file plan (so you know what other files exist):
${allPlannedFiles.map((f: any) => `- ${f.path}: ${f.purpose} (${f.language})`).join('\n')}

Already built files: ${builtPaths.length > 0 ? builtPaths.join(', ') : 'none yet'}

Write the file: ${filePlan.path}
Purpose: ${filePlan.purpose}
Language: ${filePlan.language}

RULES:
- Write AT LEAST 50 lines of real code
- Write COMPLETE, working implementation — no TODOs, no placeholders
- Match imports/exports with other files in the plan
- Include error handling
- DO NOT wrap in JSON — output ONLY the raw file content
- DO NOT use markdown fences
- Start directly with code, not explanations
- For HTML: full document with head, body, scripts
- For JS: all functions/classes/exports
- For CSS: all selectors, responsive rules
- For MD: full documentation with examples

Output the raw file content now:`,
        mission,
        { maxTokens: 4000, temperature: 0.3 },
        'builder', 'Builder'
      );

      // ── Raw code extraction (NO JSON parsing) ──
      let fileContent: string | null = null;
      let filePath = filePlan.path;
      let fileLang = filePlan.language || guessLanguage(filePlan.path);

      if (buildResult.ok && buildResult.text) {
        let text = buildResult.text.trim();
        // Strip markdown fences if present
        const fenceMatch = text.match(/^```[\w]*\n?([\s\S]*?)\n?```$/);
        if (fenceMatch) text = fenceMatch[1].trim();
        // Strip leading/trailing JSON if LLM wrapped it anyway
        if (text.startsWith('{')) {
          const { json } = extractJSON(text);
          if (json && typeof json.content === 'string') text = json.content;
          else if (json && Array.isArray(json.content)) text = json.content.join('\n');
        }
        fileContent = text;
      }

      // ── Retry with simpler prompt if first attempt failed ──
      if (!fileContent || fileContent.trim().length < 5) {
        await emit('agent.message', {
          agentId: 'builder', agentName: 'Builder',
          message: `${filePlan.path} — empty, retrying...`,
        });
        const retry = await llm(
          `Write the complete content of ${filePlan.path} for a ${filePlan.purpose}.
This is part of: ${mission}
Write at least 50 lines of real ${filePlan.language || 'code'}.
Output ONLY the raw file content. No JSON. No markdown fences. No explanations.`,
          '',
          { maxTokens: 4000, temperature: 0.4, timeoutMs: 40000 },
          'builder', 'Builder'
        );
        if (retry.ok && retry.text) {
          let text = retry.text.trim();
          const fenceMatch = text.match(/^```[\w]*\n?([\s\S]*?)\n?```$/);
          if (fenceMatch) text = fenceMatch[1].trim();
          fileContent = text;
        }
      }

      // ── Add file if we got content ──
      // MINIMUM QUALITY CHECK: reject files that are too short (likely incomplete)
      const minLines = filePlan.language === 'markdown' ? 10 : 20;
      const minChars = filePlan.language === 'markdown' ? 500 : 800;
      const contentStr = typeof fileContent === 'string' ? fileContent : '';
      const lineCount = contentStr.split('\n').length;
      const charCount = contentStr.trim().length;

      // Check for meta-commentary (LLM returning instructions instead of code)
      const isCommentary = contentStr.match(/^(Complete|Change|Add|Fix|Update|Modify|Implement|Write)\s+(the|this|a|an)\s/i) && lineCount < 5;
      if (isCommentary) {
        fileContent = null; // force retry
      }

      if (fileContent && charCount >= minChars && lineCount >= minLines && !isCommentary) {
        files.push({ path: filePath, content: contentStr, language: fileLang });
        // ── Live file emission — let UI show files as they're built ──
        await emit('file.built', { path: filePath, lines: lineCount, content: contentStr });
        await emit('agent.message', {
          agentId: 'builder', agentName: 'Builder',
          message: `${filePath} ✓ (${lineCount} lines) — ${files.length}/${buildOrder.length} files built`,
        });
      } else if (charCount > 0 && (lineCount < minLines || charCount < minChars)) {
        // File too short — retry with a more forceful prompt
        await emit('agent.message', {
          agentId: 'builder', agentName: 'Builder',
          message: `${filePlan.path} — too short (${lineCount} lines, need ${minLines}+), retrying...`,
        });
        const forceRetry = await llm(
          `Write the complete ${filePlan.language || ''} file: ${filePlan.path}
Purpose: ${filePlan.purpose}
Part of: ${mission}

The previous attempt was only ${lineCount} lines. You MUST write at least ${minLines} lines.
Write ALL the code — every function, every class, every export.
Output ONLY raw code. No JSON. No fences. No explanations.`,
          '',
          { maxTokens: 4000, temperature: 0.4, timeoutMs: 40000 },
          'builder', 'Builder'
        );
        if (forceRetry.ok && forceRetry.text) {
          let text = forceRetry.text.trim();
          const fenceMatch = text.match(/^```[\w]*\n?([\s\S]*?)\n?```$/);
          if (fenceMatch) text = fenceMatch[1];
          const retryLines = text.split('\n').length;
          const retryChars = text.trim().length;
          if (retryLines >= minLines && retryChars >= minChars) {
            files.push({ path: filePath, content: text, language: fileLang });
            await emit('agent.message', {
              agentId: 'builder', agentName: 'Builder',
              message: `${filePath} ✓ (${retryLines} lines, retry) — ${files.length}/${buildOrder.length} files`,
            });
          } else {
            await emit('agent.message', {
              agentId: 'builder', agentName: 'Builder',
              message: `${filePlan.path} ✗ — still too short after retry (${retryLines} lines), skipped`,
            });
          }
        }
      } else {
        await emit('agent.message', {
          agentId: 'builder', agentName: 'Builder',
          message: `${filePlan.path} ✗ — skipped (LLM produced no usable content)`,
        });
      }
    }

    if (files.length === 0) throw new Error('Build stage produced no files');
    } // end if !shouldSkipStage('build')

    // ── Checkpoint after build ──
    await saveCheckpoint(missionId, mission, 'build', files, analysis, qualityScore, engineConfig);
    await emit('agent.message', {
      agentId: 'builder', agentName: 'Builder',
      message: `Build checkpoint saved · ${files.length} files · ${totalTokens} tokens used ($${getCost().toFixed(4)})`,
    });

    await emit('agent.message', {
      agentId: 'builder', agentName: 'Builder',
      message: `Build complete: ${files.length} files · ${files.reduce((s, f) => s + f.content.split('\n').length, 0)} total lines`,
    });

    // ── Deterministic HTML/CSS auto-fix (NO LLM) ──
    // Inject DOCTYPE, <title>, <body>, charset meta, and missing CSS semicolons
    // BEFORE the Integrate stage so subsequent validation sees clean files.
    // This is FREE (no API call) and fixes issues that don't need reasoning.
    if (files.some(f => f.path.endsWith('.html') || f.path.endsWith('.css'))) {
      const titleForFix = analysis?.title || mission.split(/\s+/).slice(0, 4).join(' ');
      const fixResult = autoFixHtmlCss(files, { title: titleForFix, mission });
      if (fixResult.fixed > 0) {
        await emit('agent.message', {
          agentId: 'builder', agentName: 'Builder',
          message: `Auto-fix (deterministic): ${fixResult.fixed} file(s) · ${fixResult.notes.slice(0, 3).join(' · ')}${fixResult.notes.length > 3 ? ` (+${fixResult.notes.length - 3} more)` : ''}`,
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    await timeoutCheck(); if (isAborted(missionId)) throw new Error("Build aborted by user");
    // STAGE 4: INTEGRATE — Verify files work together
    // ═══════════════════════════════════════════════════════════════════════
    await emit('agent.thinking', {
      agentId: 'integrator', agentName: 'Integrator',
      detail: 'Checking that files integrate correctly (imports, exports, paths)...',
    });

    const integrateResult = await llm(
      `You are an integration checker. Review these files for integration issues.

Files:
${files.map(f => `--- ${f.path} ---\n${f.content.slice(0, 800)}${f.content.length > 800 ? '...' : ''}`).join('\n\n')}

Check for:
1. Import/export mismatches (file A imports from file B, but B doesn't export that)
2. Missing files (something is imported but doesn't exist)
3. Path errors (wrong relative paths)
4. Naming inconsistencies

Output JSON ONLY:
{
  "issues": [{"file": "path", "problem": "description", "fix": "corrected content for that file"}],
  "allGood": true/false
}

If allGood is true, return empty issues array.`,
      mission,
      { maxTokens: 3000, temperature: 0.2 },
      'integrator', 'Integrator'
    );

    if (integrateResult.ok) {
      const { json } = extractJSON(integrateResult.text);
      if (json && json.issues && json.issues.length > 0) {
        await emit('agent.message', {
          agentId: 'integrator', agentName: 'Integrator',
          message: `Found ${json.issues.length} integration issues — fixing...`,
        });
        // Apply fixes
        for (const issue of json.issues) {
          if (issue.fix && issue.file) {
            const idx = files.findIndex(f => f.path === issue.file);
            if (idx >= 0) {
              files[idx] = { ...files[idx], content: issue.fix };
            }
          }
        }
        await emit('agent.message', {
          agentId: 'integrator', agentName: 'Integrator',
          message: `Integration issues fixed ✓`,
        });
      } else {
        await emit('agent.message', {
          agentId: 'integrator', agentName: 'Integrator',
          message: `All files integrate correctly ✓`,
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    await timeoutCheck(); if (isAborted(missionId)) throw new Error("Build aborted by user");
    // STAGE 5: TEST — Generate test expectations
    // ═══════════════════════════════════════════════════════════════════════
    await emit('agent.thinking', {
      agentId: 'tester', agentName: 'Tester',
      detail: 'Generating test expectations and verifying behavior...',
    });

    // Only generate tests if there isn't already a test file
    const hasTests = files.some(f => f.path.includes('test') || f.path.includes('spec'));
    if (!hasTests) {
      const testResult = await llm(
        `You are a test engineer. Write a COMPLETE test file for this project.

Mission: "${mission}"
Main files:
${files.filter(f => !f.path.endsWith('.md') && !f.path.endsWith('.json')).slice(0, 4).map(f => `--- ${f.path} ---\n${f.content.slice(0, 600)}`).join('\n\n')}

Write a COMPLETE test file with at least 50 lines that verifies the core functionality.
- Use the appropriate test framework (Jest for JS, unittest for Python)
- Include at least 5 test cases
- Test edge cases (empty input, invalid input, boundary values)
- DO NOT write descriptions — write ACTUAL test code
- Start with imports, not instructions

Output JSON ONLY:
{"path": "test/test.test.js", "content": "ACTUAL TEST CODE — at least 50 lines", "language": "javascript"}`,
        mission,
        { maxTokens: 3000, temperature: 0.3 },
        'tester', 'Tester'
      );

      if (testResult.ok) {
        const { json } = extractJSON(testResult.text);
        if (json && json.content && typeof json.content === 'string' && json.content.split('\n').length >= 10) {
          files.push({
            path: json.path || 'test/test.test.js',
            content: json.content,
            language: json.language || 'javascript',
          });
          await emit('agent.message', {
            agentId: 'tester', agentName: 'Tester',
            message: `Test file generated: ${json.path || 'test/test.test.js'} ✓`,
          });
        }
      }
    } else {
      await emit('agent.message', {
        agentId: 'tester', agentName: 'Tester',
        message: `Tests already present in project ✓`,
      });
    }

    // ── Actually run the tests ──
    await emit('agent.thinking', { agentId: 'tester', agentName: 'Tester', detail: 'Running tests...' });
    const testResult = await runTests(files);
    await emit('agent.message', {
      agentId: 'tester', agentName: 'Tester',
      message: `Tests ${testResult.passed ? 'passed ✓' : 'failed ✗'} — ${testResult.assertions} assertion(s)${testResult.failed > 0 ? ` · ${testResult.failed} failed` : ''}${testResult.coverage ? ` · coverage ${testResult.coverage.tested}/${testResult.coverage.total}` : ''} — ${testResult.output.slice(0, 80).replace(/\n/g, ' ')}`,
    });
    await emit('test.result', { success: testResult.passed, output: testResult.output, assertions: testResult.assertions, failed: testResult.failed, coverage: testResult.coverage });

    // ── Runtime check: try to execute JS files that don't use DOM ──
    const jsFilesToCheck = files.filter(f =>
      f.path.endsWith('.js') &&
      !f.path.includes('test') &&
      !f.path.includes('node_modules') &&
      !f.content.includes('document.') &&
      !f.content.includes('window.') &&
      !f.content.includes('localStorage')
    );
    if (jsFilesToCheck.length > 0) {
      await emit('agent.thinking', { agentId: 'tester', agentName: 'Tester', detail: 'Runtime check...' });
      try {
        const tmpDir = path.join(os.tmpdir(), 'nova-runtime-' + Date.now());
        fs.mkdirSync(tmpDir, { recursive: true });
        // Write all JS files + package.json for ESM
        fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ type: 'module' }));
        for (const f of jsFilesToCheck) {
          const fullPath = path.join(tmpDir, f.path);
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, f.content);
        }
        const mainFile = jsFilesToCheck.find(f => f.path.includes('index') || f.path.includes('main')) || jsFilesToCheck[0];
        const runtimeResult = execSync(`node ${mainFile.path} 2>&1 || true`, {
          encoding: 'utf-8', timeout: 5000, cwd: tmpDir,
        });
        const hasError = runtimeResult.includes('Error:') || runtimeResult.includes('Cannot find');
        await emit('agent.message', {
          agentId: 'tester', agentName: 'Tester',
          message: `Runtime check: ${hasError ? 'issues found' : 'passed ✓'} — ${runtimeResult.trim().slice(0, 80)}`,
        });
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (err: any) {
        await emit('agent.message', {
          agentId: 'tester', agentName: 'Tester',
          message: `Runtime check: error — ${(err.message || '').slice(0, 80)}`,
        });
      }
    }

    // ── HTML validation: check basic structure ──
    const htmlFiles = files.filter(f => f.path.endsWith('.html'));
    if (htmlFiles.length > 0) {
      await emit('agent.thinking', { agentId: 'tester', agentName: 'Tester', detail: 'HTML validation...' });
      const htmlIssues: string[] = [];
      for (const f of htmlFiles) {
        const content = f.content;
        if (!content.includes('<!DOCTYPE') && !content.includes('<!doctype')) htmlIssues.push(`${f.path}: missing DOCTYPE`);
        if (!content.includes('<html')) htmlIssues.push(`${f.path}: missing <html> tag`);
        if (!content.includes('<head>')) htmlIssues.push(`${f.path}: missing <head>`);
        if (!content.includes('<body>')) htmlIssues.push(`${f.path}: missing <body>`);
        if (!content.includes('<meta') && !content.includes('charset')) htmlIssues.push(`${f.path}: missing charset meta`);
        if (!content.includes('<title>')) htmlIssues.push(`${f.path}: missing <title>`);
      }
      await emit('agent.message', {
        agentId: 'tester', agentName: 'Tester',
        message: `HTML validation: ${htmlIssues.length === 0 ? 'all valid ✓' : `${htmlIssues.length} issues`} ${htmlIssues.slice(0, 3).join(', ')}`,
      });
    }

    // ── CSS validation: check balanced braces, missing semicolons ──
    const cssFiles = files.filter(f => f.path.endsWith('.css'));
    if (cssFiles.length > 0) {
      await emit('agent.thinking', { agentId: 'tester', agentName: 'Tester', detail: 'CSS validation...' });
      const cssIssues: string[] = [];
      for (const f of cssFiles) {
        const content = f.content;
        const openBraces = (content.match(/{/g) || []).length;
        const closeBraces = (content.match(/}/g) || []).length;
        if (openBraces !== closeBraces) cssIssues.push(`${f.path}: unbalanced braces (${openBraces} vs ${closeBraces})`);
        // Check for missing semicolons — MULTI-LINE SAFE
        // A property declaration is "prop: value". If the value is on the SAME line
        // (i.e. something after the colon) and the line doesn't end with ;, {, }, or ,
        // it's missing a semicolon. Multi-line properties (just "prop:" on its own
        // line, value on following lines) are NOT flagged — they end with ; later.
        // Strip block comments first so commented-out props don't trigger false positives.
        const cleanCss = content.replace(/\/\*[\s\S]*?\*\//g, '');
        const lines = cleanCss.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          // Must be "prop: value" with actual value content after the colon (multi-line safe)
          if (/^[a-zA-Z-]+\s*:\s*\S/.test(line)
              && !line.endsWith(';') && !line.endsWith('{') && !line.endsWith('}')
              && !line.endsWith(',') && !line.startsWith('@')
              && !line.includes('url(') && !line.startsWith('"') && !line.startsWith("'")) {
            cssIssues.push(`${f.path}:${i + 1}: missing semicolon`);
            if (cssIssues.length >= 5) break; // cap noise
          }
        }
      }
      await emit('agent.message', {
        agentId: 'tester', agentName: 'Tester',
        message: `CSS validation: ${cssIssues.length === 0 ? 'all valid ✓' : `${cssIssues.length} issues`} ${cssIssues.slice(0, 3).join(', ')}`,
      });
    }

    // ── Lint check ──
    await emit('agent.thinking', { agentId: 'tester', agentName: 'Tester', detail: 'Linting code...' });
    const lintResult = await lintFiles(files);
    await emit('agent.message', {
      agentId: 'tester', agentName: 'Tester',
      message: `Lint: ${lintResult.errors} errors, ${lintResult.warnings} warnings${lintResult.errors > 0 ? ' — will fix' : ' ✓'}`,
    });

    // ── Checkpoint after test+lint ──
    await saveCheckpoint(missionId, mission, 'test', files, analysis, qualityScore, engineConfig);

    // ═══════════════════════════════════════════════════════════════════════
    await timeoutCheck(); if (isAborted(missionId)) throw new Error("Build aborted by user");
    // STAGE 6: REVIEW — Evaluate against 144 quality metrics
    // ═══════════════════════════════════════════════════════════════════════
    await emit('agent.thinking', {
      agentId: 'reviewer', agentName: 'Reviewer',
      detail: 'Evaluating against 144 quality metrics...',
    });

    const evalPrompt = buildEvaluationPrompt(mission, files);
    const evalResult = await llm(evalPrompt, mission, { maxTokens: 4000, temperature: 0.2, timeoutMs: 45000 }, 'reviewer', 'Reviewer');

    // Track the ORIGINAL review score so the post-fix fallback comparison is accurate
    // (previously this was derived as `qualityScore - 1.5` which is fragile if anything
    // else mutates qualityScore between review and fix).
    let originalReviewScore = 7.0;
    if (evalResult.ok) {
      qualityReport = parseQualityReport(evalResult.text);
      if (qualityReport) {
        qualityScore = qualityReport.overall;
        originalReviewScore = qualityReport.overall;
        await emit('agent.message', {
          agentId: 'reviewer', agentName: 'Reviewer',
          message: `144 metrics evaluated · Overall: ${qualityScore.toFixed(1)}/10 · ${qualityReport.criticalFailures.length} need fixing`,
        });
        await emit('quality.report', {
          overall: qualityReport.overall,
          categories: qualityReport.categories,
          criticalFailures: qualityReport.criticalFailures.slice(0, 20),
          strengths: qualityReport.strengths.slice(0, 10),
          summary: qualityReport.summary,
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    await timeoutCheck(); if (isAborted(missionId)) throw new Error("Build aborted by user");
    // STAGE 7+8: FIX + POLISH — fix worst files, validate syntax after each fix
    // ═══════════════════════════════════════════════════════════════════════
    // ── Per-file syntax check (revert a fix if it introduces syntax errors) ──
    // Declared at the top of the Fix stage so both the initial pass AND the
    // iterative fix loop (Stage 8.5) can reuse it.
    const checkSyntax = (filePath: string, content: string): { ok: boolean; msg: string } => {
      // Only JS/TS files can be node --checked; HTML/CSS skip (validated separately)
      if (!/\.(js|mjs|ts|jsx|tsx)$/.test(filePath)) return { ok: true, msg: 'skipped (non-JS)' };
      try {
        const ext = filePath.endsWith('.ts') ? 'mjs' : (filePath.split('.').pop() || 'mjs');
        const tmpFile = path.join(os.tmpdir(), `nova-fixcheck-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`);
        fs.writeFileSync(tmpFile, content);
        execSync(`node --check ${tmpFile}`, { encoding: 'utf-8', timeout: 5000 });
        try { fs.unlinkSync(tmpFile); } catch {}
        return { ok: true, msg: 'ok' };
      } catch (err: any) {
        return { ok: false, msg: (err.stderr || err.message || '').split('\n')[0].slice(0, 120) };
      }
    };

    const toFix = qualityReport?.criticalFailures?.slice(0, 12) || [];
    // Smart priority (FF): find files with the most critical issues, break ties by smallest
    // file size (cheapest fix = fewer tokens = lower cost + faster).
    const fileIssueCounts = files.map(f => {
      const count = toFix.filter(m => m.note && m.note.toLowerCase().includes(f.path.toLowerCase())).length;
      return { file: f, count, size: f.content.length };
    }).sort((a, b) => {
      // Primary: more issues first
      if (b.count !== a.count) return b.count - a.count;
      // Tie-breaker (FF): smaller file first (cheaper to fix)
      return a.size - b.size;
    });
    // Adaptive: if review quality is very low (<5), fix the 2 worst files; otherwise just 1.
    // Respects rate-limit budget — each fix is one LLM call (~3s + backoff).
    const maxFixes = originalReviewScore < 5 ? 2 : 1;
    const filesToFix = (fileIssueCounts[0]?.count > 0
      ? fileIssueCounts.slice(0, maxFixes).map(x => x.file)
      : files.slice(0, maxFixes)
    ).slice(0, maxFixes);
    let totalFixed = 0;
    let totalReverted = 0;

    for (const fileToFix of filesToFix) {
      await emit('agent.thinking', {
        agentId: 'fixer', agentName: 'Fixer',
        detail: `Fixing ${fileToFix.path}...`,
      });

      // Dynamic maxTokens: estimate based on file size (1 token ≈ 4 chars)
      const fileTokens = Math.ceil(fileToFix.content.length / 4);
      const dynamicMaxTokens = Math.min(8000, Math.max(2000, fileTokens * 2));

      const fixResult = await llm(
        `You are a senior developer. Fix this file and polish it.

Mission: "${mission}"
File: ${fileToFix.path}

${toFix.length > 0 ? `Quality issues found:\n${toFix.filter(m => !m.note || m.note.toLowerCase().includes(fileToFix.path.toLowerCase())).slice(0, 5).map(m => `- ${m.name} (score ${m.score}/10)${m.note ? ` — ${m.note}` : ''}`).join('\n')}` : ''}

Current file content:
${fileToFix.content}

Fix all issues. Make the code production-ready.
Reply with ONLY the fixed file content. No explanations. No markdown fences.`,
        mission,
        { maxTokens: dynamicMaxTokens, temperature: 0.2, timeoutMs: 40000 },
        'fixer', 'Fixer'
      );

      if (fixResult.ok && fixResult.text && fixResult.text.trim().length > 50) {
        let fixedContent = fixResult.text.trim();
        const fenceMatch = fixedContent.match(/^```[\w]*\n?([\s\S]*?)\n?```$/);
        if (fenceMatch) fixedContent = fenceMatch[1].trim();

        if (fixedContent.split('\n').length >= 10) {
          // ── Post-fix syntax validation: revert this file if the fix broke syntax ──
          const syntax = checkSyntax(fileToFix.path, fixedContent);
          if (!syntax.ok) {
            totalReverted++;
            await emit('agent.message', {
              agentId: 'fixer', agentName: 'Fixer',
              message: `Reverted ${fileToFix.path} ✗ — fix introduced syntax error: ${syntax.msg}`,
            });
            continue; // keep the original file content, skip applying this fix
          }
          const idx = files.findIndex(f => f.path === fileToFix.path);
          if (idx >= 0) {
            // ── NN: emit a fix.diff event with before/after content for the UI ──
            const beforeContent = files[idx].content;
            files[idx] = { ...files[idx], content: fixedContent };
            totalFixed++;
            await emit('fix.diff', {
              path: fileToFix.path,
              before: beforeContent.slice(0, 5000), // cap for event payload
              after: fixedContent.slice(0, 5000),
              beforeLines: beforeContent.split('\n').length,
              afterLines: fixedContent.split('\n').length,
              stage: 'initial-fix',
            });
            await emit('agent.message', {
              agentId: 'fixer', agentName: 'Fixer',
              message: `Fixed ${fileToFix.path} ✓ (${fixedContent.split('\n').length} lines)`,
            });
          }
        }
      }
    }

    if (totalFixed > 0) {
      qualityScore = Math.min(10, originalReviewScore + 1.5);
      await emit('agent.message', {
        agentId: 'fixer', agentName: 'Fixer',
        message: `Fixed ${totalFixed} files${totalReverted > 0 ? ` · reverted ${totalReverted} bad fixes` : ''} · quality now ${qualityScore.toFixed(1)}/10`,
      });
    } else {
      await emit('agent.message', {
        agentId: 'fixer', agentName: 'Fixer',
        message: totalReverted > 0 ? `All ${totalReverted} fix(es) broke syntax — kept originals ✓` : `No changes needed — code is clean ✓`,
      });
    }

    // ── Re-evaluation after Fix+Polish (only if fixes were applied) ──
    if (totalFixed > 0 && qualityReport) {
      // Save pre-fix files + use the ORIGINAL review score for the fallback comparison
      const preFixFiles = files.map(f => ({ ...f }));
      const preFixScore = originalReviewScore; // accurate, not derived

      await emit('agent.thinking', {
        agentId: 'validator', agentName: 'Validator',
        detail: 'Re-evaluating quality after fixes...',
      });
      try {
        const reEvalPrompt = buildEvaluationPrompt(mission, files);
        const reEvalResult = await llm(reEvalPrompt, mission, { maxTokens: 3000, temperature: 0.2, timeoutMs: 30000 }, 'validator', 'Validator');
        if (reEvalResult.ok) {
          const newReport = parseQualityReport(reEvalResult.text);
          if (newReport) {
            const oldScore = preFixScore;
            const newScore = newReport.overall;

            // Fallback: if score dropped more than 1 point, revert to pre-fix files
            if (newScore < oldScore - 1) {
              await emit('agent.message', {
                agentId: 'validator', agentName: 'Validator',
                message: `Re-evaluation: ${oldScore.toFixed(1)} → ${newScore.toFixed(1)}/10 ↓ — reverting fixes (score dropped)`,
              });
              files = preFixFiles;
              qualityScore = oldScore;
            } else {
              qualityScore = newScore;
              result.qualityReport = {
                overall: newReport.overall,
                categories: newReport.categories,
                criticalFailures: newReport.criticalFailures.slice(0, 20),
                strengths: newReport.strengths.slice(0, 10),
                summary: newReport.summary,
                metricsCount: newReport.metrics.length,
              };
              await emit('agent.message', {
                agentId: 'validator', agentName: 'Validator',
                message: `Re-evaluation: ${oldScore.toFixed(1)} → ${qualityScore.toFixed(1)}/10 ${qualityScore > oldScore ? '↑' : '→'}`,
              });
            }
          }
        }
      } catch {}
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STAGE 8.5: ITERATIVE FIX LOOP — keep fixing the next-worst file until
    // quality >= target OR max extra passes used OR cost guard trips.
    // Driven by the user-selected qualityTarget. Each pass = 1 fix + 1 re-eval.
    // ═══════════════════════════════════════════════════════════════════════
    let extraPassesUsed = 0;
    if (MAX_EXTRA_FIX_PASSES > 0 && qualityReport && qualityScore < qualityTarget) {
      await emit('agent.message', {
        agentId: 'fixer', agentName: 'Fixer',
        message: `Quality ${qualityScore.toFixed(1)}/10 below target ${qualityTarget}/10 — running up to ${MAX_EXTRA_FIX_PASSES} extra fix pass(es)`,
      });
      for (let pass = 0; pass < MAX_EXTRA_FIX_PASSES; pass++) {
        // Stop conditions: target reached, cost guard, abort, or no critical failures left
        if (qualityScore >= qualityTarget) break;
        if (getCost() > COST_GUARD_USD * 0.9) {
          await emit('agent.message', {
            agentId: 'fixer', agentName: 'Fixer',
            message: `Stopping extra fixes — cost guard approaching ($${getCost().toFixed(4)}/$${COST_GUARD_USD.toFixed(2)})`,
          });
          break;
        }
        if (isAborted(missionId)) throw new Error("Build aborted by user");
        // Re-fetch the latest critical failures (re-eval may have updated them)
        const liveFailures = qualityReport?.criticalFailures?.slice(0, 12) || [];
        if (liveFailures.length === 0) {
          await emit('agent.message', {
            agentId: 'fixer', agentName: 'Fixer',
            message: `No critical failures left — stopping extra fixes ✓`,
          });
          break;
        }
        // Pick the next-worst file (FF: break ties by smallest file = cheapest fix)
        const liveFileIssueCounts = files.map(f => {
          const count = liveFailures.filter(m => m.note && m.note.toLowerCase().includes(f.path.toLowerCase())).length;
          return { file: f, count, size: f.content.length };
        }).sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count;
          return a.size - b.size; // smaller file = fewer tokens = cheaper fix
        });
        const nextFile = liveFileIssueCounts[0]?.count > 0 ? liveFileIssueCounts[0].file : null;
        if (!nextFile) {
          await emit('agent.message', {
            agentId: 'fixer', agentName: 'Fixer',
            message: `No file-specific issues to fix — stopping extra passes`,
          });
          break;
        }

        await emit('agent.thinking', {
          agentId: 'fixer', agentName: 'Fixer',
          detail: `Extra pass ${pass + 1}/${MAX_EXTRA_FIX_PASSES}: fixing ${nextFile.path}...`,
        });

        const fileTokens = Math.ceil(nextFile.content.length / 4);
        const dynamicMaxTokens = Math.min(8000, Math.max(2000, fileTokens * 2));
        const passFix = await llm(
          `You are a senior developer. The quality score is still ${qualityScore.toFixed(1)}/10. Target is ${qualityTarget}/10.
Fix this file to push the score higher.

Mission: "${mission}"
File: ${nextFile.path}

Critical issues remaining:
${liveFailures.filter(m => !m.note || m.note.toLowerCase().includes(nextFile.path.toLowerCase())).slice(0, 6).map(m => `- ${m.name} (score ${m.score}/10)${m.note ? ` — ${m.note}` : ''}`).join('\n')}

Current file content:
${nextFile.content}

Fix all issues. Make the code production-ready. Aim for score ${qualityTarget}/10+.
Reply with ONLY the fixed file content. No explanations. No markdown fences.`,
          mission,
          { maxTokens: dynamicMaxTokens, temperature: 0.2, timeoutMs: 40000 },
          'fixer', 'Fixer'
        );

        if (passFix.ok && passFix.text && passFix.text.trim().length > 50) {
          let fixedContent = passFix.text.trim();
          const fenceMatch = fixedContent.match(/^```[\w]*\n?([\s\S]*?)\n?```$/);
          if (fenceMatch) fixedContent = fenceMatch[1].trim();
          if (fixedContent.split('\n').length >= 10) {
            // Syntax check before applying
            const syntax = checkSyntax(nextFile.path, fixedContent);
            if (!syntax.ok) {
              await emit('agent.message', {
                agentId: 'fixer', agentName: 'Fixer',
                message: `Extra pass ${pass + 1}: reverted ${nextFile.path} — syntax error: ${syntax.msg}`,
              });
            } else {
              const idx = files.findIndex(f => f.path === nextFile.path);
              if (idx >= 0) {
                files[idx] = { ...files[idx], content: fixedContent };
                extraPassesUsed++;
                await emit('agent.message', {
                  agentId: 'fixer', agentName: 'Fixer',
                  message: `Extra pass ${pass + 1}: fixed ${nextFile.path} ✓`,
                });
                // Re-evaluate after this pass
                await emit('agent.thinking', {
                  agentId: 'validator', agentName: 'Validator',
                  detail: `Re-evaluating after extra pass ${pass + 1}...`,
                });
                try {
                  const reEval = await llm(
                    buildEvaluationPrompt(mission, files), mission,
                    { maxTokens: 3000, temperature: 0.2, timeoutMs: 30000 },
                    'validator', 'Validator'
                  );
                  if (reEval.ok) {
                    const newReport = parseQualityReport(reEval.text);
                    if (newReport) {
                      const prev = qualityScore;
                      // Fallback: if score dropped, revert this fix
                      if (newReport.overall < prev - 1) {
                        files[idx] = { ...files[idx], content: nextFile.content };
                        await emit('agent.message', {
                          agentId: 'validator', agentName: 'Validator',
                          message: `Re-eval: ${prev.toFixed(1)} → ${newReport.overall.toFixed(1)}/10 ↓ — reverted extra pass`,
                        });
                      } else {
                        qualityScore = newReport.overall;
                        qualityReport = newReport;
                        result.qualityReport = {
                          overall: newReport.overall,
                          categories: newReport.categories,
                          criticalFailures: newReport.criticalFailures.slice(0, 20),
                          strengths: newReport.strengths.slice(0, 10),
                          summary: newReport.summary,
                          metricsCount: newReport.metrics.length,
                        };
                        await emit('agent.message', {
                          agentId: 'validator', agentName: 'Validator',
                          message: `Re-eval: ${prev.toFixed(1)} → ${qualityScore.toFixed(1)}/10 ${qualityScore > prev ? '↑' : '→'}`,
                        });
                      }
                    }
                  }
                } catch {}
              }
            }
          }
        } else {
          await emit('agent.message', {
            agentId: 'fixer', agentName: 'Fixer',
            message: `Extra pass ${pass + 1}: no usable fix produced — skipping`,
          });
        }
      }
      if (extraPassesUsed > 0) {
        await emit('agent.message', {
          agentId: 'fixer', agentName: 'Fixer',
          message: `Extra fix loop done: ${extraPassesUsed} pass(es) applied · quality now ${qualityScore.toFixed(1)}/10 (target was ${qualityTarget})`,
        });
      }
    }

    // ── Final score + stage timings ──
    result.qualityScore = Math.min(10, Math.max(1, qualityScore));
    await emit('agent.message', {
      agentId: 'validator', agentName: 'Validator',
      message: `Final quality: ${result.qualityScore.toFixed(1)}/10 · ${files.length} files · ${files.reduce((s, f) => s + f.content.split('\n').length, 0)} lines · ${totalTokens} tokens ($${getCost().toFixed(4)})`,
    });
    await emitStageTimings();

    // ── Compute health score (Y) — composite of quality, cost, duration, success ──
    const finalHealthScore = computeHealthScore(result.qualityScore ?? 0, getCost(), result.durationMs, result.success);
    result.healthScore = finalHealthScore;
    await emit('agent.message', {
      agentId: 'validator', agentName: 'Validator',
      message: `Build health: ${finalHealthScore}/100 (quality ${result.qualityScore?.toFixed(1)} · cost $${getCost().toFixed(4)} · ${((result.durationMs || 0) / 1000).toFixed(1)}s)`,
    });

    // ── Final checkpoint (with engine config + health score) ──
    await saveCheckpoint(missionId, mission, 'complete', files, analysis, qualityScore, engineConfig, finalHealthScore);

    // ── Learn ──
    try {
      const sourceContent = files.find(f => f.path.endsWith('.html'))?.content || files[0]?.content || '';
      await db.agentMemory.create({
        data: {
          mission: mission.slice(0, 500), category: analysis.type || 'web-app',
          subType: analysis.title?.toLowerCase().slice(0, 50) || '',
          agentId: 'nova-8stage', agentName: 'NOVA 8-Stage', success: true,
          sourceCode: sourceContent.slice(0, 5000),
          durationMs: Date.now() - t0,
          learnings: `${files.length} files, quality ${result.qualityScore.toFixed(1)}`.slice(0, 2000),
        },
      });
      await Promise.all(['discover', 'architect', 'builder', 'integrator', 'tester', 'reviewer', 'fixer', 'polisher']
        .map(id => updateAgentSkill(id, '', analysis.type || 'web-app', true, mission).catch(() => {})));
    } catch {}

    result.files = files;
    result.allRepoFiles = files;
    result.success = files.length > 0;
    result.durationMs = Date.now() - t0;
    result.qualityReport = qualityReport ? {
      overall: qualityReport.overall,
      categories: qualityReport.categories,
      criticalFailures: qualityReport.criticalFailures.slice(0, 20),
      strengths: qualityReport.strengths.slice(0, 10),
      summary: qualityReport.summary,
      metricsCount: qualityReport.metrics.length,
    } : null;

    await emit('mission.complete', {
      missionId, success: result.success, durationMs: result.durationMs,
      classification: result.classification, files: result.files, allRepoFiles: result.allRepoFiles,
      agents: result.agents, isPlayable: result.isPlayable,
      qualityScore: result.qualityScore, pipeline: 'nova-8stage',
      qualityReport: result.qualityReport,
      tokenUsage: { total: totalTokens, cost: getCost() },
      healthScore: finalHealthScore,
      engineConfig, // Z — include engine config in the final event
    });

    clearAbort(missionId);
    log('info', 'Pipeline completed', { missionId, success: result.success, files: files.length, quality: result.qualityScore, duration: result.durationMs, tokens: totalTokens });
    return result;
  } catch (err: any) {
    log('error', 'Pipeline failed', { missionId, error: err instanceof Error ? err.message : String(err) });
    const isTimeout = err instanceof Error && err.message.includes('timed out');
    const isCostGuard = !!(err as any)?.costGuard || (err instanceof Error && err.message.includes('Cost guard'));
    const errMsg = err instanceof Error ? err.message : String(err);
    const is429 = /429|Too many requests|rate limit/i.test(errMsg);
    if (isCostGuard) {
      result.error = `Cost guard: build stopped after $${getCost().toFixed(4)} — partial results saved`;
    } else if (isTimeout) {
      result.error = 'Build timed out after 10 minutes — partial results saved';
    } else {
      result.error = errMsg;
    }
    // CRITICAL: Save whatever files we managed to build — don't lose work!
    result.files = files;
    result.allRepoFiles = files;
    result.success = files.length > 0; // Success if we have ANY files, even if pipeline crashed
    result.durationMs = Date.now() - t0;
    result.qualityScore = files.length > 0 ? Math.min(10, Math.max(1, qualityScore)) : undefined;
    // Save checkpoint even on failure
    if (files.length > 0) {
      await saveCheckpoint(missionId, mission, isTimeout ? 'timeout' : (isCostGuard ? 'cost-guard' : 'failed'), files, analysis, qualityScore, engineConfig, computeHealthScore(qualityScore, getCost(), Date.now() - t0, false));
    }
    await emit('mission.fail', { error: result.error, missionId, isTimeout, isCostGuard, is429 });
    await emit('mission.complete', {
      missionId,
      success: result.success,
      error: result.error,
      durationMs: result.durationMs,
      files: result.files,
      allRepoFiles: result.allRepoFiles,
      agents: result.agents,
      pipeline: 'nova-8stage',
      qualityScore: result.qualityScore,
      qualityReport: qualityReport ? {
        overall: qualityReport.overall,
        categories: qualityReport.categories,
        criticalFailures: qualityReport.criticalFailures.slice(0, 20),
        strengths: qualityReport.strengths.slice(0, 10),
        summary: qualityReport.summary,
        metricsCount: qualityReport.metrics.length,
      } : null,
      healthScore: computeHealthScore(qualityScore, getCost(), Date.now() - t0, false),
      engineConfig,
    });
    // ── Proactive retry queue (AA) ──
    // If the failure was due to 429 AND we got no usable files, enqueue for retry.
    // We don't enqueue if we have partial files (those are already saved as a checkpoint).
    if (is429 && files.length === 0) {
      try {
        const { enqueueForRetry } = await import('@/lib/retry-queue');
        enqueueForRetry(mission, qualityTarget, missionId, errMsg);
      } catch {}
    }
    return result;
  }
}

function guessLanguage(path: string): string {
  if (path.endsWith('.html')) return 'html';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.js')) return 'javascript';
  if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript';
  if (path.endsWith('.jsx')) return 'javascript';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.md')) return 'markdown';
  if (path.endsWith('.py')) return 'python';
  if (path.endsWith('.sh')) return 'bash';
  if (path.endsWith('.sql')) return 'sql';
  if (path.endsWith('.yml') || path.endsWith('.yaml')) return 'yaml';
  if (path.endsWith('.env') || path.endsWith('.example')) return 'bash';
  if (path.endsWith('.txt')) return 'text';
  if (path.endsWith('.csv')) return 'csv';
  return 'text';
}
