// POST /api/forge/deploy — Bridge between Nova and Forge.
// After Nova generates code, this route sends it to Forge for deployment.
// Flow: Nova build result → ZIP → Forge ingest → Forge build → Forge deploy → URL

import type { NextRequest } from 'next/server'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const FORGE_URL = process.env.FORGE_URL || 'https://forge.rabotatony.workers.dev'

interface ForgeDeployBody {
  buildId?: string
  html?: string
  files?: Array<{ path: string; content: string; language?: string }>
  projectName?: string
  mission?: string
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: ForgeDeployBody
  try {
    body = (await request.json()) as ForgeDeployBody
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const { html, files, projectName, mission } = body

  if (!html && (!files || files.length === 0)) {
    return Response.json({ ok: false, error: 'No content to deploy' }, { status: 400 })
  }

  logger.info('forge.deploy.started', {
    projectName: projectName || 'unnamed',
    hasHtml: !!html,
    fileCount: files?.length || 0,
  })

  try {
    // Step 1: Create project in Forge
    const projectResp = await fetch(FORGE_URL + '/api/forge/projects/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: projectName || 'nova-build-' + Date.now(),
      }),
    })

    if (!projectResp.ok) {
      const err = await projectResp.text()
      logger.error('forge.deploy.project_failed', { status: projectResp.status, error: err })
      return Response.json({ ok: false, error: 'Failed to create Forge project: ' + err }, { status: 502 })
    }

    const project = await projectResp.json()
    const projectId = project.id || project.project?.id

    if (!projectId) {
      return Response.json({ ok: false, error: 'No project ID returned from Forge' }, { status: 502 })
    }

    logger.info('forge.deploy.project_created', { projectId })

    // Step 2: Upload files to Forge
    const uploadFiles = files || [{ path: 'index.html', content: html || '', language: 'html' }]

    for (const file of uploadFiles) {
      const fileResp = await fetch(FORGE_URL + '/api/forge/projects/' + projectId + '/files/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: file.path,
          content: file.content,
        }),
      })

      if (!fileResp.ok) {
        logger.warn('forge.deploy.file_failed', { path: file.path, status: fileResp.status })
      }
    }

    logger.info('forge.deploy.files_uploaded', { count: uploadFiles.length })

    // Step 3: Trigger Forge build
    const buildResp = await fetch(FORGE_URL + '/api/forge/projects/' + projectId + '/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflow: 'build',
        trigger: 'nova-bridge',
      }),
    })

    const buildResult = buildResp.ok ? await buildResp.json() : null

    logger.info('forge.deploy.build_triggered', {
      projectId,
      status: buildResp.status,
    })

    return Response.json({
      ok: true,
      projectId,
      forgeUrl: FORGE_URL + '/projects/' + projectId,
      buildTriggered: buildResp.ok,
      filesUploaded: uploadFiles.length,
    })

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    logger.error('forge.deploy.error', { error: msg })
    return Response.json({ ok: false, error: msg }, { status: 500 })
  }
}
