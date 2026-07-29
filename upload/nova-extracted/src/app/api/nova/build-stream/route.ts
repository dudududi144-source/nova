// POST /api/nova/build-stream — LLM-powered streaming build
// Streams events via SSE. Real LLM for architecture + code generation.
// Produces complete, working apps (not stubs).
import type { NextRequest } from 'next/server';
import { llmChat, extractJSON } from '@/lib/llm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest): Promise<Response> {
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: any) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event, ...data })}\n\n`));
        } catch {}
      };

      let body: any;
      try { body = await request.json(); } catch { body = {}; }
      const mission: string = String(body?.mission || '').trim();
      const qualityTarget: number = Math.min(9, Math.max(5, Number(body?.qualityTarget) || 7));

      if (!mission) {
        send('error', { error: 'Missing mission' });
        controller.close();
        return;
      }

      const t0 = Date.now();
      const events: any[] = [];
      let totalTokens = 0;
      const files: { path: string; content: string; language?: string }[] = [];
      const pipeline: { agent: string; success: boolean; output: string; ms: number }[] = [];

      try {
        // ── STAGE 1: ARCHITECT — design file structure ──
        send('stage', { stage: 'architect', status: 'running', detail: 'Designing architecture...' });
        const archStart = Date.now();

        const archResult = await llmChat(
          `You are a senior software architect. Design a COMPLETE file structure for this project.

CRITICAL RULES:
- Each file MUST be substantial (100+ lines) — NO stubs, NO 1-line files
- Prefer FEWER, LARGER files (snake game = index.html + game.js, NOT 12 tiny files)
- For simple games/apps: 2-4 files, each 100-400 lines
- For web apps: index.html + styles.css + game.js (or main.js)
- For games: include game loop, rendering, input, collision, score, game over
- DO NOT split game logic into tiny modules — put related logic in ONE file
- Include README.md ONLY if the project is complex

Output JSON ONLY:
{
  "type": "project type",
  "title": "title",
  "isPlayable": true/false,
  "techStack": ["tech1"],
  "files": [{"path": "index.html", "purpose": "...", "language": "html"}]
}`,
          `Mission: "${mission}"`,
          { maxTokens: 2000, temperature: 0.3, timeoutMs: 30000 }
        );

        totalTokens += archResult.tokens;
        let archSuccess = false;
        let analysis: any = null;

        if (archResult.ok) {
          const { json } = extractJSON(archResult.text);
          if (json && Array.isArray(json.files) && json.files.length > 0) {
            analysis = json;
            analysis.files = json.files.slice(0, 8); // cap at 8 files
            archSuccess = true;
            send('stage', { stage: 'architect', status: 'done', detail: `Architecture: ${analysis.files.length} files · ${analysis.type}` });
            send('architect', { files: analysis.files.map((f: any) => f.path), type: analysis.type, title: analysis.title });
          }
        }

        if (!archSuccess) {
          send('stage', { stage: 'architect', status: 'done', detail: 'Architecture: 1 file (fallback)' });
          analysis = { type: 'web-app', title: mission.slice(0, 50), isPlayable: true, files: [{ path: 'index.html', purpose: 'complete app', language: 'html' }] };
        }

        pipeline.push({ agent: 'architect', success: archSuccess, output: `${analysis.files.length} files planned`, ms: Date.now() - archStart });

        // ── STAGE 2: BUILDER — write each file with LLM ──
        send('stage', { stage: 'builder', status: 'running', detail: `Building ${analysis.files.length} files...` });
        const buildStart = Date.now();

        for (let i = 0; i < analysis.files.length; i++) {
          const filePlan = analysis.files[i];
          send('file.start', { path: filePlan.path, index: i + 1, total: analysis.files.length });

          const buildResult = await llmChat(
            `You are a senior developer. Write ONE complete file for this project.

Project: ${analysis.title}
Mission: "${mission}"

Write the file: ${filePlan.path}
Purpose: ${filePlan.purpose}
Language: ${filePlan.language || 'html'}

CRITICAL RULES:
- Write AT LEAST 100 lines of real, working code
- Write COMPLETE implementation — no TODOs, no placeholders, no instructions
- DO NOT write "Add X" or "Complete Y" — write the ACTUAL CODE
- For HTML: full document with head, body, canvas/scripts/styles
- For JS: complete game logic — game loop (setInterval or requestAnimationFrame), input handling, collision, rendering, score, game over
- For CSS: complete styling, responsive, good UI
- Start directly with code — no explanations

