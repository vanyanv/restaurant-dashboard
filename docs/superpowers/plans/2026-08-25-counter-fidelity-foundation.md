# Counter Fidelity: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the prototype's own stylesheet and rebuild every Counter primitive to emit the prototype's exact DOM, so that pixel fidelity is the default state of a Counter page rather than something each page has to achieve by hand.

**Architecture:** One extraction script separates the prototype's application CSS from its documentation-site chrome and writes `src/styles/counter-components.css`, whose token declarations are replaced by an alias layer onto the existing `--ct-*` tokens so light/dark theming survives. Every component under `src/components/counter/**` is then rewritten as a markup emitter over those classes. A fidelity harness renders the prototype and our route side by side and reports the structural difference; that report is the gate.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 7, Vitest 4 + RTL 16, Playwright, Tailwind v4 (layout utilities only), Lightning CSS.

**Spec:** `docs/superpowers/specs/2026-08-25-counter-fidelity-addendum.md`, which amends `docs/superpowers/specs/2026-08-23-counter-design-system-design.md`.

**Source of truth:** `docs/counter/counter-prototype.html`. Every rule and every DOM shape in this plan comes from that file. When this plan and the prototype disagree, the prototype wins and the plan gets fixed.

## Global Constraints

- Branch is `dashboardv2`. No rebase; one merge at the end.
- Whole-project gate: `rm -rf .next && npm test && npm run tokens && npx tsc --noEmit && npm run build`.
  A stale `.next` reports ~122 phantom `tsc` errors in generated `routes.d.ts`.
- There is no ESLint in this repo; `next lint` was removed in Next 16.
- **Tests live in a top-level `tests/` tree mirroring `src/`** — never in a
  `__tests__/` folder beside the code. `vitest.config.mts` is the authority.
  Read an existing test file before adding cases to it; its module-level
  constants may already own the names you were about to declare.
- **A test that passes before the fix is not a test.** Break the
  implementation on purpose, watch the test go red, then restore it. Report
  both outputs. Two tasks in the previous plan shipped tests that could not
  fail; both were caught only by doing this.
- `npm run tokens` rules 2–5 are unchanged and still bind: no page branching
  on a `SectionData` status, no page importing Prisma or a server action
  directly, no page importing `framer-motion`, no generic Tailwind palette
  colour. Rule 1 widens in Task 1 — see there.
- `Section` remains the sole state renderer (ruling R3, Plan 6). Every other
  primitive takes plain `T`.
- Under React 19 + RTL 16, only `fireEvent` commits state; `.click()` is inert.
- Browser verification uses `npm run shot -- <route> <out.png> [width]`; the
  `.env.test.local` credentials work.

## What is already correct and must not be disturbed

`src/lib/counter/section-data.ts`, `adapters/types.ts`, `format.ts`,
`date-range.ts`, `url-state.ts`, `prime-cost.ts`, `channels.ts`, `nav.ts`,
`ask-context.ts`, and `src/components/counter/motion/*`. None of them is a
stylesheet and none is implicated in the fidelity gap. Leave them alone.

---

## Task 1: Port the prototype's stylesheet

**Files:**
- Create: `scripts/extract-prototype-css.ts`
- Create: `src/styles/counter-components.css` (generated; committed)
- Modify: `src/app/globals.css`
- Modify: `src/styles/counter.css` (alias layer only — no token values change)
- Modify: `scripts/counter-lint.ts` (rule 1 scope)
- Test: `tests/styles/counter-components.test.ts`

**Interfaces:**
- Produces: 452 CSS class names available to every Counter component, and
  `npm run css:extract` regenerating the file from the prototype.

**Background — the extraction is already proven.** A throwaway Python version
of this script produced, from the prototype's twelve `<style>` blocks:

```
rules kept     : 1030   (35 @-rules)
rules dropped  : 52
distinct classes: 452
output         : 100,734 chars
```

Everything dropped was documentation chrome (`.masthead`, `.scene`, `.idx`,
`.pchip`, `.notes`, `.eyebrow`, `.speccol`, `.bareviews`, `.devcap`,
`.stagehead`, `.notegrid`, `.spec`, and the bare `*` reset). Port that logic to
TypeScript; the two rules below are the ones that took two attempts to get
right and are the reason this is a script rather than a copy-paste.

