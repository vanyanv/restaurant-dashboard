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
 *
 * --- Fix round 1 (closed holes) ---
 *
 *   - Comments are stripped (see `stripComments`) before any rule runs, so a
 *     hex colour mentioned in a trailing `//` comment, or in a block comment
 *     that opens on a line with real code, no longer false-positives
 *     `no-colour-literal`. Stripping preserves line numbers (newlines are
 *     kept; every other comment character becomes a space) so a reported
 *     `Violation.line` still points at the real line.
 *   - `no-direct-motion-import` and `no-direct-data-import` also match the
 *     dynamic forms `import("framer-motion")` / `await import(...)` and
 *     `require(...)`, not just static `from "..."` — those are exactly what
 *     someone reaches for once the static form starts failing the gate.
 *   - `no-status-branch` no longer applies under `src/lib/counter/**`. See
 *     the comment on `STATUS_BRANCH_ALLOWED` for why.
 *
 * --- Fix round 2 (C2, final whole-branch review) ---
 *
 *   - `git show <baseline>:<path>` exiting non-zero was being treated as one
 *     thing — "not exempt" — when it is actually two different things: the
 *     path genuinely did not exist at the baseline (real signal, keep
 *     linting it), or git could not read the baseline commit at all (an
 *     environment problem — a shallow checkout, `actions/checkout@v6`'s
 *     default `fetch-depth: 1` among them — that made EVERY legacy file
 *     fail identically, degrading an ~80-page exemption to nothing and
 *     flooding `npm run tokens` with false violations, which in turn failed
 *     `tests/styles/counter-lint.test.ts`'s "still suppressing a real
 *     violation" assertions on a shallow CI checkout). `isCommitReachable`
 *     now checks commit reachability once, separately from any path, and
 *     `isLegacyUnchanged` throws `BaselineUnreachableError` — loudly, naming
 *     the cause and the remedy — instead of silently returning "not exempt"
 *     for that case. See `BaselineUnreachableError`'s own doc comment.
 *
 * --- Known holes, left as regex-over-text limitations (not fixed) ---
 *
 *   - Dynamic Tailwind classes: `` `bg-${color}-500` `` or
 *     `cn("bg-", color, "-500")` have no literal palette-name substring to
 *     match. Catching these needs evaluating the string, which is out of
 *     reach for a text check — and the workaround (banning template
 *     interpolation in className) would be worse than the hole.
 *   - Destructured status: `const { status } = section; if (status ===
 *     "loading")` — `STATUS_BRANCH` only matches the literal `.status`
 *     accessor, not a destructured local.
 *   - Barrel re-export: `import { prisma } from "@/lib/db"` where
 *     `@/lib/db` itself re-exports `@/lib/prisma` — only the exact
 *     specifiers in `DIRECT_DATA_IMPORT` are matched.
 *   - Legitimate dynamic `` `rgb(${r},${g},${b})` `` (e.g. a canvas pixel
 *     buffer or a chart gradient stop built at runtime) still matches
 *     `no-colour-literal` after the comment-stripping fix — it's the
 *     substring `rgb(` the rule is looking for, not a static literal, and
 *     the rule can't distinguish "raw colour bypassing the token system"
 *     from "raw colour because the domain genuinely needs one". No consumer
 *     of this exists yet; when the first Counter chart primitive needs it,
 *     the honest options are a narrow allowlist for that one file, or an
 *     inline suppression comment on that one line — do not build either
 *     speculatively.
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
/**
 * State branching on `SectionData.status` belongs to `surface/` and
 * `state/`, which RENDER it — never to the app routes (pages) that consume
 * it. That is the whole rule: `src/app/dashboard/**` and
 * `src/app/(mobile)/m/**` are exactly where it needs to hold.
 *
 * It is intentionally not implemented as a positive "only inside
 * src/app/**" allowlist — that would also swallow the fixture-based tests
 * in tests/styles/counter-lint.test.ts, which deliberately live outside
 * src/app so the rule can be exercised without a real page. Instead it is
 * exempted everywhere it does NOT apply, via STATUS_BRANCH_ALLOWED below:
 * the surface/state components that implement the branching, and
 * `src/lib/counter/**`. Adapters under src/lib/counter CONSTRUCT
 * SectionData — including branching on ordinary HTTP response statuses,
 * which are not `SectionData.status` and were never what this rule was
 * protecting — they don't render it, so an adapter checking
 * `response.status === 404` is not a counter-example to the rule's intent
 * and must not be flagged. Do not narrow STATUS_BRANCH_ALLOWED back to just
 * `lib/counter/adapters/` thinking the wider `lib/counter/**` exemption was
 * an oversight — it is deliberate, because nothing under src/lib/counter is
 * a page.
 */
const STATUS_BRANCH =
  /\.status\s*(?:===|!==)|\bcase\s+["'](?:ready|stale|loading|failed|empty|not_computed)["']/
/**
 * Matches both the static `from "..."` form and the dynamic
 * `import("...")` / `require("...")` forms — the latter are exactly what
 * someone reaches for once the static import starts failing this gate.
 */
const DIRECT_DATA_SPECIFIERS = String.raw`@\/lib\/prisma|@\/app\/actions\/[^"']+|@prisma\/client`
const DIRECT_DATA_IMPORT = new RegExp(
  String.raw`from\s+["'](?:${DIRECT_DATA_SPECIFIERS})["']|\b(?:import|require)\s*\(\s*["'](?:${DIRECT_DATA_SPECIFIERS})["']`,
)
const DIRECT_MOTION_SPECIFIERS = String.raw`framer-motion|motion\/react`
const DIRECT_MOTION_IMPORT = new RegExp(
  String.raw`from\s+["'](?:${DIRECT_MOTION_SPECIFIERS})["']|\b(?:import|require)\s*\(\s*["'](?:${DIRECT_MOTION_SPECIFIERS})["']`,
)

/** surface/ and state/ implement the status-branch rule; lib/counter constructs data, it doesn't render it — see the comment on STATUS_BRANCH above. */
const STATUS_BRANCH_ALLOWED =
  /[/\\]components[/\\]counter[/\\](?:surface|state)[/\\]|[/\\]lib[/\\]counter[/\\]/
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
function stripComments(source: string): string {
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

/**
 * Raised when the LEGACY exemption is asked to compare against a baseline
 * commit that git cannot read locally at all — as opposed to a commit it
 * CAN read, where a given path simply wasn't there yet (that case is a
 * real, meaningful `null` from `baselineContentAt`, not this).
 *
 * The distinction matters because `actions/checkout@v6`'s default
 * `fetch-depth: 1` gives a repo with only the tip commit — every
 * `git show <baseline>:<path>` then fails identically, for every file,
 * regardless of whether that file is genuinely new. Treating that the same
 * as "not exempt" (the original bug) silently shrinks an ~80-page
 * exemption to nothing and floods the lint with false violations. This
 * error exists so that failure mode is loud and named, not indistinguishable
 * from a real content mismatch.
 */
export class BaselineUnreachableError extends Error {
  constructor(commit: string) {
    super(
      `LEGACY exemption check failed: commit ${commit} is not reachable in this ` +
        `git checkout (git cat-file -e ${commit}^{commit} failed). This is almost always a ` +
        `shallow clone — actions/checkout@v6 defaults to fetch-depth: 1, which fetches only ` +
        `the tip commit, so 'git show <baseline>:<path>' fails identically for every legacy ` +
        `file whether or not that file actually changed. That is an environment problem, not ` +
        `a lint result: it must not be allowed to silently degrade into linting ~80 legacy ` +
        `pages that are deliberately exempt.\n` +
        `Remedy: fetch full history — set 'fetch-depth: 0' on the checkout step (or run ` +
        `'git fetch --unshallow' locally) — then re-run.`,
    )
    this.name = "BaselineUnreachableError"
  }
}

/** sha -> whether `git cat-file -e <sha>^{commit}` succeeds (the commit's object data is present locally). */
const reachabilityCache = new Map<string, boolean>()

/**
 * Cheap, single check (no path argument) for whether `commit` can be read
 * at all in this checkout — independent of any particular file. Exported
 * so it (and the shallow-checkout failure mode it detects) can be tested
 * directly with a deliberately-unreachable SHA, without needing an actual
 * shallow clone to reproduce the condition.
 */
export function isCommitReachable(commit: string): boolean {
  const cached = reachabilityCache.get(commit)
  if (cached !== undefined) return cached
  let ok: boolean
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], {
      stdio: ["ignore", "ignore", "ignore"],
    })
    ok = true
  } catch {
    ok = false
  }
  reachabilityCache.set(commit, ok)
  return ok
}

