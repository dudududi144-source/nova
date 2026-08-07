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
  // BUGFIX v29.34: Only fix when converting FROM meters TO km (meters * 1000 is WRONG)
  // Do NOT fix km * 1000 (that's correct — km → meters)
  {
    pattern: /\b(meters?|metres?)\s*\*\s*1000\b/gi,
    fix: (html, match) => {
      // Replace meters * 1000 with meters / 1000
      const replacement = match[0].replace(/\s*\*\s*/, ' / ')
      return html.slice(0, match.index!) + replacement + html.slice(match.index! + match[0].length)
    },
    description: 'Fix meter→km: multiply→divide by 1000',
  },
  // Fix kilometer to meter: should multiply by 1000, not divide
  // BUGFIX v29.34: Only fix when converting FROM km TO meters (km / 1000 is WRONG)
  {
    pattern: /\b(km|kilometers?|kilometres?)\s*\/\s*1000\b/gi,
    fix: (html, match) => {
      const replacement = match[0].replace(/\s*\/\s*/, ' * ')
      return html.slice(0, match.index!) + replacement + html.slice(match.index! + match[0].length)
    },
    description: 'Fix km→meter: divide→multiply by 1000',
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