- [ ] **Step 1: Write the extraction script**

Create `scripts/extract-prototype-css.ts`. It reads
`docs/counter/counter-prototype.html`, walks every `<style>` block in source
order, and writes `src/styles/counter-components.css`.

Two subtleties, both of which silently lose styling if missed:

```ts
/**
 * A grouped selector is kept for whichever of its parts belong to the app.
 *
 * `.pchip,.mtab,.seg button` is doc chrome, app, app. Dropping the whole
 * group because one part is doc chrome silently loses the styling for two
 * real components — which is what the first version of this did.
 */
function narrow(selector: string): string {
  const parts = splitGroup(selector).filter(isAppSelector)
  return parts.length > 0 ? parts.join(",") : selector
}

/**
 * Commas inside `:is(...)`, `:where(...)` and attribute selectors are not
 * group separators. Splitting on every comma would shatter
 * `:where(.pframe) button` and every `[data-n="4"]`-style selector.
 */
function splitGroup(selector: string): string[] { /* depth-aware split */ }
```

And:

```ts
/**
 * A selector naming NO class is never ported. The prototype styles bare
 * `body`, `a`, `*` and `:root` for its own documentation page; porting those
 * would leak the prototype's page chrome over the whole application,
 * including the login and editorial routes that are not Counter at all.
 */
function isAppSelector(part: string): boolean {
  const classes = classNamesIn(part)
  if (classes.length === 0) return false
  return !classes.some((c) => DOC_ONLY.has(c))
}

const DOC_ONLY = new Set([
  "wrap", "eyebrow", "masthead", "lede", "scene", "spec", "purpose",
  "speccols", "speccol", "notes", "notegrid", "idx", "idx__in", "idx__k",
  "pchip", "stagehead", "stage", "devcap", "bareviews",
])
```

`rt` looks like doc chrome and is NOT — `.mli .rt` is the phone list's trailing
figure. Do not add it to the set; the first version did and lost three rules.

- [ ] **Step 2: Strip the token block and emit the alias layer**

The prototype defines its tokens inside `.frame{…}`, light-only. `counter.css`
defines all 33 colours as `light-dark()` pairs and is asserted in both themes
by `tests/styles/counter-tokens.test.ts`. Porting `.frame`'s declarations
verbatim would override every one of them with a light value and kill dark mode
— the same class of defect as Plan 2's Lightning CSS bug, where 1803 tests
passed over a dead toggle.

So the script must **drop every custom-property declaration from `.frame`** and
keep only its layout properties. Emit the alias layer at the top of the
generated file:

