// Structured logger — server-side only.
// One-line JSON logs to stdout. Greppable, filterable, parseable.
//
// Log level is controlled by the LOG_LEVEL env var (debug, info, warn, error).
// Default: info. In production: warn.
//
// Usage:
//   logger.info('build.started', { mission, ip })
//   logger.error('build.failed', { mission, error, ms })
//
// Output:
//   {"ts":"2025-01-01T00:00:00.000Z","level":"info","event":"build.started","mission":"snake","ip":"1.2.3.4"}

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
  [key: string]: unknown
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

function getCurrentLevel(): LogLevel {
  const env = process.env.LOG_LEVEL as LogLevel | undefined
  if (env && env in LEVEL_PRIORITY) return env
  return process.env.NODE_ENV === 'production' ? 'warn' : 'info'
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[getCurrentLevel()]
}

function log(level: LogLevel, event: string, ctx: LogContext = {}): void {
  if (!shouldLog(level)) return

  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...ctx,
  }
  // Wrap in try-catch — JSON.stringify can throw on circular references or BigInt values.
  // If it throws, the error would propagate up and crash the route handler.
  // Fall back to a safe string representation.
  let line: string
  try {
    line = JSON.stringify(entry)
  } catch {
    line = JSON.stringify({
      ts: entry.ts,
      level: entry.level,
      event: entry.event,
      error: 'log serialization failed (circular ref or BigInt)',
    })
  }
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  debug: (event: string, ctx?: LogContext) => log('debug', event, ctx),
  info: (event: string, ctx?: LogContext) => log('info', event, ctx),
  warn: (event: string, ctx?: LogContext) => log('warn', event, ctx),
  error: (event: string, ctx?: LogContext) => log('error', event, ctx),
  /** Get the current log level (for testing) */
  getLevel: (): LogLevel => getCurrentLevel(),
}
