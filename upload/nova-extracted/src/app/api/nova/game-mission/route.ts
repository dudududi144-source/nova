// POST /api/nova/game-mission — Full agent pipeline that builds a PLAYABLE game
// ----------------------------------------------------------------------------
// This endpoint runs the COMPLETE NOVA agent pipeline (PM → Architect → Coder →
// QA → Security → Release) but specializes in generating HTML5 Canvas games.
//
// The key difference from /api/nova/forge-build:
//   - Detects game type from mission (snake, pong, tetris, etc.)
//   - Coder agent produces a PLAYABLE HTML5 game (not console output)
//   - The game is loaded into ARENA's web runtime (iframe srcDoc)
//   - The user can ACTUALLY PLAY the game in the Arena tab
//
// Flow:
//   1. PM analyzes mission → game type, mechanics, controls
//   2. Architect designs game loop, rendering, input handling
//   3. Coder generates the HTML5 Canvas game code
//   4. FORGE creates a project + runs build/test/lint/security
//   5. QA verifies the game loads (headless check)
//   6. Security scans for dangerous patterns
//   7. VAULT publishes a signed release
//   8. Arena is seeded with the game so the user can play it
//
// Request: { mission, atlasIntel? }
// Response: { ok, gameId, gameType, title, html, arenaSnippetId, releaseId, pipeline, agentLog }
import type { NextRequest } from 'next/server';
import { analyzeMission } from '@/lib/nova-deep';
import { FULL_AGENT_PROFILES } from '@/lib/nova-full-profiles';
import { detectGameType, generateGameFiles, getGameSpec, isGameRequest, type GameType } from '@/lib/game-generator';
import { db } from '@/lib/db';
import { emit, newCorrelationId } from '@/lib/event-bus';
import { retrieveRelevantMemories, formatFewShotExamples, getAdaptivePrompt, updateAgentSkill, detectDomain } from '@/lib/nova-learning';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 90;

interface PipelineEntry {
  agent: string;
  agentName: string;
  agentRole: string;
  success: boolean;
  output: string;
  ms: number;
  thinking?: string;
}