```css
/* GENERATED by scripts/extract-prototype-css.ts — do not edit by hand.
 * Source: docs/counter/counter-prototype.html
 *
 * The prototype's rules are ported verbatim. Only its token DECLARATIONS are
 * replaced: it defines them light-only inside `.frame`, and counter.css
 * defines the same values as light-dark() pairs asserted in both themes.
 * These aliases let the ported rules read the prototype's own names while
 * the values keep coming from counter.css — which stays the only colour
 * source in the application.
 */
.ct-root {
  --surface: var(--ct-surface);        --paper: var(--ct-paper);
  --chrome: var(--ct-chrome);          --sunk: var(--ct-sunk);
  --line: var(--ct-line);              --line-strong: var(--ct-line-strong);
  --ink: var(--ct-ink);                --ink-2: var(--ct-ink-2);
  --ink-3: var(--ct-ink-3);
  --accent: var(--ct-accent);          --accent-hi: var(--ct-accent-hi);
  --accent-wash: var(--ct-accent-wash);
  --signal: var(--ct-signal);          --signal-wash: var(--ct-signal-wash);
  --signal-line: var(--ct-signal-line); --signal-ink: var(--ct-signal-ink);
  --good: var(--ct-good);              --good-wash: var(--ct-good-wash);
  --warn: var(--ct-warn);              --warn-wash: var(--ct-warn-wash);
  --bad: var(--ct-bad);                --bad-wash: var(--ct-bad-wash);
  --ch-house: var(--ct-ch-house);      --ch-dd: var(--ct-ch-dd);
  --ch-ue: var(--ct-ch-ue);            --ch-gh: var(--ct-ch-gh);
  --mx-1: var(--ct-mx-1); --mx-2: var(--ct-mx-2);
  --mx-3: var(--ct-mx-3); --mx-4: var(--ct-mx-4);
  --gp-1: var(--ct-gp-1); --gp-2: var(--ct-gp-2); --gp-3: var(--ct-gp-3);

  --t-micro: 10px; --t-cap: 11.5px; --t-body: 13px; --t-mid: 15px;
  --t-lg: 18px; --t-xl: 22px; --t-hero: 30px;
  --r: 8px; --r-sm: 5px;
  --ease: cubic-bezier(.22, 1, .36, 1);

  /* Read by the ported rules; the prototype's own documentation tokens.
     Mapped onto their application equivalents rather than reintroduced. */
  --page-bg: var(--ct-paper);        --page-surface: var(--ct-surface);
  --page-line: var(--ct-line);       --page-ink: var(--ct-ink);
  --page-ink-2: var(--ct-ink-2);     --page-ink-3: var(--ct-ink-3);
  --page-accent: var(--ct-accent);

  --sans: var(--font-dm-sans), ui-sans-serif, system-ui, -apple-system, sans-serif;
  --display: var(--font-bricolage), var(--sans);
  --mono: var(--font-jetbrains-mono), ui-monospace, Menlo, monospace;
}
```

Confirm the three `next/font` variable names against the layout that declares
them before writing this — use whatever they actually are, not these guesses.
`--t-small` is read by the port and not defined in `.frame`; find its value in
the prototype and add it here. `--len`, `--pc` and `--qc` are set inline per
element at runtime (chart lengths, bar percentages) and must NOT be declared
here — a default would mask a component that forgot to set one.

Verify with the same check that produced this list:

```bash
# every var the port reads, minus every var it defines, must be a subset of
# what the alias layer supplies
```

- [ ] **Step 3: Wire it in**

`src/app/globals.css` already has `@import "../styles/counter.css";` (line 23).
Add `@import "../styles/counter-components.css";` immediately after it — after,
so the aliases resolve against tokens that are already declared.

`AppShell` puts `ct-root` on its outermost element. Nothing outside a Counter
page gets these classes, so the login page and the ~19 remaining editorial
routes are untouched.

- [ ] **Step 4: Widen lint rule 1**

In `scripts/counter-lint.ts`, rule 1 currently forbids colour literals outside
`src/styles/counter.css`. Widen the exemption to `src/styles/*.css`, with the
reason in a comment:

```ts
// counter-components.css is 1030 rules ported verbatim from the prototype and
// carries its channel-identity hex values (--ch-dd:#EB1700 and friends). It is
// a stylesheet, not a component — rule 1 exists to stop colours appearing in
// TSX, and it still does.
```

Do not touch rules 2–5.

- [ ] **Step 5: Write the tests**

Create `tests/styles/counter-components.test.ts`:

```ts
it("ports the whole application stylesheet and none of the documentation site", () => {
  // Regenerating must be idempotent and must not silently shrink.
  expect(ruleCount(css)).toBeGreaterThanOrEqual(1000)
  expect(classNames(css).size).toBeGreaterThanOrEqual(440)
  for (const doc of ["masthead", "scene", "idx", "pchip", "notegrid", "speccol"]) {
    expect(classNames(css).has(doc)).toBe(false)
  }
  for (const app of ["strip", "sec", "blt", "dispatch", "headline", "askbar",
                     "moving", "qitem", "chan", "cbar", "wkt", "mlist"]) {
    expect(classNames(css).has(app)).toBe(true)
  }
})

it("declares no bare element selector, so nothing leaks past a Counter page", () => {
  for (const sel of selectors(css)) {
    expect(namesAClass(sel)).toBe(true)
  }
})

it("reads no custom property the alias layer does not supply", () => {
  const missing = [...varsRead(css)].filter((v) => !varsDeclared(css).has(v))
  const runtime = new Set(["--len", "--pc", "--qc"]) // set inline per element
  expect(missing.filter((v) => !runtime.has(v))).toEqual([])
})

it("keeps counter.css the only place a colour VALUE is decided", () => {
  // The port may reference tokens; it may not define one as a literal.
  const declarations = colourDeclarationsIn(css)
  expect(declarations.filter((d) => !d.value.startsWith("var("))).toEqual([])
})
```

