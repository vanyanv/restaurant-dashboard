#!/usr/bin/env tsx
/**
 * The CLAUDE.md tripwires, as a build failure instead of prose.
 *
 * They were prose for months and were violated repeatedly — which is what a
 * tripwire being hit means. Text-level checks are used deliberately: they
 * cost nothing, need no build, and run on a file the moment it is written.
 *
 * Five rules were text-over-source regex checks (below). Task 2b of the
 * streaming-architecture plan added two more, `no-shell-in-page` and
 * `no-route-without-loading` — see "Task 2b (regression enforcement)" below
 * for why they exist and why the second one is NOT a regex.
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
 * --- Task 2b (regression enforcement) ---
 *
 * The streaming-architecture plan's Task 1 moved the Counter chrome
 * (`AppShell`, `PhoneShell`) out of every page and into two layouts —
 * `src/app/dashboard/(counter)/layout.tsx` and
 * `src/app/(mobile)/m/(counter)/layout.tsx` — and Task 2 gave every Counter
 * route a `loading.tsx`. Both were, until this task, prose rather than a
 * build failure: nothing stopped the NEXT of the 51 unbuilt Counter pages
 * from copying the old pattern (a page mounting its own shell) or skipping
 * the new one (a route with no loading boundary), because a page is written
 * by copying the page before it and the test cycle is off (see the
 * project's "BUILD VELOCITY" note). Two rules close that gap:
 *
 *   - `no-shell-in-page` is a sixth entry in `RULES`, matched and exempted
 *     exactly like the first five: comment-stripped before matching (so a
 *     doc comment that mentions `AppShell` in prose does not trip it — two
 *     page clients did exactly that until their comments were corrected in
 *     this same task) and LEGACY-exempt on the same byte-identical-content
 *     basis. It needs no route-scoping of its own beyond `SHELL_ALLOWED`:
 *     the two layout files are the shell's only legitimate mount site, and
 *     `components/counter` / `lib/counter` / `styles` are not "a page or
 *     page client" at all.
 *   - `no-route-without-loading` is deliberately NOT a `RULES` entry. The
 *     defect it catches is an absence — a directory with a `page.tsx` and no
 *     `loading.tsx` beside it — and there is no line of text for a regex to
 *     match against an absence. `findRouteLoadingViolations` walks the
 *     filesystem directly instead, scoped to `COUNTER_ROUTE_GROUPS` (the two
 *     `(counter)` route groups, not the wider `src/app/dashboard/**` /
 *     `src/app/(mobile)/m/**` the other rules police). That scope is also
 *     why it needs no LEGACY exemption of its own: the ~19 remaining
 *     editorial pages live outside both `(counter)` groups, so this check
 *     structurally cannot reach them, unlike a regex rule that would see
 *     every editorial page and need LEGACY to look away from it.
 *
 * --- Task 4 (ruling S-R6: streaming itself was unenforced) ---
 *
 * Task 3 of the streaming-architecture plan moved six of the eight Counter
 * pages off `await getXSections(...)` onto `getXSectionPromises(...)`,
 * NOT awaited, so `Section` can stream each one behind its own boundary.
 * Neither `no-shell-in-page` nor `no-route-without-loading` catches a page
 * written against the old awaited shape — a page is written by copying the
 * page before it, the test cycle is off, and with 51 of 54 Counter pages
 * still unbuilt, "the last page did it right" is not a mechanism.
 *
 *   - `no-awaited-sections-in-page` is deliberately NOT a `RULES` entry,
 *     for the same reason `no-route-without-loading` isn't: `RULES` regex
 *     entries run over every file the other rules reach (any `.tsx`/`.ts`
 *     under `ROOTS`), and `await get\w*Sections\(` only means something on a
 *     `page.tsx` that owns a section-loading call — matching it against a
 *     client island or a layout would be noise. `findAwaitedSectionsViolations`
 *     walks `page.tsx` files under `COUNTER_ROUTE_GROUPS` directly, the same
 *     scope `findRouteLoadingViolations` uses and for the same reason: the
 *     ~19 remaining editorial pages live outside both `(counter)` groups, so
 *     this check structurally cannot reach them and needs no LEGACY
 *     exemption of its own.
 *   - `await Promise.all([..., getXSections(...)])` is NOT caught: the
 *     pattern is line-oriented and looks for `await get\w*Sections(`, which a
 *     loader called inside a `Promise.all` never produces. The desk menu-item
 *     route does exactly this and is legitimately exempt anyway, so the hole
 *     has not yet hidden a real violation — but it would.
 *   - Routes are exempted BY NAME, not by pattern:
 *     `src/app/dashboard/(counter)/orders/[id]/page.tsx` and
 *     `src/app/(mobile)/m/(counter)/orders/[id]/page.tsx`. Ruling S-R5: all
 *     seven of their sections come from one `getOrderDetail` load, so seven
 *     promises resolving in the same tick would be a picture of streaming
 *     rather than streaming, and the page must resolve `head` before
 *     rendering at all, to decide its 404. Naming the two exact paths (rather
 *     than, say, excusing any `page.tsx` under an `[id]` segment) means the
 *     exemption cannot silently widen to cover a THIRD route someone adds
 *     later without deciding, again, that it deserves the same exception.
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
 *   - `COLOUR_ALLOWED` matches on BASENAME, unanchored: any file called
 *     `counter.css` or `counter-components.css` anywhere in ROOTS is exempt
 *     from `no-colour-literal`, not only the two under `src/styles/`. The
 *     `counter\.css$` half has always been this shape (and one test in
 *     tests/styles/counter-lint.test.ts depends on it, allowlisting a
 *     `style-scope/counter.css` fixture that is not under src/styles);
 *     `counter-components\.css$` was added in the same shape rather than
 *     anchored, so it is the existing hole reused, not a wider one. Anchoring
 *     both to `src/styles/` is a real option, but it changes what that
 *     fixture test means and so is its own decision, not a side effect of
 *     adding the second file.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { execFileSync } from "node:child_process"

export interface Violation {
  file: string
  line: number
  rule: string
  text: string
}

/** Colour written as a literal rather than taken from a token. */
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\boklch\(|\brgba?\(|\bhsla?\(/
/**
 * Any Tailwind palette colour. Counter's own utilities are all `ct-`
 * prefixed. Two alternatives: the shaded palette names (`bg-sky-500` and
 * every sibling, which carry a `-\d{2,3}` shade suffix) and the bare
 * `white`/`black` colour utilities, which have no shade suffix at all and
 * so need their own branch — `counter.css`'s own header explicitly forbids
 * both ("No #fff and no #000: every neutral is tinted warm."), and the
 * original single-branch regex could not match either.
 */
const UTILITY_COLOUR_PREFIXES =
  "bg|text|border|ring|fill|stroke|from|via|to|decoration|outline|shadow|accent|caret|divide"
const TAILWIND_PALETTE = new RegExp(
  String.raw`\b(?:${UTILITY_COLOUR_PREFIXES})-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b` +
    "|" +
    String.raw`\b(?:${UTILITY_COLOUR_PREFIXES})-(?:white|black)\b`,
)
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
/**
 * A page or page client importing OR rendering the layout-level shell
 * directly — the exact defect the streaming-architecture spec measured (4
 * mount sites, 0 layouts) before Task 1 moved `AppShell` and `PhoneShell`
 * into `(counter)/layout.tsx` and `(mobile)/m/(counter)/layout.tsx`. Matched
 * as a bare identifier rather than an import-only or JSX-tag-only pattern
 * because the rule is "may not import OR render" — either one is the
 * regression. Comments are stripped before this runs (see `stripComments`
 * and the module comment's "Task 2b" note), so a doc comment that mentions
 * `AppShell` in prose does not trip it.
 */
const SHELL_IN_PAGE = /\bAppShell\b|\bPhoneShell\b/

/** surface/ and state/ implement the status-branch rule; lib/counter constructs data, it doesn't render it — see the comment on STATUS_BRANCH above. */
const STATUS_BRANCH_ALLOWED =
  /[/\\]components[/\\]counter[/\\](?:surface|state)[/\\]|[/\\]lib[/\\]counter[/\\]/
const MOTION_ALLOWED = /[/\\]components[/\\]counter[/\\]motion[/\\]/
const DATA_ALLOWED = /[/\\]lib[/\\]counter[/\\]adapters[/\\]/
/**
 * Rule 1's exemption: the Counter stylesheets, and only those.
 *
 * `counter-components.css` is 1030 rules ported verbatim from
 * docs/counter/counter-prototype.html by scripts/extract-prototype-css.ts. It
 * carries the prototype's own colour values in the places a token cannot
 * reach — shadow and gradient stops, mostly — and it is a stylesheet, not a
 * component. Rule 1 exists to stop colours appearing in TSX, and it still
 * does. Its colour TOKENS are not exempt from anything: the extractor strips
 * every colour-valued custom property out of the port and re-declares them as
 * `var(--ct-*)` aliases, so counter.css remains the only place a colour token
 * is decided — asserted by tests/styles/counter-components.test.ts.
 *
 * Deliberately NOT widened to all of `src/styles/*.css`, which is the obvious
 * shape and is wrong: LEGACY below carries a `src/styles` entry for the four
 * editorial stylesheets, `.css` files are reachable by rule 1 alone (rules 2-5
 * are .ts/.tsx only), so a directory-wide exemption would make that entry
 * suppress nothing and fail its own "still suppressing at least one real
 * violation" check in tests/styles/counter-lint.test.ts. Verified by trying
 * it: 1 failed, "expected 0 to be greater than 0".
 */
const COLOUR_ALLOWED = /counter\.css$|counter-components\.css$/
/**
 * `SHELL_IN_PAGE`'s exemption: the two layout files that ARE the shell's one
 * legitimate mount site each, plus everything reachable from `ROOTS` that is
 * not "a page or page client" at all — `components/counter`, `lib/counter`
 * and `styles` carry no pages, so a rule about pages has nothing to say
 * about them. No LEGACY consideration is needed here beyond the mechanism
 * every `RULES` entry already gets (see `isLegacyUnchanged`): the editorial
 * pages don't render `AppShell`/`PhoneShell` at all, so this rule would
 * already report them clean even without it.
 */
const SHELL_ALLOWED =
  /[/\\]layout\.tsx$|[/\\]components[/\\]counter[/\\]|[/\\]lib[/\\]counter[/\\]|[/\\]styles[/\\]/

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
  { name: "no-shell-in-page", pattern: SHELL_IN_PAGE, allowed: SHELL_ALLOWED, extensions: [".tsx"] },
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
      "Pre-Counter editorial mobile shell, deleted page by page as mobile is rebuilt on Counter (see project_mobile_direction.md). The rebuild HAS started: /m itself is " +
      "Counter Overview's phone surface as of Phase C task 4, and is fully linted already — the exemption is content-based, so a rewritten file forfeits it automatically. " +
      "Narrow this to the remaining editorial subtrees (chat, count, invoices, labor, menu, operations, orders, pnl, product-mix, recipes, ingredients, more, settings, monitoring) as each is rebuilt.",
  },
  {
    path: "src/styles",
    reason:
      "src/styles/** entered ROOTS' no-colour-literal scope in this fix round (the linter-scope finding sibling to C2) — src/styles held only counter.css before that, so its four pre-Counter stylesheets " +
      "(editorial-tokens.css, editorial-dashboard.css, editorial-mobile.css, editorial-auth.css — loaded by the still-editorial dashboard/login/signup/mobile layouts) were never walked at all. " +
      "counter.css itself needs no entry here: RULES already excludes it up front via COLOUR_ALLOWED, before LEGACY is ever consulted. Deleted file by file in the same final dead-CSS sweep " +
      "(spec §6 Phase F) as the rest of the editorial tree — narrow this to the remaining un-rewritten files as each stylesheet's pages move to Counter.",
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

/**
 * `git cat-file -p <commit>:<rel>`, not `git show <commit>:<rel>`.
 *
 * `git show`'s `<rev>:<path>` form silently falls back to pathspec matching
 * against the *working tree* when the object lookup itself fails, and a
 * `path` containing `[...]` (every Next.js dynamic-segment folder —
 * `[id]`, `[storeId]`, ...) is valid glob syntax: a nonexistent bracketed
 * path then resolves as "pathspec matched nothing" and `git show` exits 0
 * with empty stdout instead of failing loudly like it does for a
 * nonexistent path with no glob metacharacters. That silent-empty-success
 * would be indistinguishable from a real (and real-ly empty) file, so a
 * moved dynamic-route legacy page — `orders/[id]/page.tsx` under the
 * `(editorial)` route group, say — would compare `"" === currentContent`,
 * find them unequal, and lose its LEGACY exemption even though the fallback
 * path lookup in `isLegacyUnchanged` should have recovered it.
 * `git cat-file -p <rev>:<path>` resolves the object name directly with no
 * pathspec fallback, so a missing path fails (throws) exactly like any
 * other missing path, bracket segments included. Caught during the
 * `(editorial)` route-group move (see `stripRouteGroups`) — every dynamic
 * legacy route silently failed its exemption until this switched.
 */
function baselineContentAt(commit: string, rel: string): string | null {
  const key = `${commit}:${rel}`
  const cached = baselineCache.get(key)
  if (cached !== undefined) return cached
  let content: string | null
  try {
    content = execFileSync("git", ["cat-file", "-p", `${commit}:${rel}`], {
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
 * Strips route-group segments (`(name)`) from a repo-relative path.
 *
 * The 2026-08-25 `(editorial)` move relocates ~19 legacy dashboard pages one
 * directory deeper without changing a single byte of their content —
 * `src/app/dashboard/orders/page.tsx` becomes
 * `src/app/dashboard/(editorial)/orders/page.tsx`. Route groups are inert
 * for the URL, but very much part of a file path, so a direct
 * `git show <baseline>:<new-path>` lookup fails (the parenthesised segment
 * didn't exist at baseline) and a pure move would silently forfeit the
 * LEGACY exemption for every file it touches, flooding `npm run tokens`
 * with violations in files nobody rewrote. `isLegacyUnchanged` tries the
 * direct path first and only falls back to this stripped path, so a
 * genuinely new file placed under a route group still isn't accidentally
 * exempted.
 */
function stripRouteGroups(rel: string): string {
  return rel
    .split("/")
    .filter((seg) => !(seg.startsWith("(") && seg.endsWith(")")))
    .join("/")
}

/**
 * Undoes the one mechanical content edit the `(editorial)` move itself
 * forces: a handful of legacy files reach a sibling that also moved via an
 * absolute `@/app/dashboard/...` import (rather than a relative one), and
 * that import string has to gain the same `(editorial)/` segment the
 * sibling's file path gained, or the build doesn't compile. That is part of
 * the move, not an edit to the file's own logic — conflating the two would
 * mean every such file (two, as of the 2026-08-25 move:
 * `ingredient-audit-client.tsx`'s dynamic import of the invoices PDF
 * viewer, `price-monitor-shell.tsx`'s import of `ingredient-picker-utils`)
 * loses its LEGACY exemption for a one-line path rewrite it didn't
 * otherwise ask for, and starts failing on real pre-existing violations
 * (`no-status-branch`, in both actual cases) that were never this move's to
 * fix. Used only as a second fallback in `isLegacyUnchanged`, after a
 * direct byte-for-byte match already failed — a file with a genuine logic
 * edit sitting alongside an import-path fix still won't match, since only
 * this one substitution is undone.
 */
function normalizeRouteGroupImports(content: string): string {
  return content.replace(/@\/app\/dashboard\/\([^/)]+\)\//g, "@/app/dashboard/")
}

/**
 * True if `absPath` sits under a LEGACY entry AND its current content is
 * byte-identical to its content at the baseline commit (allowing for the
 * two mechanical rewrites the `(editorial)` move itself forces — see
 * `stripRouteGroups` and `normalizeRouteGroupImports`). A new file, or a
 * genuinely edited legacy file, returns false and is linted normally.
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
  const rel = repoRelative(absPath)
  let base = baselineContentAt(baselineCommit, rel)
  if (base === null) {
    const strippedRel = stripRouteGroups(rel)
    if (strippedRel !== rel) base = baselineContentAt(baselineCommit, strippedRel)
  }
  if (base === null) return false
  if (base === currentContent) return true
  return base === normalizeRouteGroupImports(currentContent)
}

/**
 * The two Counter route groups `no-route-without-loading` polices — see the
 * module comment's "Task 2b" section for why this is narrower than `ROOTS`
 * and needs no LEGACY exemption of its own.
 */
export const COUNTER_ROUTE_GROUPS = [
  join(process.cwd(), "src", "app", "dashboard", "(counter)"),
  join(process.cwd(), "src", "app", "(mobile)", "m", "(counter)"),
]

/** True if `dir` is `root` itself or nested inside it. */
function isUnder(dir: string, root: string): boolean {
  return dir === root || dir.startsWith(root + sep)
}

/**
 * `no-route-without-loading`, as a directory check rather than a regex —
 * the defect it catches is an ABSENCE (no `loading.tsx` beside a
 * `page.tsx`), and there is no line of text for a pattern to match against
 * an absence. Walks `routeGroupRoots` directly instead of scanning file
 * contents; every directory that contains a `page.tsx` must also contain a
 * `loading.tsx`.
 */
export function findRouteLoadingViolations(
  routeGroupRoots: string[] = COUNTER_ROUTE_GROUPS,
): Violation[] {
  const violations: Violation[] = []
  for (const root of routeGroupRoots) {
    let files: string[]
    try {
      files = walk(root)
    } catch {
      continue // a route group that does not exist yet is not a violation
    }
    const pageDirs = new Set(
      files.filter((f) => f.endsWith(`${sep}page.tsx`)).map((f) => dirname(f)),
    )
    for (const dir of pageDirs) {
      if (!existsSync(join(dir, "loading.tsx"))) {
        const rel = relative(process.cwd(), dir)
        violations.push({
          file: rel,
          line: 1,
          rule: "no-route-without-loading",
          text: `${rel} has a page.tsx but no loading.tsx beside it`,
        })
      }
    }
  }
  return violations
}

/**
 * `no-group-without-error`, the sibling of the rule above and an ABSENCE for
 * the same reason — there is no line of text that says "this route group has
 * no error boundary".
 *
 * Each `(counter)` route group root must hold an `error.tsx`. Not each route:
 * an `error.tsx` at the group root covers every page under it, and Next
 * resolves the NEAREST boundary, so a per-route file would only be needed
 * where a route wants a different message. One per group is the floor.
 *
 * Why this is worth a rule. Both groups had none, so all 42 rebuilt pages
 * fell through to `src/app/global-error.tsx` — which replaces the whole
 * document (losing the rail, the topbar and the only way to navigate out),
 * says "a failure in the application shell" for what is one page throwing,
 * and paints the pre-Counter cream palette with no dark theme. `Section`
 * catches every LOAD failure, which is exactly why nobody noticed the render
 * ones had nowhere to go.
 */
export function findRouteErrorViolations(
  routeGroupRoots: string[] = COUNTER_ROUTE_GROUPS,
): Violation[] {
  const violations: Violation[] = []
  for (const root of routeGroupRoots) {
    if (!existsSync(root)) continue // a group that does not exist yet is not a violation
    if (!existsSync(join(root, "error.tsx"))) {
      const rel = relative(process.cwd(), root)
      violations.push({
        file: rel,
        line: 1,
        rule: "no-group-without-error",
        text: `${rel} is a Counter route group with no error.tsx at its root`,
      })
    }
  }
  return violations
}

/** `await get<anything>Sections(` — the pre-Task-3 shape every streaming page moved off. */
const AWAITED_SECTIONS_PATTERN = /\bawait\s+get\w*Sections\s*\(/

/**
 * The routes whose sections come out of ONE query, exempted BY NAME rather
 * than by pattern — see the module comment's "Task 4" section for ruling S-R5
 * and why naming the exact paths (rather than, say, any `page.tsx` under an
 * `[id]` segment) matters. Exported so a test can assert the exemption is
 * exactly these paths and nothing wider.
 *
 * THE TEST FOR MEMBERSHIP IS HOW MANY INDEPENDENT QUERIES SIT BEHIND THE
 * SECTIONS, not how many sections there are and not how many loaders were
 * written. A page that awaits nine queries behind one call is the streaming
 * defect this rule exists to catch; a page that awaits one query and hands out
 * seven projections of its single result would gain nothing but a picture of
 * streaming by splitting it.
 *
 *   - The two order-detail routes: all seven sections are `mapReadyTo` over
 *     one `getOrderDetail` load plus its costing batch, and the head must be
 *     resolved at page level anyway to decide the 404.
 *   - The two alert-inbox routes: `getAlertsSections` is one `getAlertInbox`
 *     load — a `findMany`, a `groupBy` and two small scope reads, all issued
 *     concurrently — and every section is a projection of its single result.
 *     Contrast `/dashboard/decisions`, whose `getDecisionsView` is nine
 *     independent queries and which therefore streams and is NOT listed here.
 */
export const AWAITED_SECTIONS_ALLOWED = [
  join(process.cwd(), "src", "app", "dashboard", "(counter)", "orders", "[id]", "page.tsx"),
  join(process.cwd(), "src", "app", "(mobile)", "m", "(counter)", "orders", "[id]", "page.tsx"),
  join(process.cwd(), "src", "app", "dashboard", "(counter)", "alerts", "page.tsx"),
  join(process.cwd(), "src", "app", "(mobile)", "m", "(counter)", "alerts", "page.tsx"),
  // The two menu-item detail routes, for the order-detail routes' reason:
  // the page's own TITLE is the record's name, so the headline has to resolve
  // before anything renders — both to fill the masthead without moving it and
  // to decide the 404 for an item that never sold in the window.
  //
  // The DESK one is listed even though the pattern does not currently catch
  // it: it calls the loader inside a `Promise.all([...])`, so no single line
  // reads `await get*Sections(`. That is a hole in the pattern, not an
  // exemption it earned, and listing the path here records the decision where
  // the next reader will look for it rather than leaving it to chance.
  join(process.cwd(), "src", "app", "dashboard", "(counter)", "menu", "catalog", "[item]", "page.tsx"),
  join(process.cwd(), "src", "app", "(mobile)", "m", "(counter)", "menu", "catalog", "[item]", "page.tsx"),
]

/**
 * `no-awaited-sections-in-page` — Task 4 of the streaming-architecture plan,
 * ruling S-R6. Like `no-route-without-loading`, this is deliberately NOT a
 * `RULES` entry: the pattern only means something on a `page.tsx` that owns a
 * section-loading call, not on every `.tsx`/`.ts` under `ROOTS`. Walks
 * `page.tsx` files under `routeGroupRoots` directly and needs no LEGACY
 * exemption for the same structural reason `findRouteLoadingViolations`
 * doesn't: the ~19 remaining editorial pages live outside both `(counter)`
 * route groups.
 */
export function findAwaitedSectionsViolations(
  routeGroupRoots: string[] = COUNTER_ROUTE_GROUPS,
): Violation[] {
  const violations: Violation[] = []
  for (const root of routeGroupRoots) {
    let files: string[]
    try {
      files = walk(root)
    } catch {
      continue // a route group that does not exist yet is not a violation
    }
    for (const file of files) {
      if (!file.endsWith(`${sep}page.tsx`)) continue
      if (AWAITED_SECTIONS_ALLOWED.includes(file)) continue
      const content = readFileSync(file, "utf8")
      // Comment-stripped, like every RULES pattern — a doc comment quoting
      // the old `await getXSections(...)` shape (as this file's own module
      // comment now does) must not trip the rule it is describing.
      const lines = stripComments(content).split("\n")
      lines.forEach((text, i) => {
        if (AWAITED_SECTIONS_PATTERN.test(text)) {
          violations.push({
            file: relative(process.cwd(), file),
            line: i + 1,
            rule: "no-awaited-sections-in-page",
            text: text.trim(),
          })
        }
      })
    }
  }
  return violations
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
  // `no-route-without-loading` is a directory check, not a per-file regex
  // (see `findRouteLoadingViolations`), so it is not in `RULES` and runs
  // once here instead of once per file. Scoped to whichever
  // `COUNTER_ROUTE_GROUPS` entries actually fall within the `roots` this
  // call was given, so `lintCounter([FIXTURES])` in tests sees only
  // fixture-shaped violations — a fixture directory is never under
  // `COUNTER_ROUTE_GROUPS` — while `lintCounter(ROOTS)` (what `npm run
  // tokens` runs) always reaches the real tree, since `ROOTS` includes both
  // `src/app/dashboard` and `src/app/(mobile)/m`.
  const routeGroupsInScope = COUNTER_ROUTE_GROUPS.filter((group) =>
    roots.some((r) => isUnder(group, r)),
  )
  violations.push(...findRouteLoadingViolations(routeGroupsInScope))
  // `no-group-without-error` — same directory-check shape and same scoping as
  // the loading rule above. A group with no `error.tsx` sends every render
  // failure under it to the root boundary, which replaces the document.
  violations.push(...findRouteErrorViolations(routeGroupsInScope))
  // `no-awaited-sections-in-page`, Task 4's rule — same directory-check shape
  // and same scoping reason as `findRouteLoadingViolations` just above.
  violations.push(...findAwaitedSectionsViolations(routeGroupsInScope))
  // `no-raw-forecast-generation` — NOT scoped to Counter. The four tables
  // it guards are read from `src/app/actions/**`, `src/lib/chat/**` and
  // `src/lib/counter/**` alike, and the defect costs the same wherever it
  // happens, so this one walks every file the run was given.
  // ROOTS are ABSOLUTE (`join(process.cwd(), ...)`), and the first cut of this
  // filter compared them against relative strings — so it matched nothing and
  // the rule silently never ran. Caught by the mutation check, which is the
  // entire reason the mutation check exists.
  const forecastScopeInScope = FORECAST_SCOPE.filter((dir) =>
    roots.some((r) => isUnder(dir, r) || isUnder(r, dir)),
  )
  violations.push(...findRawForecastGenerationViolations(forecastScopeInScope))
  return violations
}


/* ── no-raw-forecast-generation ──────────────────────────────────────────

   FOUR TABLES KEEP EVERY MODEL GENERATION, and summing one without picking
   the newest is the most expensive silent defect this project has found
   twice:

     ForecastDailyRevenue   measured 12.70x  ($646,442 against $50,754)
     ForecastHourlyOrders   measured 13.17x  (35,020 orders against 2,658)
     ForecastMenuItem       same unique key shape
     ForecastDailyCategory  same unique key shape

   Each is unique on (..., "generatedAt"), so a range that has been forecast
   nightly for a fortnight holds fourteen rows per day and a naive
   aggregate returns fourteen times the truth. Nothing about the number
   looks wrong — it is the right shape, the right units and roughly the
   right trend, just multiplied.

   Every reader in the tree handles it correctly today; this rule is what
   keeps that true. It fires when a file mentions one of the four Prisma
   accessors and never mentions `generatedAt`, and it is deliberately
   ignorant of HOW the dedupe is done: `DISTINCT ON`, an `orderBy` with a
   `take`, or `newestGenerationPerDay` all satisfy it, because all three are
   legitimate and a regex cannot tell a correct one from a clever wrong one.

   KNOWN HOLES, written down rather than patched over with more regex:
     - a file that selects `generatedAt` and then ignores it passes. The rule
       proves the author knew the column exists, not that they used it.
     - a raw `$queryRaw` naming the TABLE (`"ForecastDailyRevenue"`) rather
       than the accessor is caught by the same table-name alternative below,
       but a query built from a string variable is not.
     - a pure module that receives already-fetched rows (e.g.
       `hourly-coverage.ts`) never mentions an accessor, so it is correctly
       silent — the dedupe belongs to whoever queried.
*/
const FORECAST_GENERATION_TABLES =
  /prisma\.forecast(DailyRevenue|HourlyOrders|MenuItem|DailyCategory)\b|"Forecast(DailyRevenue|HourlyOrders|MenuItem|DailyCategory)"/

/**
 * Its own scope, and deliberately wider than `ROOTS`. The four tables are read
 * from `src/app/actions/**`, `src/lib/chat/**` and `src/lib/counter/**`, none
 * of which the Counter rules walk. Scoped the same way the route-group checks
 * are, so `lintCounter([FIXTURES])` in a test never reaches the real tree.
 */
export const FORECAST_SCOPE = [
  join(process.cwd(), "src", "app"),
  join(process.cwd(), "src", "lib"),
]

export function findRawForecastGenerationViolations(
  scope: string[] = FORECAST_SCOPE,
): Violation[] {
  const violations: Violation[] = []
  const files: string[] = []
  for (const root of scope) {
    try {
      files.push(...walk(root))
    } catch {
      continue
    }
  }
  for (const file of files) {
    if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue
    if (file.includes("/generated/")) continue
    let text: string
    try {
      text = stripComments(readFileSync(file, "utf8"))
    } catch {
      continue
    }
    if (!FORECAST_GENERATION_TABLES.test(text)) continue
    if (/generatedAt/.test(text)) continue
    const line = text.split("\n").findIndex((l) => FORECAST_GENERATION_TABLES.test(l)) + 1
    violations.push({
      file,
      line: line || 1,
      rule: "no-raw-forecast-generation",
      text:
        "queries a forecast table that keeps every model generation and never " +
        "mentions generatedAt — a raw sum measured 12.7x on revenue and 13.17x on hourly orders",
    })
  }
  return violations
}

/**
 * Exported so it can be asserted against directly (e.g. "src/styles/** is
 * in scope") rather than only exercised indirectly through the CLI.
 *
 * `src/styles` was missing entirely until this fix: none of the other four
 * roots contains a `.css` file, so the `.css` extension handling on
 * `no-colour-literal` and the `counter\.css$` allowlist were both inert —
 * a future `src/styles/counter-components.css` would not have been linted
 * at all, despite rule 1 being "no colour literal outside counter.css".
 */
export const ROOTS = [
  join(process.cwd(), "src", "app", "dashboard"),
  join(process.cwd(), "src", "app", "(mobile)", "m"),
  join(process.cwd(), "src", "components", "counter"),
  join(process.cwd(), "src", "lib", "counter"),
  join(process.cwd(), "src", "styles"),
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