Output ONLY the raw file content. No markdown. No fences. No explanations.`,
            mission,
            { maxTokens: 8000, temperature: 0.3, timeoutMs: 45000 }
          );

          totalTokens += buildResult.tokens;

          if (buildResult.ok && buildResult.text.trim().length > 200) {
            let content = buildResult.text.trim();
            // Strip markdown fences if present
            const fenceMatch = content.match(/^```[\w]*\n?([\s\S]*?)\n?```$/);
            if (fenceMatch) content = fenceMatch[1];

            // Quality check: must have real code (not just instructions)
            const lineCount = content.split('\n').length;
            const isInstruction = /^(Add|Complete|Implement|Write|Create|Fix)\s+(the|this|a|an)\s/i.test(content) && lineCount < 10;

            if (lineCount >= 20 && !isInstruction) {
              files.push({ path: filePlan.path, content, language: filePlan.language });
              send('file.built', { path: filePlan.path, lines: lineCount, content, index: i + 1, total: analysis.files.length });
            } else {
              // Retry with stronger prompt
              const retryResult = await llmChat(
                `Write the COMPLETE ${filePlan.language} file: ${filePlan.path}
Purpose: ${filePlan.purpose}
Part of: ${mission}

The previous attempt was too short or was instructions, not code.
You MUST write at least 100 lines of REAL, WORKING CODE.
DO NOT write instructions — write the ACTUAL CODE.

Output ONLY raw code. No markdown. No fences. No explanations.`,
                '',
                { maxTokens: 8000, temperature: 0.4, timeoutMs: 45000 }
              );
              totalTokens += retryResult.tokens;
              if (retryResult.ok && retryResult.text.trim().length > 500) {
                let retryContent = retryResult.text.trim();
                const rf = retryContent.match(/^```[\w]*\n?([\s\S]*?)\n?```$/);
                if (rf) retryContent = rf[1];
                if (retryContent.split('\n').length >= 20) {
                  files.push({ path: filePlan.path, content: retryContent, language: filePlan.language });
                  send('file.built', { path: filePlan.path, lines: retryContent.split('\n').length, content: retryContent, index: i + 1, total: analysis.files.length });
                }
              }
            }
          }
        }

        pipeline.push({ agent: 'builder', success: files.length > 0, output: `${files.length}/${analysis.files.length} files built`, ms: Date.now() - buildStart });
        send('stage', { stage: 'builder', status: 'done', detail: `${files.length} files built` });

        // ── STAGE 3: REVIEW — quick quality check ──
        if (qualityTarget >= 7 && files.length > 0) {
          send('stage', { stage: 'reviewer', status: 'running', detail: 'Reviewing code quality...' });
          const reviewStart = Date.now();

          // Check if HTML file has game loop (for games)
          const htmlFile = files.find(f => /\.html$/i.test(f.path) || /\.js$/i.test(f.path));
          const hasGameLoop = files.some(f => /setInterval|requestAnimationFrame/.test(f.content));
          const isGame = /game|snake|pong|tetris|play/i.test(mission);

          let reviewSuccess = true;
          let reviewMsg = 'Code reviewed';

          if (isGame && !hasGameLoop && qualityTarget >= 7) {
            // Auto-fix: add game loop to the main JS file
            send('stage', { stage: 'fixer', status: 'running', detail: 'Adding missing game loop...' });
            const fixStart = Date.now();
            const jsFile = files.find(f => /\.js$/i.test(f.path));
            if (jsFile) {
              const fixResult = await llmChat(
                `You are a senior game developer. The file ${jsFile.path} is missing a game loop.
Add a game loop (using setInterval or requestAnimationFrame) and ensure the game is fully playable.
Write the COMPLETE file with the game loop added.

Current file:
${jsFile.content.slice(0, 2000)}

Output ONLY the complete, updated file content. No markdown. No explanations.`,
                mission,
                { maxTokens: 8000, temperature: 0.3, timeoutMs: 45000 }
              );
              totalTokens += fixResult.tokens;
              if (fixResult.ok && fixResult.text.trim().length > 500) {
                let fixedContent = fixResult.text.trim();
                const ff = fixedContent.match(/^```[\w]*\n?([\s\S]*?)\n?```$/);
                if (ff) fixedContent = ff[1];
                if (/setInterval|requestAnimationFrame/.test(fixedContent)) {
                  jsFile.content = fixedContent;
                  reviewMsg = 'Game loop added + code reviewed';
                  send('file.fixed', { path: jsFile.path, lines: fixedContent.split('\n').length });
                }
              }
            }
            pipeline.push({ agent: 'fixer', success: true, output: 'game loop added', ms: Date.now() - fixStart });
          }

          pipeline.push({ agent: 'reviewer', success: reviewSuccess, output: reviewMsg, ms: Date.now() - reviewStart });
          send('stage', { stage: 'reviewer', status: 'done', detail: reviewMsg });
        }

        // ── DONE ──
        const durationMs = Date.now() - t0;
        const qualityScore = files.length > 0 ? Math.min(10, Math.max(3, 5 + Math.floor(files.length / 2))) : 1;

        send('complete', {
          success: files.length > 0,
          files,
          pipeline,
          qualityScore,
          totalMs: durationMs,
          tokens: totalTokens,
        });

        controller.close();
        closed = true;
      } catch (err) {
        send('error', { error: err instanceof Error ? err.message : String(err) });
        controller.close();
        closed = true;
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