The third and fourth cases are the load-bearing ones. Prove they can fail:
delete one alias from the layer and confirm the third goes red; change one
alias to a literal `oklch(...)` and confirm the fourth goes red. Report both.

- [ ] **Step 6: Add the regeneration script**

In `package.json`: `"css:extract": "tsx scripts/extract-prototype-css.ts"`.

- [ ] **Step 7: Gate and commit**

```bash
rm -rf .next && npm test && npm run tokens && npx tsc --noEmit && npm run build
git add scripts/extract-prototype-css.ts src/styles/counter-components.css \
  src/styles/counter.css src/app/globals.css scripts/counter-lint.ts \
  tests/styles/counter-components.test.ts package.json
git commit -m "feat(counter): port the prototype's stylesheet instead of approximating it"
```

Nothing should look different yet — no component uses the new classes. If
anything DOES change visually, a bare selector leaked; find it before moving on.

---

## Task 2: The fidelity gate, in Playwright

`npm run tokens` cannot see a missing dispatch line or a table that should be
cards. Nothing in this repo can, which is why the gap survived a green gate for
seven plans. This task builds the thing that can, and makes it a real test
suite rather than a script somebody remembers to run.

**Files:**
- Create: `e2e/fidelity/fidelity.spec.ts`
- Create: `e2e/fidelity/prototype.ts` (driving the vendored prototype)
- Create: `e2e/fidelity/landmarks.ts` (the shared comparison logic)
- Create: `e2e/fidelity/manifest.ts` (page id ↔ route ↔ status)
- Modify: `playwright.config.ts` (two new projects)
- Modify: `package.json` (`fidelity` scripts)
- Create: `docs/counter/fidelity/README.md`
- Test: `tests/e2e/landmarks.test.ts` (unit-tests the comparison itself)

**Interfaces:**
- Produces:
  - `npm run fidelity` — every page in the manifest, both viewports, both themes
  - `npm run fidelity -- --grep overview` — one page
  - `docs/counter/fidelity/<pageId>.md` — the committed report
  - `compareLandmarks(a, b)` from `landmarks.ts`, unit-testable without a browser

**Why Playwright and not a script.** The repo already has the hard part
solved: `playwright.config.ts` authenticates once via `auth.setup.ts` into
`e2e/.auth/user.json`, and runs a `desktop` project at 1440×900 and a `mobile`
project on a Pixel 7. A fidelity script would reimplement sign-in — the exact
mistake `scripts/shot-page.ts`'s module comment says kept getting made and
written off as "the credentials don't work." Reuse the projects.

- [ ] **Step 1: Learn to drive the prototype, and write down what worked**

The prototype is one file with 53 page modules (`P.<id>`) and its own router;
`go()` lives near line 630 of its script block. Open it in a real browser and
find the entry point that switches the rendered `.frame`. Confirm that after
navigating, `document.querySelector('.frame')` contains that page's content and
not the previous one's.

Write `e2e/fidelity/prototype.ts` exposing:

```ts
/** Opens the vendored prototype and navigates to one page module. */
export async function openPrototype(page: Page, pageId: string): Promise<Locator>
```

It returns the `.frame` locator. It must **assert** that navigation happened —
a silent no-op that leaves the previous page rendered would make every
comparison after the first one compare the wrong page, and every report would
be confidently wrong.

- [ ] **Step 2: Extract landmarks from either side**

`e2e/fidelity/landmarks.ts`, browser-agnostic so it can be unit-tested:

