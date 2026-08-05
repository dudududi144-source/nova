// JSON extraction utilities — robust parsing of LLM JSON output.
//
// LLMs often wrap JSON in prose, code fences, or emit multiple JSON objects.
// The naive indexOf('{')...lastIndexOf('}') approach breaks on:
// - trailing prose with a '}': {"a":1}\n\nHope this helps!}
// - multiple JSON objects: {...} {...}
// - nested braces in strings: {"a": "}"}
// - code fences: ```json\n{...}\n```
//
// The brace-balanced extractor walks from the first '{', counts depth
// (respecting string literals and escapes), and stops at the matching '}'.

/**
 * Extract the first balanced JSON object from a text string.
 * Skips leading prose, code fences, and whitespace.
 * Returns the parsed object, or throws if no valid JSON is found.
 */
export function extractBalancedJson(text: string): unknown {
  // Strip code fences if present (```json\n...\n``` or ```\n...\n```)
  const fenceMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i)
  const cleaned = fenceMatch ? fenceMatch[1] : text

  // Find the first '{'
  const start = cleaned.indexOf('{')
  if (start < 0) return null // v29.38: Return null instead of throwing

  // Walk from start, counting brace depth. Respect string literals and escapes.
  let depth = 0
  let inString = false
  let escaped = false
  let end = -1

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i]

    if (escaped) {
      escaped = false
      continue
    }

    if (ch === '\\' && inString) {
      escaped = true
      continue
    }

    if (ch === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }

  if (end < 0) throw new Error('No matching closing brace found')

  const jsonStr = cleaned.slice(start, end + 1)
  return JSON.parse(jsonStr)
}