/** (commit, rel path) -> content at that commit, or null if that path did not exist there. */
const baselineCache = new Map<string, string | null>()

function baselineContentAt(commit: string, rel: string): string | null {
  const key = `${commit}:${rel}`
  const cached = baselineCache.get(key)
  if (cached !== undefined) return cached
  let content: string | null
  try {
    content = execFileSync("git", ["show", `${commit}:${rel}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
  } catch {
    content = null // the commit IS reachable (checked by the caller) — this path just wasn't there yet
  }
  baselineCache.set(key, content)
  return content
}

/**
 * True if `absPath` sits under a LEGACY entry AND its current content is
 * byte-identical to its content at the baseline commit. A new file, or an
 * edited legacy file, returns false and is linted normally.
 *
 * Throws BaselineUnreachableError — does not return false — if the baseline
 * commit itself can't be read, so that condition can never masquerade as
 * "not exempt" for every legacy file at once. See that class's doc comment.
 */
function isLegacyUnchanged(absPath: string, currentContent: string, baselineCommit: string): boolean {
  const entry = legacyEntryFor(absPath)
  if (!entry) return false
  if (!isCommitReachable(baselineCommit)) {
    throw new BaselineUnreachableError(baselineCommit)
  }
  const base = baselineContentAt(baselineCommit, repoRelative(absPath))
  if (base === null) return false
  return base === currentContent
}

export function lintCounter(
  roots: string[],
  opts: { ignoreLegacy?: boolean; baselineCommit?: string } = {},
): Violation[] {
  const baselineCommit = opts.baselineCommit ?? LEGACY_BASELINE_COMMIT
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
      if (!opts.ignoreLegacy && isLegacyUnchanged(file, content, baselineCommit)) continue
      // Rule patterns run against comment-stripped text so a colour literal
      // or specifier mentioned only in a comment can't false-positive; the
      // legacy-content comparison above deliberately uses the raw file,
      // since a comment-only edit should still forfeit the exemption.
      const lines = stripComments(content).split("\n")
      lines.forEach((text, i) => {
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
  try {
    const found = lintCounter(ROOTS)
    for (const v of found) {
      console.error(`${v.file}:${v.line}  ${v.rule}\n    ${v.text}`)
    }
    if (found.length > 0) {
      console.error(`\n${found.length} Counter rule violation(s). See DESIGN.md.`)
      process.exit(1)
    }
    console.log("Counter rules: clean")
  } catch (err) {
    if (err instanceof BaselineUnreachableError) {
      // Fail loudly with the cause and the remedy, not a wall of legacy
      // false-positives — see the class doc comment.
      console.error(err.message)
      process.exit(1)
    }
    throw err
  }
}