```ts
/**
 * The classes that mark a structural element of a Counter page. A landmark is
 * something a reader would name if asked what is on the screen: the dispatch
 * line, the head block, a strip, a section, the queue, the store cards.
 *
 * NOT every class — matching all 452 would report a diff for every hover
 * state and every utility. This list is what the page IS.
 */
export const LANDMARK_CLASSES = [
  "dispatch", "headline", "fig", "say", "hfloor", "strip", "sec", "moving",
  "askbar", "sugs", "queue", "qitem", "stores", "chan", "cbar", "gap",
  "ch", "drill", "tbl", "wkt", "blt", "mtr", "wf", "cascade", "empt",
] as const

export interface Landmark {
  /** Depth-first index, so order is part of the comparison. */
  order: number
  classes: string[]
  /** Trimmed to 60 chars. Compared only for presence, never for equality. */
  text: string
  box: { w: number; h: number }
  style: Record<string, string>
}

/** The computed properties a fidelity mismatch would actually show up in. */
export const CHECKED_PROPERTIES = [
  "font-family", "font-size", "font-weight", "line-height", "letter-spacing",
  "color", "background-color", "border-radius", "border-top-width",
  "border-left-color", "padding-top", "padding-left", "gap",
  "grid-template-columns", "text-transform", "font-variant-numeric",
] as const

export interface Difference {
  kind: "missing" | "extra" | "style"
  order: number
  classes: string[]
  property?: string
  prototype?: string
  ours?: string
}

export function compareLandmarks(proto: Landmark[], ours: Landmark[]): Difference[]
```

**Compare by class sequence, not by pixel.** The prototype's numbers are
invented (142 guest reviews, "3 need you") and ours come from a real database,
so a pixel diff is nothing but noise. A missing `.dispatch`, or a `.tbl` where
the prototype has `.stores`, is the finding. Text is compared for
*presence only* — an element that should hold text and holds none is a real
defect; an element holding a different number is not.

- [ ] **Step 3: The manifest, which doubles as the project's progress board**

```ts
// e2e/fidelity/manifest.ts
export type PageStatus = "counter" | "editorial"

export interface FidelityPage {
  /** The prototype's own page module id, e.g. "overview". */
  protoId: string
  /** Our route. */
  route: string
  /** "editorial" pages are not rebuilt yet and are SKIPPED, not failed. */
  status: PageStatus
  /** Set once the page has passed. Prevents silent regression. */
  baseline?: { desktop: number; mobile: number }
}

export const PAGES: FidelityPage[] = [
  { protoId: "overview", route: "/dashboard", status: "counter" },
  { protoId: "pnl", route: "/dashboard/pnl", status: "editorial" },
  // …51 more, all "editorial" until their Phase C plan lands
]
```

A page flips to `"counter"` in the same commit that rebuilds it. That makes
`npm run fidelity` a live count of how much of the design is actually built,
and makes it impossible to declare a page done without turning its gate on.

- [ ] **Step 4: The spec**

`e2e/fidelity/fidelity.spec.ts` iterates the manifest. For each `"counter"`
page it runs **two independent passes**, and both must be clean:

```ts
for (const p of PAGES.filter((x) => x.status === "counter")) {
  test(`${p.protoId}: structure matches the prototype`, async ({ page, context }) => {
    // Pass 1 — structure. Class sequence and nesting.
    // Fails listing every missing and extra landmark by name.
  })

  test(`${p.protoId}: rendering matches the prototype`, async ({ page, context }) => {
    // Pass 2 — computed style, for landmarks present on both sides.
    // Runs in BOTH themes: data-theme="light" and data-theme="dark".
    // A property is a mismatch only if it differs in either theme.
  })
}
```

Two passes rather than one because they fail for different reasons and want
different fixes: pass 1 says "you did not build this element", pass 2 says "you
built it and it does not look right." Collapsing them produces a single
failure listing forty style diffs that are all downstream of one missing
wrapper.

Both passes attach the prototype and our screenshots to the Playwright report
via `testInfo.attach`, so a failure is inspectable without re-running.

- [ ] **Step 5: Two projects in `playwright.config.ts`**

```ts
    {
      name: "fidelity",
      testDir: "./e2e/fidelity",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: STORAGE_STATE,
      },
      dependencies: ["setup"],
    },
    {
      name: "fidelity-mobile",
      testDir: "./e2e/fidelity",
      use: { ...devices["Pixel 7"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
    },
```

