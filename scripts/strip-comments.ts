/**
 * Shared by `counter-lint.ts` and `page-layout-lint.ts` so both rules strip
 * comments the same string-aware way (a `"image/*"` attribute is a string,
 * not the start of a block comment).
 */
/**
 * Strips `//` line comments and block comments out of source
 * text before any rule pattern runs, so a colour literal or specifier
 * mentioned only in a comment can't false-positive a rule. Every stripped
 * character (other than a newline) is replaced with a single space rather
 * than deleted, so:
 *   - the result has the exact same number of lines as the input, and
 *   - column positions within a line are preserved too,
 * which is what keeps `Violation.line` pointing at the real line rather
 * than drifting once a comment above it is removed.
 *
 * String and template literals are tracked (with backslash-escape
 * handling) so a `//` or block-comment-looking sequence *inside* a string is left
 * alone — e.g. a URL string containing "//" is not treated as a comment
 * start. This is a simplification, not a full tokenizer: a `${...}`
 * expression inside a template literal is treated as opaque string content
 * along with everything else between the backticks, so a genuine comment
 * written inside a template expression (a rare, unidiomatic thing to write)
 * would not be stripped. Not fixed — no known file does this.
 */
export function stripComments(source: string): string {
  let out = ""
  let i = 0
  const n = source.length
  let inString: '"' | "'" | "`" | null = null
  while (i < n) {
    const c = source[i]
    const c2 = i + 1 < n ? source[i + 1] : ""
    if (inString) {
      if (c === "\\" && i + 1 < n) {
        out += c + source[i + 1]
        i += 2
        continue
      }
      out += c
      if (c === inString) inString = null
      i += 1
      continue
    }
    if (c === '"' || c === "'" || c === "`") {
      inString = c
      out += c
      i += 1
      continue
    }
    if (c === "/" && c2 === "/") {
      while (i < n && source[i] !== "\n") {
        out += " "
        i += 1
      }
      continue
    }
    if (c === "/" && c2 === "*") {
      out += "  "
      i += 2
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " "
        i += 1
      }
      if (i < n) {
        out += "  "
        i += 2
      }
      continue
    }
    out += c
    i += 1
  }
  return out
}
