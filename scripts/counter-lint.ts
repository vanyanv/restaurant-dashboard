#!/usr/bin/env tsx
/**
 * The five CLAUDE.md tripwires, as a build failure instead of prose.
 *
 * They were prose for months and were violated repeatedly — which is what a
 * tripwire being hit means. Text-level checks are used deliberately: they
 * cost nothing, need no build, and run on a file the moment it is written.
 *
 * These are regex checks over source text, not an AST. That is a deliberate
 * trade of soundness for cost and speed, and it has known holes — see the
 * false-negative and false-positive notes on each rule below and in
 * task-15-report.md. A hole that is written down is a limitation; a hole
 * that isn't is a trap, so every one found during review is recorded rather
 * than silently patched over with more regex.
 *
 * --- The LEGACY skip list, and why it can only shrink ---
 *
 * `src/app/dashboard/**` and `src/app/(mobile)/m/**` are ~80 pages of the
 * pre-Counter editorial design. They violate these rules extensively and
 * are deleted phase-by-phase over the Counter rebuild — that is expected,
 * not a bug in the linter. LEGACY exempts them, but the exemption is keyed
 * to file *content*, not just file *path*:
 *
 *   A file under a LEGACY path is exempt from a rule only if its current
 *   on-disk content is byte-identical to what that same path held at
 *   LEGACY_BASELINE_COMMIT (the commit this gate was introduced on).
 *
 * Two consequences fall out of that for free, without any manual
 * bookkeeping per file:
 *
 *   1. A NEW file added under a legacy directory (e.g. someone starts a
 *      Counter page inside src/app/dashboard/ instead of waiting for its
 *      phase) did not exist at the baseline commit, so `git show
 *      <baseline>:<path>` fails and the file is linted normally — the
 *      exemption never applies to it.
 *   2. An EXISTING legacy file that gets rewritten (onto Counter, or for
 *      any other reason) no longer matches its baseline content, so it
 *      also loses the exemption immediately — including on an uncommitted
 *      working-tree edit, since the comparison is against what's on disk
 *      right now, not against git HEAD.
 *
 * So the list can only ever shrink in effect: as a legacy directory's files
 * get rewritten one by one, each rewritten file starts being linted for
 * real. Once every file under an entry has moved, the entry suppresses
 * nothing, and `tests/styles/counter-lint.test.ts` fails the "still
 * suppressing at least one real violation" check for that entry until it is
 * deleted — that's what stops it from becoming a permanent, unjustified
 * exemption.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { execFileSync } from "node:child_process"

export interface Violation {
  file: string
  line: number
  rule: string
  text: string
}

/** Colour written as a literal rather than taken from a token. */
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\boklch\(|\brgba?\(|\bhsla?\(/
/** Any Tailwind palette colour. Counter's own utilities are all `ct-` prefixed. */
const TAILWIND_PALETTE =
  /\b(?:bg|text|border|ring|fill|stroke|from|via|to|decoration|outline|shadow|accent|caret|divide)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/
/** State branching belongs to surface/, never to a page. */
const STATUS_BRANCH =
  /\.status\s*(?:===|!==)|\bcase\s+["'](?:ready|stale|loading|failed|empty|not_computed)["']/
const DIRECT_DATA_IMPORT =
  /from\s+["'](?:@\/lib\/prisma|@\/app\/actions\/[^"']+|@prisma\/client)["']/
const DIRECT_MOTION_IMPORT = /from\s+["'](?:framer-motion|motion\/react)["']/

/** surface/ and state/ are where the exemptions live — they implement the rules. */
const STATUS_BRANCH_ALLOWED = /[/\\]components[/\\]counter[/\\](?:surface|state)[/\\]/
const MOTION_ALLOWED = /[/\\]components[/\\]counter[/\\]motion[/\\]/
const DATA_ALLOWED = /[/\\]lib[/\\]counter[/\\]adapters[/\\]/
const COLOUR_ALLOWED = /counter\.css$/

const RULES: Array<{
  name: string
  pattern: RegExp
  allowed?: RegExp
  extensions: readonly string[]
}> = [
  { name: "no-colour-literal", pattern: COLOUR_LITERAL, allowed: COLOUR_ALLOWED, extensions: [".tsx", ".ts", ".css"] },
  { name: "no-tailwind-palette", pattern: TAILWIND_PALETTE, extensions: [".tsx", ".ts"] },
  { name: "no-status-branch", pattern: STATUS_BRANCH, allowed: STATUS_BRANCH_ALLOWED, extensions: [".tsx"] },
  { name: "no-direct-data-import", pattern: DIRECT_DATA_IMPORT, allowed: DATA_ALLOWED, extensions: [".tsx"] },
  { name: "no-direct-motion-import", pattern: DIRECT_MOTION_IMPORT, allowed: MOTION_ALLOWED, extensions: [".tsx", ".ts"] },
]

/**
 * The commit this gate was introduced on (verified baseline: `npm test` 161
 * files / 1803 passed / 8 skipped, tsc clean, build green). Every LEGACY
 * entry's exemption is measured against the content of files at this
 * commit — see the module doc comment above.
 */
const LEGACY_BASELINE_COMMIT = "aecadf0f90c87bb7d0dc9c3ccb05f7bade67466b"

/**
 * Pre-Counter directories still on the old editorial design. Each entry
 * must name the phase or page that deletes it — an entry nobody can justify
 * is an entry that becomes permanent. Prefer the coarsest honest
 * granularity (a directory, not 80 files), but never wider than a tree that
 * is wholly legacy today.
 */
export const LEGACY: Array<{ path: string; reason: string }> = [
  {
    path: "src/app/dashboard",
    reason:
      "Entire tree is the pre-Counter editorial dashboard (~20 rebuild phases replace it page by page per spec §2.3). Shrink this by moving to per-page or per-subtree entries once the first pages are rebuilt, rather than leaving the whole directory listed after partial migration.",
  },
  {
    path: "src/app/(mobile)/m",
    reason:
      "Entire tree is the pre-Counter editorial mobile shell, deleted when mobile is rebuilt on Counter (see project_mobile_direction.md — mobile rebuild has not started as of this gate).",
  },
]

function walk(dir: string): string[] {
  let out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out = out.concat(walk(full))
    else out.push(full)
  }
  return out
}

function repoRelative(absPath: string): string {
  return relative(process.cwd(), absPath).split(sep).join("/")
}

function legacyEntryFor(absPath: string): { path: string; reason: string } | undefined {
  const rel = repoRelative(absPath)
  return LEGACY.find((e) => rel === e.path || rel.startsWith(e.path + "/"))
}

/** rel path (posix, repo-root-relative) -> content at LEGACY_BASELINE_COMMIT, or null if absent there. */
const baselineCache = new Map<string, string | null>()

function baselineContent(rel: string): string | null {
  const cached = baselineCache.get(rel)
  if (cached !== undefined) return cached
  let content: string | null
  try {
    content = execFileSync("git", ["show", `${LEGACY_BASELINE_COMMIT}:${rel}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
  } catch {
    content = null // did not exist at baseline (or git unavailable) — treat as not exempt
  }
  baselineCache.set(rel, content)
  return content
}

/**
 * True if `absPath` sits under a LEGACY entry AND its current content is
 * byte-identical to its content at the baseline commit. A new file, or an
 * edited legacy file, returns false and is linted normally.
 */
function isLegacyUnchanged(absPath: string, currentContent: string): boolean {
  const entry = legacyEntryFor(absPath)
  if (!entry) return false
  const base = baselineContent(repoRelative(absPath))
  if (base === null) return false
  return base === currentContent
}

export function lintCounter(
  roots: string[],
  opts: { ignoreLegacy?: boolean } = {},
): Violation[] {
  const violations: Violation[] = []
  for (const root of roots) {
    let files: string[]
    try {
      files = walk(root)
    } catch {
      continue // a root that does not exist yet is not a violation
    }
    for (const file of files) {
      const rules = RULES.filter(
        (r) => r.extensions.some((e) => file.endsWith(e)) && !r.allowed?.test(file),
      )
      if (rules.length === 0) continue
      const content = readFileSync(file, "utf8")
      if (!opts.ignoreLegacy && isLegacyUnchanged(file, content)) continue
      const lines = content.split("\n")
      lines.forEach((text, i) => {
        if (text.trimStart().startsWith("//") || text.trimStart().startsWith("*")) return
        for (const rule of rules) {
          if (rule.pattern.test(text)) {
            violations.push({
              file: relative(process.cwd(), file),
              line: i + 1,
              rule: rule.name,
              text: text.trim(),
            })
          }
        }
      })
    }
  }
  return violations
}

const ROOTS = [
  join(process.cwd(), "src", "app", "dashboard"),
  join(process.cwd(), "src", "app", "(mobile)", "m"),
  join(process.cwd(), "src", "components", "counter"),
  join(process.cwd(), "src", "lib", "counter"),
]

/** CLI entry. The test imports lintCounter directly; this is `npm run tokens`. */
if (process.argv[1]?.endsWith("counter-lint.ts")) {
  const found = lintCounter(ROOTS)
  for (const v of found) {
    console.error(`${v.file}:${v.line}  ${v.rule}\n    ${v.text}`)
  }
  if (found.length > 0) {
    console.error(`\n${found.length} Counter rule violation(s). See DESIGN.md.`)
    process.exit(1)
  }
  console.log("Counter rules: clean")
}
