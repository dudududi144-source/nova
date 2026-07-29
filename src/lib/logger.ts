// Structured logger — server-side only.
// One-line JSON logs to stdout. Greppable, filterable, parseable.
//
// Usage:
//   logger.info('build.started', { mission, ip })
//   logger.error('build.failed', { mission, error, ms })
//
// Output:
//   {"ts":"2025-01-01T00:00:00.000Z","level":"info","event":"build.started","mission":"snake","ip":"1.2.3.4"}

type LogLevel = 'info' | 'warn' | 'error'

interface LogContext {
  [key: string]: unknown
}

function log(level: LogLevel, event: string, ctx: LogContext = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...ctx,
  }
  const line = JSON.stringify(entry)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  info: (event: string, ctx?: LogContext) => log('info', event, ctx),
  warn: (event: string, ctx?: LogContext) => log('warn', event, ctx),
  error: (event: string, ctx?: LogContext) => log('error', event, ctx),
}
