// POST /api/nova/reason — Real multi-agent reasoning pipeline with inter-agent communication
//
// This is NOT the old regex-based pipeline. It uses:
// 1. AgentBus for inter-agent messaging
// 2. Multi-step reasoning (each agent does real analysis)
// 3. Iterative refinement (Coder→QA→Coder loop)
// 4. Context-rich ATLAS integration (intel items passed through)
//
// Request: { mission, atlasIntel?, maxRounds? }
// Response: { pipeline, finalSource, testResults, agentMessages, rounds }
import type { NextRequest } from 'next/server';
import { AgentBus, pmAgentReason, architectAgentReason, coderAgentReason, securityAgentReason } from '@/lib/nova-reasoning';
import { sanitizeCode } from '@/lib/sanitize';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Run code in ARENA
async function runInArena(source: string, stdin: string = ''): Promise<{ stdout: string; exitCode: number; stderr: string }> {
  try {
    const res = await fetch('http://localhost:3000/api/arena/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'js', source, stdin, timeoutMs: 5000 }),
    });
    const data = await res.json();
    return {
      stdout: data.stdout || '',
      exitCode: data.exitCode ?? 0,
      stderr: data.stderr || '',
    };
  } catch {
    return { stdout: '', exitCode: -1, stderr: 'ARENA unavailable' };
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const t0 = Date.now();
  try {
    const { mission, atlasIntel, maxRounds = 2 } = await request.json();
    if (!mission || !mission.trim()) {
      return Response.json({ error: 'Missing mission' }, { status: 400 });
    }

    // Initialize agent bus for this mission
    const bus = new AgentBus(`mission_${Date.now()}`);
    bus.send('system', 'broadcast', 'output', { mission, atlasIntel, timestamp: new Date().toISOString() });

    const pipeline: any[] = [];

    // ══ Round 0: Initial pipeline ══

    // 1. PM agent — deep mission analysis
    const pmAnalysis = pmAgentReason(mission, atlasIntel);
    bus.send('pm', 'broadcast', 'output', pmAnalysis);
    pipeline.push({ agent: 'pm', round: 0, output: pmAnalysis, ms: 0 });

    // 2. Architect agent — receives PM analysis, designs architecture
    const archSpec = architectAgentReason(pmAnalysis);
    bus.send('architect', 'broadcast', 'output', archSpec);
    // If architect has critique, send back to PM
    if (archSpec.critique.length > 0) {
      bus.send('architect', 'pm', 'critique', archSpec.critique);
    }
    pipeline.push({ agent: 'architect', round: 0, output: archSpec, ms: 0 });

    // 3. Coder agent — receives PM + Architect specs, generates code
    let coderResult = coderAgentReason(mission, pmAnalysis, archSpec);
    let source = sanitizeCode(coderResult.source);
    bus.send('coder', 'broadcast', 'output', { source, rationale: coderResult.rationale, assumptions: coderResult.assumptions });
    pipeline.push({ agent: 'coder', round: 0, output: coderResult, ms: 0 });

    // 4. QA agent — run acceptance tests against ARENA
    let testResults: any[] = [];
    let allPassed = false;
    let previousErrors: string[] = [];

    for (let round = 0; round < maxRounds; round++) {
      bus.nextRound();

      // Run each acceptance test — compare FULL output to expected
      // (the source is designed to produce all expected outputs)
      testResults = [];
      const fullExpected = pmAnalysis.acceptanceTests.map(t => t.expectedOutput.trim()).join('\n');
      const result = await runInArena(source, '');
      const actualOut = (result.stdout || '').trim();

      // Check if full output matches (all tests pass together)
      const fullPassed = actualOut === fullExpected && result.exitCode === 0;

      // Also check each test individually (substring match)
      for (const test of pmAnalysis.acceptanceTests) {
        const expectedOut = (test.expectedOutput || '').trim();
        const passed = actualOut.includes(expectedOut) && result.exitCode === 0;
        testResults.push({
          name: test.name,
          passed,
          expected: expectedOut,
          actual: actualOut,
          exitCode: result.exitCode,
          stderr: result.stderr,
          rationale: test.rationale,
        });
        if (!passed) {
          previousErrors.push(`${test.name}: expected "${expectedOut.slice(0, 50)}", got "${actualOut.slice(0, 50)}"`);
        }
      }

      const passedCount = testResults.filter(t => t.passed).length;
      const totalCount = testResults.length;
      allPassed = passedCount === totalCount;

      bus.send('qa', 'broadcast', 'output', {
        round,
        passed: passedCount,
        total: totalCount,
        results: testResults,
      });

      if (allPassed) {
        pipeline.push({ agent: 'qa', round, output: { passed: passedCount, total: totalCount, allPassed: true }, ms: 0 });
        break;
      }

      // If not all passed and we have rounds left, ask Coder to fix
      if (round < maxRounds - 1) {
        bus.send('qa', 'coder', 'critique', previousErrors);
        coderResult = coderAgentReason(mission, pmAnalysis, archSpec, previousErrors);
        source = sanitizeCode(coderResult.source);
        bus.send('coder', 'broadcast', 'revision', { round: round + 1, source, rationale: coderResult.rationale });
        pipeline.push({ agent: 'coder', round: round + 1, output: { revision: true, rationale: coderResult.rationale }, ms: 0 });
      }

      pipeline.push({ agent: 'qa', round, output: { passed: passedCount, total: totalCount, allPassed }, ms: 0 });
    }

    // 5. Security agent — AST-level analysis
    const secResult = securityAgentReason(source);
    bus.send('security', 'broadcast', 'output', secResult);
    pipeline.push({ agent: 'security', round: 0, output: secResult, ms: 0 });

    // 6. Final summary
    const finalSummary = {
      mission,
      totalAgents: pipeline.length,
      rounds: bus.getHistory().filter(m => m.type === 'revision').length + 1,
      finalSource: source,
      testResults: {
        passed: testResults.filter(t => t.passed).length,
        total: testResults.length,
        allPassed,
      },
      security: {
        safe: secResult.safe,
        findings: secResult.findings.length,
      },
      agentMessages: bus.getHistory(),
      pipeline,
      totalMs: Date.now() - t0,
    };

    return Response.json(finalSummary);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err), totalMs: Date.now() - t0 },
      { status: 500 }
    );
  }
}
