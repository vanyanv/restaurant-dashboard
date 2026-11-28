import { KEY_NAME_PATTERN, isNeverShownKey } from "@/lib/counter/connections"

/**
 * Writes the text of a `.env.local`.
 *
 * Pure: it is handed names and values and returns text. The quoting follows
 * what Next's own loader (`@next/env`) reads back, measured on 2026-11-27:
 *
 * - `$NAME` is expanded in every style of value, quoted or not, and `\$` is
 *   read back as a plain `$`. So every `$` is written as `\$`.
 * - Single quotes and backticks keep the text exactly. Double quotes turn the
 *   two characters `\n` into a line break and do not undo `\"`.
 * - The loader turns every carriage return in the file into a line break
 *   before it reads anything, so a raw one inside quotes comes back changed.
 *   Only double quotes can carry one, written as the two characters `\r`.
 *
 * Two rules do not depend on the caller getting it right: a name that is not
 * the shape of a key (`KEY_NAME_PATTERN`) writes nothing at all, and a key on
 * the never-shown list is written as a comment without its value.
 *
 * `tests/lib/developer/env-file.test.ts` writes awkward values with this and
 * reads them back through `@next/env` to prove they survive.
 */

export interface EnvFileKey {
  name: string
  value: string
  /** A plain sentence written above the line as a comment. */
  note?: string
  /**
   * True for a key whose live value is never copied. `value` is ignored (pass
   * ""), and the line written is a comment telling the reader to make their
   * own. Keys on the never-shown list are treated this way whether or not
   * this is set.
   */
  withheld?: boolean
}

export interface EnvFileGroup {
  /** The connection's name, written as `# Name`. */
  title: string
  keys: EnvFileKey[]
}

export interface EnvFileInput {
  /** When the file was made. */
  madeAt: Date
  groups: EnvFileGroup[]
  /** Names Vercel cannot hand over, listed at the bottom for setting by hand. */
  byHand: string[]
}

/** One comment line: line breaks would end the comment and start a real line. */
function comment(text: string): string {
  return `# ${text.replace(/[\r\n]+/g, " ")}`
}

/**
 * The right-hand side of `NAME=`, or null when no quoting can carry the value
 * (it holds a line break or awkward characters and all three kinds of quote).
 */
export function quoteEnvValue(raw: string): string | null {
  const v = raw.replace(/\$/g, "\\$")
  if (v === "") return ""

  const hasBreak = /[\r\n]/.test(v)
  if (!hasBreak && !/[\s#'"`]/.test(v)) return v

  // A backslash just before the closing quote would be read as escaping it.
  if (v.endsWith("\\")) return null

  const hasSingle = v.includes("'")
  const hasDouble = v.includes('"')
  const hasTick = v.includes("`")

  if (hasBreak) {
    // One line, breaks written as \n, when double quotes can hold it: no
    // double quote inside, and no backslash-n the loader would mistake for a break.
    if (!hasDouble && !/\\[nr]/.test(v)) {
      return `"${v.replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`
    }
    // Otherwise real line breaks inside a quote that keeps text exactly. Not
    // for a carriage return: the loader reads a raw one back as a line break,
    // so the value would arrive changed with nothing to say so.
    if (v.includes("\r")) return null
    if (!hasSingle) return `'${v}'`
    if (!hasTick) return `\`${v}\``
    return null
  }

  if (!hasSingle) return `'${v}'`
  if (!hasDouble && !/\\[nr]/.test(v)) return `"${v}"`
  if (!hasTick) return `\`${v}\``
  return null
}

export interface EnvFileOutput {
  text: string
  /** How many `NAME=value` lines were written. */
  written: number
  /** Names whose value could not be written safely and must be copied one at a time. */
  skipped: string[]
}

/** What a withheld key's line tells the reader to do instead. */
const MAKE_YOUR_OWN = "make your own with: openssl rand -base64 32"

export function buildEnvFile(input: EnvFileInput): EnvFileOutput {
  const lines: string[] = [
    "# .env.local",
    "# These are the LIVE site's values. Anyone holding this file can reach the live data.",
    "# Keep it on your own computer. Never commit it, email it or paste it into a chat.",
    `# Made ${input.madeAt.toISOString()}`,
  ]
  let written = 0
  const skipped: string[] = []

  for (const group of input.groups) {
    // A name of any other shape is not written anywhere, not even in a comment.
    const keys = group.keys.filter((key) => typeof key.name === "string" && KEY_NAME_PATTERN.test(key.name))
    if (keys.length === 0) continue
    lines.push("", comment(group.title))
    for (const key of keys) {
      if (key.withheld || isNeverShownKey(key.name)) {
        lines.push(comment(`${key.name}=  (not copied on purpose: ${MAKE_YOUR_OWN})`))
        continue
      }
      if (key.note) lines.push(comment(key.note))
      const quoted = quoteEnvValue(key.value)
      if (quoted === null) {
        skipped.push(key.name)
        lines.push(comment(`${key.name}= could not be written here. Copy this one on its own.`))
        continue
      }
      lines.push(`${key.name}=${quoted}`)
      written++
    }
  }

  const byHand = input.byHand.filter((name) => typeof name === "string" && KEY_NAME_PATTERN.test(name))
  if (byHand.length > 0) {
    lines.push(
      "",
      "# Only the timed jobs on GitHub hold these. Set this by hand if you need it:",
      ...byHand.map((name) => `# ${name}=`),
    )
  }

  return { text: lines.join("\n") + "\n", written, skipped }
}