The mobile project compares against the prototype's `phone()` composition, not
its `desk()` one — `openPrototype` needs a surface argument. The prototype
switches surface by its own control; find how, and assert the switch happened
for the same reason as Step 1.

Add to `package.json`:

```json
"fidelity": "playwright test --project=fidelity --project=fidelity-mobile",
"fidelity:report": "tsx scripts/fidelity-report.ts"
```

- [ ] **Step 6: Unit-test the comparison, and prove it can fail**

This is the step that matters most. **A harness that finds nothing on both
sides reports "no differences" and passes forever.** That failure mode would
be worse than having no gate at all, because it would be believed.

`tests/e2e/landmarks.test.ts` runs `compareLandmarks` over hand-written fixtures:

```ts
it("reports a section the prototype has and we do not", () => {
  const diffs = compareLandmarks(withDispatch, withoutDispatch)
  expect(diffs).toContainEqual(expect.objectContaining({ kind: "missing", classes: ["dispatch"] }))
})

it("reports a table where the prototype has cards", () => {
  // The exact defect that shipped: note 33's per-store cards rendered as a table.
  const diffs = compareLandmarks(withStores, withTable)
  expect(diffs.some((d) => d.kind === "missing" && d.classes.includes("stores"))).toBe(true)
  expect(diffs.some((d) => d.kind === "extra" && d.classes.includes("tbl"))).toBe(true)
})

it("reports a style difference on a landmark present in both", () => {
  const diffs = compareLandmarks(radius8, radius0)
  expect(diffs).toContainEqual(expect.objectContaining({ kind: "style", property: "border-radius" }))
})

it("reports NOTHING when the two sides genuinely match", () => {
  expect(compareLandmarks(withDispatch, withDispatch)).toEqual([])
})

it("does not report a difference merely because the numbers differ", () => {
  // Prototype figures are invented; ours come from the database. Text is
  // compared for presence, never for equality.
  expect(compareLandmarks(sales34525, sales7122)).toEqual([])
})

it("reports an element that should carry text and carries none", () => {
  expect(compareLandmarks(sales34525, salesEmpty)).toContainEqual(
    expect.objectContaining({ kind: "style", property: "text" }),
  )
})

it("returns every difference when BOTH sides are empty — never a false pass", () => {
  // A selector typo, a failed navigation, an unauthenticated page: all three
  // produce two empty landmark lists. Silence here would be a green gate over
  // a blank screen.
  expect(() => compareLandmarks([], [])).toThrow(/no landmarks/i)
})
```

That last case is the one this whole task exists to guarantee. Prove every case
can fail: make each fixture pair identical in turn and confirm the
corresponding assertion goes red. Report the outputs.

- [ ] **Step 7: Capture the "before", and commit it unchanged**

```bash
npm run dev &
npm run fidelity -- --grep overview
npm run fidelity:report
```

`docs/counter/fidelity/overview.md` is the baseline this entire project is
measured against. It must read as damningly as the addendum's table — sixteen
landmarks against six. **Commit it unedited.** If it reads clean, the harness
is broken; go back to Step 6.

Run this BEFORE any Phase B task lands. A "before" captured after the
primitives are rebuilt is not a before.

- [ ] **Step 8: Write the protocol down**

`docs/counter/fidelity/README.md` states the rule that binds every Phase C
plan:

> **A page is not done until `npm run fidelity -- --grep <pageId>` is clean on
> both projects and both themes, its manifest entry says `"counter"`, and its
> report is committed.**
>
> Run it twice: once while building, and once more after the last fix, from a
> cold `npm run build && npm run start` rather than the dev server. Dev-mode
> rendering has hidden fidelity defects on this project before — the doubled
> shell and the dead `border-ct-*` utilities both looked fine until a
> production build.

- [ ] **Step 9: Gate and commit**

```bash
rm -rf .next && npm test && npm run tokens && npx tsc --noEmit && npm run build
git add e2e/fidelity playwright.config.ts package.json docs/counter/fidelity tests/e2e
git commit -m "feat(counter): a gate that can see a missing section"
```

## Phase B: the primitives

Every task below follows the same shape, so it is written once here rather than
eight times.

**For each primitive:**

