// Code sanitizer — fixes common LLM tokenization artifacts
export function sanitizeCode(code: string): string {
  let fixed = code;
  // Fix "arrid]" → arr + [mid] (LLM tokenization bug)
  const target = "arr" + String.fromCharCode(91) + "mid" + String.fromCharCode(93);
  fixed = fixed.split("arrid]").join(target);
  // Fix other variables
  const vars = ["data", "list", "nums", "val", "res", "ret", "out", "items"];
  const mid = String.fromCharCode(91) + "mid" + String.fromCharCode(93);
  for (const v of vars) {
    fixed = fixed.split(v + "id]").join(v + mid);
  }
  // Fix double commas
  fixed = fixed.replace(/,\s*,/g, ",");
  return fixed;
}
