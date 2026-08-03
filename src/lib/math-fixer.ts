// v27: Post-build fix for common math errors in generated apps.
// The LLM sometimes gets conversion formulas wrong (multiply instead of divide).
// This module scans the generated HTML for known conversion patterns and
// fixes them if the formula is inverted.

import { logger } from './logger'

interface ConversionFix {
  pattern: RegExp
  fix: (html: string, match: RegExpMatchArray) => string
  description: string
}

const CONVERSION_FIXES: ConversionFix[] = [
  // Fix meter to kilometer: should divide by 1000, not multiply
  {
    pattern: /(\w+)\s*\*\s*1000/g,
    fix: (html, match) => {
      // Only fix if context suggests unit conversion
      const context = html.slice(Math.max(0, match.index! - 200), match.index! + 200)
      if (/meter|kilometer|km|m\b/i.test(context)) {
        return html.slice(0, match.index!) + match[1] + ' / 1000' + html.slice(match.index! + match[0].length)
      }
      return html
    },
    description: 'Fix meter→km: multiply→divide by 1000',
  },
]

export function fixConversionMath(html: string): string {
  let result = html
  let fixesApplied = 0

  for (const fix of CONVERSION_FIXES) {
    const matches = [...result.matchAll(fix.pattern)]
    for (const match of matches) {
      const before = result
      result = fix.fix(result, match)
      if (result !== before) {
        fixesApplied++
        logger.info('postfix.conversion', { fix: fix.description })
      }
    }
  }

  if (fixesApplied > 0) {
    logger.info('postfix.conversions_applied', { count: fixesApplied })
  }

  return result
}

/**
 * Verify math in generated HTML by testing common conversions.
 * Returns a list of issues found.
 */
export function verifyMath(html: string): { ok: boolean; issues: string[] } {
  const issues: string[] = []
  const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || []
  const scriptText = scriptMatch.map(s => s.replace(/<\/?script[^>]*>/gi, '')).join('\n')

  // Check for common inverted formulas
  // If we see * 1000 near meter/km context, it's likely wrong
  if (/meter.*\*\s*1000|1000\s*\*.*meter/i.test(scriptText)) {
    issues.push('Meter conversion uses multiply by 1000 (should divide)')
  }

  return { ok: issues.length === 0, issues }
}