1. Read the prototype's own function. Line numbers, all in
   `docs/counter/counter-prototype.html`:

   | Primitive | Function | Line |
   |---|---|---|
   | Strip | `strip()` | 3008 |
   | Section | `sec()` | 3037 |
   | Table | `tbl()` | 3055 |
   | Queue | `queue()` | 3074 |
   | Money list (phone) | `money()` | 3087 |
   | Phone strip | `mstrip()` | 3093 |
   | Phone list | `mlist()` | 3116 |
   | Chart | `chart()` | 3135 |
   | Head block | `headBlock()` | 3689 |
   | Bullet state | `bstat()` | 3725 |
   | Band words | `bwords()` | 3738 |
   | Bullet meter | `bullet()` | 3745 |
   | Sparkline | `spark()` | 3770 |
   | Series shaping | `shaped()` | 3786 |
   | Floor meter | `floorMeter()` | 3793 |
   | Gap bar | `gapbar()` | 4068 |
   | Cascade | `cascade()` | 5023 |
   | Week meter | `meter()` | 5423 |

2. Write the React component so that **`renderToStaticMarkup(<Component …/>)`
   produces the same element tree, the same classes and the same attribute
   order-independent set as the prototype's function** for the same input.
   No Tailwind utility classes for anything the ported CSS already styles.
3. Test by structure, not by snapshot of our own output: assert the class list,
   the nesting and the inline custom properties (`--len`, `--pc`, `--qc`).
4. Where the prototype branches on a state (`stateOf()` inside `strip()` and
   `sec()`), **do not port that branch.** `Section` is the sole state renderer
   (R3). Port only the `ok` path; `Section` wraps it.

**Interfaces produced by Phase B:** every component keeps its current export
name and module path so no page import changes. Props change; the six-state
contract does not.

### Task 3: Strip, Figure, bullet meter, sparkline

**Files:** `src/components/counter/surface/strip.tsx`, `figure.tsx`, new
`bullet.tsx`, `spark.tsx`; tests in `tests/components/counter/`.