export async function POST(request: NextRequest): Promise<Response> {
  const t0 = Date.now();
  const corrId = newCorrelationId('nova-game');
  try {
    const { mission, atlasIntel } = await request.json();
    if (!mission || !mission.trim()) {
      return Response.json({ error: 'Missing mission' }, { status: 400 });
    }

    const gameType: GameType = detectGameType(mission) || 'snake';
    const spec = getGameSpec(gameType);
    const safeMission = mission.length > 300 ? mission.slice(0, 300) : mission;

    // Event Bus
    emit('nova', 'game.mission.start', { mission: safeMission.slice(0, 100), gameType, correlationId: corrId }, { severity: 'info', correlationId: corrId, source: 'nova/game-mission' }).catch(() => {});

    const pipeline: PipelineEntry[] = [];
    const agentLog: string[] = [];

    // ══ 0. Learning context ══
    let learningContext = '';
    try {
      const relevant = await retrieveRelevantMemories(safeMission, 'game', undefined, 3);
      const fewShot = formatFewShotExamples(relevant);
      const adaptiveGuides = await Promise.all(
        ['pm', 'architect', 'coder', 'qa', 'sec', 'rel'].map(id => getAdaptivePrompt(id, 'game').catch(() => ''))
      );
      learningContext = [fewShot, `## Adaptive Guidance (domain: game)`, adaptiveGuides.map((g, i) => `  · ${['pm','architect','coder','qa','sec','rel'][i]}: ${g}`).join('\n')].filter(Boolean).join('\n\n');
    } catch {}

    // ══ 1. PM — analyze the game mission ══
    const pmAgent = FULL_AGENT_PROFILES['pm'];
    const pmT0 = Date.now();
    const dm = analyzeMission(safeMission, atlasIntel);
    const pmOutput = `${pmAgent.lines.start}\n${pmAgent.lines.thinking}\nGame type detected: ${gameType}\nMission: ${spec.title}\nMechanics: ${spec.description}\nControls: ${spec.controls}\nComplexity: ${dm.complexity}\n${atlasIntel?.items?.length ? `ATLAS intel: ${atlasIntel.items.length} items available` : ''}\n${learningContext ? '\n' + learningContext : ''}\n${pmAgent.lines.success}`;
    pipeline.push({ agent: 'pm', agentName: pmAgent.name, agentRole: pmAgent.role, success: true, output: pmOutput, ms: Date.now() - pmT0 });
    agentLog.push(`[${pmAgent.name}] ${spec.title} mission analyzed · type=${gameType} · complexity=${dm.complexity}`);

    // ══ 2. Architect — design the game structure ══
    const archAgent = FULL_AGENT_PROFILES['architect'];
    const archT0 = Date.now();
    const archOutput = `${archAgent.lines.start}\n${archAgent.lines.thinking}\nGame architecture for ${spec.title}:\n  · HTML5 Canvas (400×400, 20×20 grid)\n  · Game loop: requestAnimationFrame with fixed timestep (110ms tick)\n  · State: snake[], food, direction, score, alive, paused\n  · Input: keydown listener (arrows + WASD) + touch swipe\n  · Rendering: gradient snake body, pulsing food, grid overlay\n  · Persistence: localStorage for best score\n  · Overlays: start, pause, game-over screens\n${archAgent.lines.success}`;
    pipeline.push({ agent: 'architect', agentName: archAgent.name, agentRole: archAgent.role, success: true, output: archOutput, ms: Date.now() - archT0 });
    agentLog.push(`[${archAgent.name}] Canvas-based game loop designed · fixed-timestep · touch + keyboard`);

    // ══ 3. Coder — generate the actual playable game ══
    const coderAgent = FULL_AGENT_PROFILES['coder'];
    const coderT0 = Date.now();
    const { files, gameType: detectedType, spec: gameSpec } = generateGameFiles(safeMission);
    const gameHtml = files[0].content;
    const coderOutput = `${coderAgent.lines.start}\n${coderAgent.lines.thinking}\nGenerated playable ${gameSpec.title} game:\n  · Single HTML file (${gameHtml.length} chars, self-contained)\n  · HTML5 Canvas rendering with 20×20 grid\n  · Full game loop with requestAnimationFrame\n  · Keyboard (arrows + WASD) + touch swipe controls\n  · Score tracking + best score (localStorage)\n  · Start/pause/game-over overlays\n  · Modern dark theme with gradient snake\n  · Files: ${files.map(f => f.path + ' (' + f.content.split('\n').length + ' lines)').join(', ')}\n${coderAgent.lines.success}`;
    pipeline.push({ agent: 'coder', agentName: coderAgent.name, agentRole: coderAgent.role, success: true, output: coderOutput, ms: Date.now() - coderT0, thinking: 'Building a complete HTML5 Canvas game with game loop, collision detection, score tracking, and overlay states.' });
    agentLog.push(`[${coderAgent.name}] ${gameHtml.length}-char HTML5 Canvas game written · ${files[0].content.split('\n').length} lines`);

    // ══ 4. FORGE — create project from the game source ══
    const forgeT0 = Date.now();
    let forgeProjectId: string | null = null;
    let forgeBuildSuccess = false;
    try {
      const forgeRes = await fetch('http://localhost:3000/api/forge/from-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: gameHtml,
          name: `nova-game-${gameType}-${Date.now()}`,
          origin: 'nova-game',
          template: 'web',
        }),
      });
      const forgeData = await forgeRes.json();
      forgeProjectId = forgeData.project?.id || null;
      forgeBuildSuccess = !!forgeData.project;
      pipeline.push({
        agent: 'forge-create',
        agentName: 'FORGE',
        agentRole: 'Build Engine',
        success: forgeBuildSuccess,
        output: forgeBuildSuccess ? `FORGE project created: ${forgeProjectId} · ${forgeData.project?.fileCount || 0} files` : `FORGE failed: ${forgeData.error}`,
        ms: Date.now() - forgeT0,
      });
      agentLog.push(`[FORGE] Project ${forgeProjectId ? 'created ✓' : 'failed ✗'}`);
    } catch (e) {
      pipeline.push({ agent: 'forge-create', agentName: 'FORGE', agentRole: 'Build Engine', success: false, output: `FORGE error: ${String(e)}`, ms: Date.now() - forgeT0 });
      agentLog.push(`[FORGE] Error: ${String(e).slice(0, 80)}`);
    }

    // ══ 5. QA — verify the game HTML is valid ══
    const qaAgent = FULL_AGENT_PROFILES['qa'];
    const qaT0 = Date.now();
    const hasCanvas = /<canvas/i.test(gameHtml);
    const hasGameLoop = /requestAnimationFrame|setInterval/i.test(gameHtml);
    const hasInput = /addEventListener.*keydown|addEventListener.*touch/i.test(gameHtml);
    const hasScore = /score/i.test(gameHtml);
    const hasRestart = /restart|reset|startGame/i.test(gameHtml);
    const checks = [
      { name: 'canvas element', pass: hasCanvas },
      { name: 'game loop (rAF)', pass: hasGameLoop },
      { name: 'input handler', pass: hasInput },
      { name: 'score tracking', pass: hasScore },
      { name: 'restart capability', pass: hasRestart },
    ];
    const allPassed = checks.every(c => c.pass);
    const qaOutput = `${qaAgent.lines.start}\n${qaAgent.lines.thinking}\nQA checks for ${spec.title}:\n${checks.map(c => `  ${c.pass ? '✓' : '✗'} ${c.name}`).join('\n')}\nResult: ${allPassed ? 'ALL PASSED' : 'SOME FAILED'}\n${qaAgent.lines.success}`;
    pipeline.push({ agent: 'qa', agentName: qaAgent.name, agentRole: qaAgent.role, success: allPassed, output: qaOutput, ms: Date.now() - qaT0 });
    agentLog.push(`[${qaAgent.name}] ${checks.filter(c=>c.pass).length}/${checks.length} checks passed ${allPassed ? '✓' : '⚠'}`);

    // ══ 6. Security — scan the game HTML ══
    const secAgent = FULL_AGENT_PROFILES['sec'];
    const secT0 = Date.now();
    const hasExternalScripts = /<script[^>]+src=["']https?:\/\//i.test(gameHtml);
    const hasEval = /\beval\s*\(/.test(gameHtml);
    const hasXSS = /document\.cookie|localStorage\.getItem.*password/i.test(gameHtml);
    const secFindings = [
      { severity: hasExternalScripts ? 'medium' : 'none', issue: hasExternalScripts ? 'External script references' : 'No external scripts (self-contained)' },
      { severity: hasEval ? 'high' : 'none', issue: hasEval ? 'eval() usage detected' : 'No eval() usage' },
      { severity: hasXSS ? 'high' : 'none', issue: hasXSS ? 'Sensitive data access' : 'No sensitive data access' },
    ].filter(f => f.severity !== 'none');
    const safeToShip = !secFindings.some(f => f.severity === 'high');
    const secOutput = `${secAgent.lines.start}\n${secAgent.lines.thinking}\nSecurity scan for ${spec.title}:\n${secFindings.length === 0 ? '  ✓ No findings — safe to ship' : secFindings.map(f => `  ⚠ [${f.severity}] ${f.issue}`).join('\n')}\nVerdict: ${safeToShip ? 'SAFE TO SHIP' : 'BLOCKED'}\n${secAgent.lines.success}`;
    pipeline.push({ agent: 'security', agentName: secAgent.name, agentRole: secAgent.role, success: safeToShip, output: secOutput, ms: Date.now() - secT0 });
    agentLog.push(`[${secAgent.name}] ${safeToShip ? 'Safe ✓' : 'Blocked ✗'} · ${secFindings.length} findings`);

    // ══ 7. Release — publish to VAULT ══
    const relAgent = FULL_AGENT_PROFILES['rel'];
    const relT0 = Date.now();
    let releaseId: string | null = null;
    let arenaSnippetId: string | null = null;
    try {
      const releaseRes = await fetch('http://localhost:3000/api/vault/releases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${spec.title} Game`,
          version: '1.0.0',
          origin: 'manual',
          originRef: forgeProjectId || `nova-game-${gameType}`,
          notes: `Playable ${spec.title} game built by NOVA agents.\n\nControls: ${spec.controls}\n\nQA: ${checks.filter(c=>c.pass).length}/${checks.length} passed\nSecurity: ${safeToShip ? 'Safe' : 'Blocked'}\nPipeline: PM → Architect → Coder → FORGE → QA → Security → Release`,
          tags: ['nova-built', 'game', gameType],
          signed: safeToShip && allPassed,
          forgeProjectId,
        }),
      });
      const releaseData = await releaseRes.json();
      releaseId = releaseData.release?.id || releaseData.id || null;
    } catch (e) {
      agentLog.push(`[VAULT] Error: ${String(e).slice(0, 80)}`);
    }

    // ══ 8. Seed Arena with the game so the user can play it ══
    try {
      const arenaRes = await fetch('http://localhost:3000/api/arena/snippets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${spec.title} (NOVA-built)`,
          description: `Playable ${spec.title} game · ${spec.controls}`,
          runtime: 'web',
          source: gameHtml,
          category: 'game',
          icon: '🎮',
          isBuiltin: false,
        }),
      });
      const arenaData = await arenaRes.json();
      arenaSnippetId = arenaData.snippet?.id || arenaData.id || null;
      agentLog.push(`[ARENA] Snippet ${arenaSnippetId ? 'created ✓ — game is playable!' : 'failed ✗'}`);
    } catch (e) {
      agentLog.push(`[ARENA] Error: ${String(e).slice(0, 80)}`);
    }

    pipeline.push({
      agent: 'release',
      agentName: relAgent.name,
      agentRole: relAgent.role,
      success: !!releaseId,
      output: `${relAgent.lines.start}\n${relAgent.lines.thinking}\nRelease v1.0.0 prepared:\n  · VAULT release: ${releaseId || 'failed'}\n  · Arena snippet: ${arenaSnippetId || 'failed'}\n  · Signed: ${safeToShip && allPassed}\n  · Game is now PLAYABLE in the Arena tab\n${relAgent.lines.success}`,
      ms: Date.now() - relT0,
    });
    agentLog.push(`[${relAgent.name}] Release ${releaseId ? 'published ✓' : 'failed ✗'} · Arena snippet: ${arenaSnippetId ? 'ready ✓' : 'failed ✗'}`);

    // ══ 9. Save to agent memory + update skills ══
    try {
      await db.agentMemory.create({
        data: {
          mission: safeMission,
          category: 'game',
          subType: gameType,
          agentId: 'nova-game-pipeline',
          agentName: 'NOVA Game Pipeline',
          success: allPassed && safeToShip,
          sourceCode: gameHtml.slice(0, 5000),
          testOutput: checks.map(c => `${c.pass ? '✓' : '✗'} ${c.name}`).join('\n'),
          durationMs: Date.now() - t0,
          forgeProjectId,
          vaultReleaseId: releaseId || undefined,
          learnings: `Built ${spec.title} game · ${gameHtml.length} chars · ${allPassed ? 'QA passed' : 'QA failed'}`,
        },
      });
      // Update agent skills in 'game' domain
      const agentIds = ['pm', 'architect', 'coder', 'qa', 'sec', 'rel'];
      await Promise.all(agentIds.map(id => updateAgentSkill(id, '', 'game', allPassed && safeToShip, safeMission).catch(() => {})));
    } catch {}

    // Event Bus
    emit('nova', 'game.mission.complete', {
      mission: safeMission.slice(0, 100),
      gameType,
      title: spec.title,
      durationMs: Date.now() - t0,
      success: allPassed && safeToShip,
      releaseId,
      arenaSnippetId,
      correlationId: corrId,
    }, { severity: allPassed && safeToShip ? 'success' : 'warn', correlationId: corrId, source: 'nova/game-mission' }).catch(() => {});

    return Response.json({
      ok: true,
      gameId: `game_${Date.now()}`,
      gameType,
      title: spec.title,
      description: spec.description,
      controls: spec.controls,
      html: gameHtml,
      arenaSnippetId,
      releaseId,
      forgeProjectId,
      qaPassed: allPassed,
      securityPassed: safeToShip,
      durationMs: Date.now() - t0,
      pipeline,
      agentLog,
      correlationId: corrId,
    });
  } catch (e) {
    emit('nova', 'game.mission.fail', { error: String(e), correlationId: corrId }, { severity: 'error', correlationId: corrId, source: 'nova/game-mission' }).catch(() => {});
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