The prototype's strip cell is `[label, value, delta, deltaTone, bandCaption,
reference]` where `reference` is `{v, target|lo/hi, better, s?, quiet?, cap?,
label}`. It emits `.k` `.v`, then the sparkline, then `.d`, then the bullet,
then `.band`. `.strip` carries `data-n` and its column count comes from CSS
container queries — so the "bare grey grid tracks" bug Plan 7 hit disappears
with the port, and the `data-n` attribute must be set or it will not.

`bstat()` decides `ok`/`near`/`breach` and `bwords()` writes the band caption.
Port both as pure functions and test them against the prototype's own
thresholds. These are the numbers a red cell depends on; break each threshold
by 0.1 and watch a test go red.

### Task 4: Section, Table, Queue

**Files:** `section.tsx`, `table.tsx`, new `queue.tsx`.

`sec()` emits `.sec > .sec__head > h3 + .k + .askmini`, then `.sec__body`.
Our `Section` keeps its six-state contract and its `data-ask-about`, and its
`ok` path emits exactly that. `raw()` in the prototype means "no body padding"
— that becomes a `pad={false}` prop.

`tbl()` emits `.tblscroll > table.tbl`, with `.num` on numeric cells and
row-level `data-setrange` / navigation. The eight-week table is `.wkt` with
`.is-here` on the current row — Plan 8's `onSelect`/`selected` design was
right; port it onto the prototype's classes.

`queue()` emits `.queue > .qitem`, each with `.lead` (a figure and a unit),
a title, a body and an action. This is the "What needs you" list.

### Task 5: The shell — rail, topbar, dispatch, date control

**Files:** `shell/rail.tsx`, `topbar.tsx`, `app-shell.tsx`, `date-control.tsx`,
new `dispatch.tsx`.

The rail is `.rail` with `.rail__store`, `.rail__cap`, `.rail__group`,
`.navbtn`, `.badge`, `.rail__foot`, `.avatar`. The topbar is `.topbar` with
`.crumbs`, `.sync`, `.askbtn`.

The date control is `.dr` — `.dr__step`, `.dr__main` (carrying `.lb` AND
`.cmp`, a two-line label our current control does not have), `.dr__next`,
`.dr__today`. **Our control is missing the Today button and the comparison
line entirely**; both are in the ported CSS and both go in.

`.dispatch` is new: `.hot` / `.quiet` spans, a `.sep`, a `.spacer`, and a
`.go` button.

Keep the phone composition from Plan 8 Task 7 in mind but do NOT build it here
— the prototype has its own phone chrome (`.mtab`, `.msheet`, `.mhead`,
`.phactions`) and it belongs to Phase C's phone pass.

### Task 6: Head block, verdict, floor meter, moving, ask bar

**Files:** new `surface/head-block.tsx`, `say.tsx`, `floor-meter.tsx`,
`moving.tsx`, `ask/ask-bar.tsx`.

`headBlock()` wraps `.headline`; the Overview uses `.headline--duo`, a
three-column grid of `.fig`, `.fig.fig--co` and `.say`. `.say` carries a
`.state` chip (`is-warn` / `is-bad`), a paragraph, and a `.linkact`.
`floorMeter()` emits `.hfloor`. `.moving` is a flex row of labelled cells on
`--signal-wash`. `.askbar` is `.askbar__in` plus `.sugs > .sug`.

### Task 7: Charts

**Files:** `surface/chart.tsx`.

`chart()` at line 3135 is the largest primitive: line and bar variants, stacked
and percentage stacking, a comparison series drawn as a dashed reference
(`path.chref`), hover-anywhere with a shared tooltip (`.ch-tip`), a legend
(`.ch-legend`), an optional rule line, and per-column notes. The ported CSS
already styles all of it.

Our current chart is Recharts. **Read `docs/counter/recharts-3-spike.md`
before deciding whether to keep it.** The prototype draws raw SVG, and matching
its DOM with a charting library may cost more than emitting the same SVG the
prototype does. Make that call in this task, record it as a ruling with the
reasoning, and say what it costs if wrong.

### Task 8: Store cards, channel rows, gap bar, cascade, drill

**Files:** new `surface/store-cards.tsx`, `channel-rows.tsx`, `gap-bar.tsx`,
`drill.tsx`; rewrite `cascade.tsx`.

`.stores` is the per-store card grid — **the element that replaces the table
note 33 deleted.** Each card carries a stage tag (`.mtag good|warn`), and a
pre-open card shows build-out percent and what is missing from its store file
rather than a row of em-dashes.

`.chan` / `.cbar` / `.cmeta` is the channel breakdown, with `.cbar u` drawing
the commission portion inside the bar. `.gap` is the food-cost cause
decomposition. `.wf__*` is the cascade — our current `Cascade` invented its own
markup and must be rewritten onto these classes. `.drill` is the collapsible
"every figure against the comparison" drawer.

---

## Self-review

**Spec coverage.** The addendum's Phase A is Tasks 1–2; Phase B is Tasks 3–8.
The addendum's enforcement rule ("a page is not done until it has been diffed
against the prototype") is Task 2 and is used by every Phase C plan.

**Placeholders.** Tasks 3–8 deliberately carry less inline code than Tasks 1–2,
because the code they must produce is *in the prototype* at the line numbers
given. Copying 100KB of it into this document would put a second, drifting copy
of the design in the repo — the exact failure this plan exists to correct. Each
Phase B task's brief must therefore instruct the implementer to read the
prototype function first, and each task's review checks the emitted DOM against
it.

**Type consistency.** Every component keeps its export name and module path, so
`@/components/counter`'s barrel and every page import are unchanged. `Section`
keeps `SectionData<T>`; the others keep taking plain `T`.

**Known gaps carried forward.**
1. Phase C is not planned here. Each page gets its own plan, written from that
   page's `P.<id>.desk()` and `P.<id>.phone()`, once the primitives exist.
2. The adapters still under-fetch. Overview's rebuild in Phase C is where
   `alerts/inbox-actions`, `decisions/get-decisions-view`, `forecasts/`,
   `ratings/` and `splh-actions` finally get called.
3. `getSplhSeries` still takes no date range. Phase C's Overview needs it to;
   that is a server change, and it is the first one this project has needed.
