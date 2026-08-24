# Counter Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring every dependency current, then land the Counter token layer — light and dark, contrast- and CVD-verified by test — with a static gate that makes the design rules unbreakable.

**Architecture:** Counter's raw custom properties are namespaced `--ct-*` so they can never collide with the shadcn HSL triplets already in `globals.css`. A Tailwind v4 `@theme` block exposes them as `ct-`-prefixed utilities (`bg-ct-paper`, `text-ct-ink`), and a second small edit re-points shadcn's own semantic theme vars at Counter tokens so shadcn components inherit the look without a name fight. Colour correctness is not eyeballed: a culori-backed Vitest suite asserts WCAG contrast and CIEDE2000 separation under normal vision and all three CVD models, for both themes.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, Tailwind v4, Vitest 4, Playwright, culori 4 (new devDependency), `next/font/google`.

**Spec:** [`docs/superpowers/specs/2026-08-23-counter-design-system-design.md`](../specs/2026-08-23-counter-design-system-design.md)

**Prototype:** [`docs/counter/counter-prototype.html`](../../counter/counter-prototype.html) — open in a browser; it is the visual source of truth and carries the 51 numbered decision notes cited below.

## Global Constraints

- Branch is `dashboardv2`. Never rebase onto main (spec decision 7). Never merge to main during this plan.
- **Never `prisma migrate dev`** — it would reset the Neon production database. This plan touches no schema.
- The whole-project gate is `npm test && npx tsc --noEmit && npm run build`. No task is complete until it passes.
- Counter raw custom properties are prefixed `--ct-`. Counter Tailwind colour utilities are prefixed `ct-`. No exceptions.
- Counter's light token values are copied **verbatim** from `.frame` in the prototype. Do not adjust them.
- Type scale is fixed px, ratio ~1.16: 10 / 11.5 / 13 / 15 / 18 / 22 / 30. Radii are 8px and 5px only.
- Bricolage Grotesque is for page titles and the wordmark only. Every figure is DM Sans with `tabular-nums lining-nums`. Captions, folios, SKUs and status labels are JetBrains Mono.
- Commit messages: no `Co-Authored-By: Claude` line.
- One commit per dependency major. Never combine two majors in one commit.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/drift-watch.ts` | Read-only report of how far main has diverged in UI directories |
| `src/styles/counter.css` | **The only colour source.** `--ct-*` raw tokens (light + dark) and the `@theme` block that exposes them |
| `src/app/globals.css` | Modified: shadcn `@theme` mappings re-pointed at Counter tokens |
| `src/components/counter/theme-provider.tsx` | Theme resolution (system / light / dark), persistence, no-flash script |
| `src/components/counter/theme-toggle.tsx` | The control |
| `tests/styles/counter-tokens.test.ts` | Contrast + CVD assertions over `counter.css`, both themes |
| `tests/styles/counter-lint.test.ts` | The four §2.3 rules as a test |
| `scripts/counter-lint.ts` | Shared lint implementation, consumed by the test and by `npm run tokens` |
| `DESIGN.md` | Rewritten for Counter |
| `CLAUDE.md` | Tripwires rewritten |

`scripts/counter-lint.ts` holds the logic and `tests/styles/counter-lint.test.ts` plus the `tokens` npm script both call it — one implementation, two entry points.

---

### Task 1: Baseline capture and the drift watch

**Files:**
- Create: `scripts/drift-watch.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Produces: `npm run drift` — prints changed-file counts in UI directories on `main` vs. this branch; always exits 0.

- [ ] **Step 1: Confirm the tree is green before changing anything**

```bash
npm test && npx tsc --noEmit && npm run build
```

Expected: all three pass. If any fails, STOP and report — a red baseline makes every later gate meaningless.

- [ ] **Step 2: Record the current per-route bundle budgets**

```bash
npm run bundle:check | tee docs/counter/baseline-bundles.txt
```

Expected: a table of routes. This file is the evidence that Counter did not make a route slower.

- [ ] **Step 3: Write the drift watch**

```ts
// scripts/drift-watch.ts
#!/usr/bin/env tsx
/**
 * Read-only. Spec decision 7 declined rebasing this branch onto main, so the
 * one thing that makes that choice expensive — main starting to touch UI —
 * has to be visible rather than discovered at merge time.
 *
 * Recent main commits touch src/lib/ml, scripts/ and prisma/. If the numbers
 * below start climbing in src/app, src/components or src/styles, raise it.
 */
import { execFileSync } from "node:child_process"

const WATCHED = ["src/app", "src/components", "src/styles"] as const
const IGNORED = ["src/lib/ml", "scripts", "prisma"] as const

function changedFiles(paths: readonly string[]): number {
  const out = execFileSync(
    "git",
    ["diff", "--name-only", "main...HEAD", "--", ...paths],
    { encoding: "utf8" },
  ).trim()
  return out === "" ? 0 : out.split("\n").length
}

function mainOnlyChanges(paths: readonly string[]): number {
  const out = execFileSync(
    "git",
    ["diff", "--name-only", "HEAD...main", "--", ...paths],
    { encoding: "utf8" },
  ).trim()
  return out === "" ? 0 : out.split("\n").length
}

const ours = changedFiles(WATCHED)
const theirs = mainOnlyChanges(WATCHED)
const theirsElsewhere = mainOnlyChanges(IGNORED)

console.log(`drift watch (branch vs main)`)
console.log(`  ours   in ${WATCHED.join(", ")}: ${ours} files`)
console.log(`  main's in ${WATCHED.join(", ")}: ${theirs} files`)
console.log(`  main's in ${IGNORED.join(", ")}: ${theirsElsewhere} files`)
if (theirs > 0) {
  console.log(
    `\n  NOTE: main has touched ${theirs} UI file(s). Spec decision 7 assumed it would not.`,
  )
}
```

- [ ] **Step 4: Wire the script**

In `package.json` `"scripts"`, add:

```json
"drift": "tsx scripts/drift-watch.ts",
```

- [ ] **Step 5: Run it**

Run: `npm run drift`
Expected: prints three counts and exits 0. `main's in src/app, src/components, src/styles: 0 files`.

- [ ] **Step 6: Commit**

```bash
git add scripts/drift-watch.ts package.json docs/counter/baseline-bundles.txt
git commit -m "chore(counter): drift watch and the bundle baseline it defends"
```

---

### Task 2: Minors, patches, and the security advisories

**Files:**
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Produces: a tree where `npm outdated` shows only major-version gaps, and `npm audit` reports no high or critical advisories.

- [ ] **Step 1: Take every non-major update**

```bash
npm update --save
```

- [ ] **Step 2: Run the gate**

```bash
npm test && npx tsc --noEmit && npm run build
```

Expected: PASS. If a test fails, fix it in this commit — a minor that breaks a test is still a minor.

- [ ] **Step 3: Commit the minors**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): every minor and patch current"
```

- [ ] **Step 4: Clear the advisories**

`next-auth` carries a CRITICAL and is a direct dependency; `next` and `prisma` carry HIGH. All three reported a non-breaking fix.

```bash
npm audit fix
npm audit --omit=dev
```

Expected: the second command reports 0 critical and 0 high. Moderate and low may remain — record them, do not force them.

- [ ] **Step 5: Run the gate**

```bash
npm test && npx tsc --noEmit && npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json
git commit -m "fix(deps): clear the critical next-auth advisory and the high ones"
```

---

### Task 3: Recharts 3, and the spike that decides `<Chart>`

Counter mandates chart behaviour Recharts 2 fights: hover anywhere with the nearest reading winning, a crosshair plus dot plus a card naming every series and the comparison, non-hovered bars dimmed to 42%, a 720ms line draw-on, and touch-drag on the phone (note 16). This task answers whether Recharts 3 can do it **before** any primitive depends on the answer.

**Files:**
- Modify: `package.json`, `package-lock.json`, any file importing `recharts`
- Create: `docs/counter/recharts-3-spike.md`

**Interfaces:**
- Produces: a recorded verdict that Task-set 2 of the next plan (the `<Chart>` primitive) consumes.

- [ ] **Step 1: Find every consumer**

```bash
grep -rln "from \"recharts\"\|from 'recharts'" src | sort
```

Record the list — every file here needs checking after the upgrade.

- [ ] **Step 2: Upgrade**

```bash
npm install recharts@^3
```

- [ ] **Step 3: Run the gate**

```bash
npm test && npx tsc --noEmit && npm run build
```

Expected: TypeScript errors are likely — Recharts 3 tightened generics and renamed several props. Fix each consumer found in Step 1. Do not suppress with `any`; if a type is genuinely unavailable, narrow it explicitly and comment why.

- [ ] **Step 4: Answer the five capability questions**

Write `docs/counter/recharts-3-spike.md` with a verdict line for each. Prove each against a real chart in the app (`npm run dev`, then a page from the Step 1 list), not against the docs.

```markdown
# Recharts 3 capability spike

Counter's chart contract is prototype note 16. Five questions, five verdicts.

| Capability | Recharts 3 | How it was proved |
|---|---|---|
| Hover anywhere on the plot, nearest reading wins | ? | |
| Crosshair + dot + card naming every series and the comparison | ? | |
| Non-hovered bars dim to 42% | ? | |
| Line stroke-on over 720ms, bars grow from baseline 26ms apart | ? | |
| Touch-drag moves the card on the phone | ? | |

## Verdict

<!-- One of:
  RECHARTS: <Chart> wraps Recharts 3 directly.
  HYBRID:   Recharts 3 for <named types>, custom SVG for <named types>.
  CUSTOM:   <Chart> is a custom SVG layer; Recharts is removed.
Whichever it is, <Chart>'s props are identical either way — pages never learn
which one is underneath. -->
```

- [ ] **Step 5: Run the gate again**

```bash
npm test && npx tsc --noEmit && npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src docs/counter/recharts-3-spike.md
git commit -m "chore(deps): recharts 3, and whether it can draw what Counter asks"
```

---

### Task 4: react-day-picker 10

This is the 12-preset date control's foundation (note 19: a range that only changes the label is a lie).

**Files:**
- Modify: `package.json`, `package-lock.json`, every file importing `react-day-picker`

- [ ] **Step 1: Find every consumer**

```bash
grep -rln "react-day-picker" src | sort
```

- [ ] **Step 2: Upgrade and read the migration notes**

```bash
npm install react-day-picker@^10
```

Then check the breaking changes for v10 before fixing errors, so fixes are correct rather than merely compiling:

```bash
npm view react-day-picker@10 homepage
```

- [ ] **Step 3: Run the gate**

```bash
npm test && npx tsc --noEmit && npm run build
```

Expected: type errors in the calendar component. Fix each; prop names and the `mode` API changed across v9→v10.

- [ ] **Step 4: Verify the picker still works in a browser**

```bash
npm run shot -- /dashboard/analytics /tmp/claude-1000/-home-vardan-restaurant-dashboard/f13d2a63-b57c-46eb-b217-6a8085b657c7/scratchpad/daypicker.png
```

Expected: the screenshot renders with the date control visible and not visually broken. A compiling calendar that renders as an empty box is a failure.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src
git commit -m "chore(deps): react-day-picker 10"
```

---

### Task 5: framer-motion 13

Counter's motion system lives behind `motion/` hooks (spec §2.3 rule 4), so this is the last time page code touches this library directly.

**Files:**
- Modify: `package.json`, `package-lock.json`, every file importing `framer-motion`

- [ ] **Step 1: Find every consumer**

```bash
grep -rln "framer-motion" src | sort
```

- [ ] **Step 2: Upgrade**

```bash
npm install framer-motion@^13
```

- [ ] **Step 3: Run the gate**

```bash
npm test && npx tsc --noEmit && npm run build
```

Expected: PASS or a small number of import/type fixes.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src
git commit -m "chore(deps): framer-motion 13"
```

---

### Task 6: lucide-react 1.x

**Files:**
- Modify: `package.json`, `package-lock.json`, any file whose icon import was renamed

- [ ] **Step 1: Upgrade**

```bash
npm install lucide-react@^1
```

- [ ] **Step 2: Run the gate**

```bash
npm test && npx tsc --noEmit && npm run build
```

Expected: errors naming specific missing icon exports, if any were renamed in 1.0. Fix by importing the new name — never by substituting a different icon, which silently changes meaning.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json src
git commit -m "chore(deps): lucide-react 1.x"
```

---

### Task 7: TanStack Table 9

**Files:**
- Modify: `package.json`, `package-lock.json`, every file importing `@tanstack/react-table`

- [ ] **Step 1: Find every consumer and note the count**

```bash
grep -rln "@tanstack/react-table" src | tee /tmp/claude-1000/-home-vardan-restaurant-dashboard/f13d2a63-b57c-46eb-b217-6a8085b657c7/scratchpad/table-consumers.txt | wc -l
```

- [ ] **Step 2: Upgrade**

```bash
npm install @tanstack/react-table@^9
```

- [ ] **Step 3: Run the gate**

```bash
npm test && npx tsc --noEmit && npm run build
```

Expected: type errors across the consumer list. Fix them.

- [ ] **Step 4: If this exceeds a day of work, stop and report**

Spec §7 says so explicitly. Revert this task's changes only (`git checkout -- .`), leave a note in `docs/counter/deferred-upgrades.md`, and continue with Task 8. Do not grind.

```markdown
# Deferred upgrades

| Package | From → To | Why deferred | Blocks |
|---|---|---|---|
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src
git commit -m "chore(deps): tanstack-table 9"
```

---

### Task 8: TypeScript 7

**Files:**
- Modify: `package.json`, `package-lock.json`, `tsconfig.json` if required, any file with a newly-surfaced error

- [ ] **Step 1: Upgrade**

```bash
npm install -D typescript@^7
```

- [ ] **Step 2: See the size of the problem before fixing anything**

```bash
npx tsc --noEmit 2>&1 | tail -5
npx tsc --noEmit 2>&1 | grep -c "error TS" || true
```

Record the error count. This decides whether to proceed or defer.

- [ ] **Step 3: Fix, or defer**

If the count is small enough to clear in a day, fix each error properly — no `@ts-expect-error` without a comment naming what it is waiting on, no widening to `any`.

If not, revert this task only and record it:

```bash
git checkout -- package.json package-lock.json && npm install
```

Then add a row to `docs/counter/deferred-upgrades.md` and continue to Task 9. Report the decision.

- [ ] **Step 4: Run the full gate**

```bash
npm test && npx tsc --noEmit && npm run build && npm run typecheck:scripts
```

Expected: PASS. Note `typecheck:scripts` is included here — it uses a separate tsconfig and TS 7 affects it too.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json src scripts
git commit -m "chore(deps): typescript 7"
```

---

### Task 9: shadcn CLI 4

The CLI only generates components; upgrading it changes nothing already on disk. It matters because Counter will pull new primitives through it.

**Files:**
- Modify: `package.json`, `package-lock.json`, `components.json` if its schema changed

- [ ] **Step 1: Upgrade**

```bash
npm install -D shadcn@^4
```

- [ ] **Step 2: Verify the CLI reads the existing config**

```bash
npx shadcn@4 --version
```

Expected: prints a 4.x version and does not error on `components.json`. If the config schema changed, migrate it now — a broken `components.json` fails silently later.

- [ ] **Step 3: Run the gate**

```bash
npm test && npx tsc --noEmit && npm run build
```

Expected: PASS — nothing in `src` changed.

- [ ] **Step 4: Confirm the sweep landed**

```bash
npm outdated
```

Expected: only packages listed in `docs/counter/deferred-upgrades.md` remain behind. Anything else still behind was missed — go back for it.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json components.json
git commit -m "chore(deps): shadcn 4, closing the sweep"
```

---

### Task 10: The Counter token layer, light

Values are copied verbatim from `.frame` in the prototype. The `--ct-` prefix exists because `globals.css` already defines `--accent`, `--border`, `--ring` and others as bare HSL triplets consumed via `hsl(var(--x))`; an oklch value under those names would produce `hsl(oklch(...))` and break every shadcn component.

**Files:**
- Create: `src/styles/counter.css`
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: `--ct-*` raw properties on `:root`; Tailwind utilities `bg-ct-paper`, `text-ct-ink`, `border-ct-line`, `rounded-ct`, `rounded-ct-sm`, `text-ct-body` and the rest of the scale.

- [ ] **Step 1: Write the token file**

```css
/* src/styles/counter.css
 *
 * The only colour source in the application. Values are copied verbatim from
 * the `.frame` block of docs/counter/counter-prototype.html — do not adjust
 * them here; adjust the prototype and re-copy.
 *
 * Every raw property is prefixed --ct- because src/app/globals.css already
 * defines --accent, --border, --ring and others as bare HSL triplets consumed
 * as hsl(var(--x)). An oklch value under those names yields hsl(oklch(...)),
 * which is invalid, and it fails silently.
 *
 * No #fff and no #000: every neutral is tinted warm.
 *
 * Task 12 converts every value below into light-dark(light, dark) so each
 * token is declared exactly ONCE. There is deliberately no second block and no
 * media query: a duplicated token set is what token-parity.test.ts exists to
 * catch, and it caught six copies drifting apart once already.
 */

:root {
  color-scheme: light dark;

  /* surfaces — content sits lighter than chrome */
  --ct-surface:      oklch(98.4% 0.004 66);
  --ct-paper:        oklch(96.2% 0.006 60);
  --ct-chrome:       oklch(94.4% 0.008 56);
  --ct-sunk:         oklch(92.6% 0.009 55);
  --ct-line:         oklch(89.5% 0.009 58);
  --ct-line-strong:  oklch(82.5% 0.013 55);

  /* ink */
  --ct-ink:          oklch(24% 0.014 40);
  --ct-ink-2:        oklch(47% 0.012 45);
  --ct-ink-3:        oklch(55% 0.011 50);

  /* action + state */
  --ct-accent:       oklch(52% 0.19 27);
  --ct-accent-hi:    oklch(44% 0.17 27);
  --ct-accent-wash:  oklch(94.5% 0.028 27);
  --ct-signal:       oklch(80% 0.155 78);
  --ct-signal-wash:  oklch(95.5% 0.042 82);
  --ct-signal-line:  oklch(87% 0.070 80);
  --ct-signal-ink:   oklch(44% 0.095 70);
  --ct-good:         oklch(47% 0.098 160);
  --ct-good-wash:    oklch(95.5% 0.026 160);
  --ct-warn:         oklch(53% 0.115 70);
  --ct-warn-wash:    oklch(95.5% 0.035 78);
  --ct-bad:          oklch(50% 0.175 25);
  --ct-bad-wash:     oklch(94.5% 0.030 25);

  /* channel identity — brand marks, ALWAYS paired with a text label.
     Never used to carry data: as a set these four clear only dE 8.5. */
  --ct-ch-house: #4A4541;
  --ct-ch-dd:    #EB1700;
  --ct-ch-ue:    #16110F;
  --ct-ch-gh:    #F15C26;

  /* stacked data bands — separated by lightness, not hue. Adjacent pairs
     clear dE 15 in normal vision and under all three CVD models. Fixed to
     the channel, never to its rank (note 41). */
  --ct-mx-1: oklch(29.5% 0.020 45);
  --ct-mx-2: oklch(45.5% 0.027 45);
  --ct-mx-3: oklch(60.5% 0.031 50);
  --ct-mx-4: oklch(76% 0.025 58);

  /* one overshoot, split into what made it. Sequential ramp of the bad hue,
     monotone in lightness, fixed to the cause rather than to its size. */
  --ct-gp-1: oklch(35.5% 0.125 28);
  --ct-gp-2: oklch(51.5% 0.158 30);
  --ct-gp-3: oklch(67% 0.118 45);

  /* type scale, fixed px, ratio ~1.16 */
  --ct-t-micro: 10px;
  --ct-t-cap:   11.5px;
  --ct-t-body:  13px;
  --ct-t-mid:   15px;
  --ct-t-lg:    18px;
  --ct-t-xl:    22px;
  --ct-t-hero:  30px;

  --ct-r:    8px;
  --ct-r-sm: 5px;

  --ct-ease: cubic-bezier(0.22, 1, 0.36, 1);
}

@theme inline {
  --color-ct-surface:      var(--ct-surface);
  --color-ct-paper:        var(--ct-paper);
  --color-ct-chrome:       var(--ct-chrome);
  --color-ct-sunk:         var(--ct-sunk);
  --color-ct-line:         var(--ct-line);
  --color-ct-line-strong:  var(--ct-line-strong);
  --color-ct-ink:          var(--ct-ink);
  --color-ct-ink-2:        var(--ct-ink-2);
  --color-ct-ink-3:        var(--ct-ink-3);
  --color-ct-accent:       var(--ct-accent);
  --color-ct-accent-hi:    var(--ct-accent-hi);
  --color-ct-accent-wash:  var(--ct-accent-wash);
  --color-ct-signal:       var(--ct-signal);
  --color-ct-signal-wash:  var(--ct-signal-wash);
  --color-ct-signal-line:  var(--ct-signal-line);
  --color-ct-signal-ink:   var(--ct-signal-ink);
  --color-ct-good:         var(--ct-good);
  --color-ct-good-wash:    var(--ct-good-wash);
  --color-ct-warn:         var(--ct-warn);
  --color-ct-warn-wash:    var(--ct-warn-wash);
  --color-ct-bad:          var(--ct-bad);
  --color-ct-bad-wash:     var(--ct-bad-wash);
  --color-ct-ch-house:     var(--ct-ch-house);
  --color-ct-ch-dd:        var(--ct-ch-dd);
  --color-ct-ch-ue:        var(--ct-ch-ue);
  --color-ct-ch-gh:        var(--ct-ch-gh);
  --color-ct-mx-1:         var(--ct-mx-1);
  --color-ct-mx-2:         var(--ct-mx-2);
  --color-ct-mx-3:         var(--ct-mx-3);
  --color-ct-mx-4:         var(--ct-mx-4);
  --color-ct-gp-1:         var(--ct-gp-1);
  --color-ct-gp-2:         var(--ct-gp-2);
  --color-ct-gp-3:         var(--ct-gp-3);

  --text-ct-micro: var(--ct-t-micro);
  --text-ct-cap:   var(--ct-t-cap);
  --text-ct-body:  var(--ct-t-body);
  --text-ct-mid:   var(--ct-t-mid);
  --text-ct-lg:    var(--ct-t-lg);
  --text-ct-xl:    var(--ct-t-xl);
  --text-ct-hero:  var(--ct-t-hero);

  --radius-ct:    var(--ct-r);
  --radius-ct-sm: var(--ct-r-sm);

  --ease-ct: var(--ct-ease);
}
```

- [ ] **Step 2: Import it and re-point shadcn at Counter**

In `src/app/globals.css`, add the import directly under the Tailwind import — order matters, Counter must load after Tailwind:

```css
@import "tailwindcss";
@import "../styles/counter.css";
```

Then, in the existing `@theme` block, replace these seven mappings so shadcn components inherit Counter rather than the old restaurant theme. Leave every other mapping alone; the bare HSL triplets in `:root` stay exactly as they are, because legacy editorial pages still read them until their rebuild phase deletes them.

```css
  --color-background: var(--ct-paper);
  --color-foreground: var(--ct-ink);
  --color-card: var(--ct-surface);
  --color-card-foreground: var(--ct-ink);
  --color-popover: var(--ct-surface);
  --color-popover-foreground: var(--ct-ink);
  --color-muted-foreground: var(--ct-ink-3);
```

- [ ] **Step 3: Verify the tokens actually reach the browser**

```bash
npm run build && npm run dev &
sleep 8
npm run shot -- /dashboard /tmp/claude-1000/-home-vardan-restaurant-dashboard/f13d2a63-b57c-46eb-b217-6a8085b657c7/scratchpad/tokens-light.png
```

Expected: the page renders. It will look like a mix of editorial and Counter — that is correct at this stage and not a failure. What must NOT happen is an unstyled or blank page, which would mean the import order is wrong.

- [ ] **Step 4: Run the gate**

```bash
npm test && npx tsc --noEmit && npm run build
```

Expected: PASS. Note `tests/styles/token-parity.test.ts` reads every `.css` in `src/styles` — if it fails on `counter.css`, read its assertions before changing anything; it exists because six copies of a token drifted apart once.

- [ ] **Step 5: Commit**

```bash
git add src/styles/counter.css src/app/globals.css
git commit -m "feat(counter): the token layer, light"
```

---

### Task 11: Prove the colours, don't trust them

The prototype cites specific numbers — adjacent `mx` pairs clear ΔE 15 under all three CVD models where the brand hexes clear 8.5; the `gp` ramp clears ΔE 16 and 3:1 on surface. Those claims hold for the light set the prototype drew. We are about to author a dark set that nobody has checked. This test is what makes that safe, and it guards every future token edit.

**Files:**
- Create: `tests/styles/counter-tokens.test.ts`
- Modify: `package.json` (culori devDependency)

**Interfaces:**
- Consumes: `src/styles/counter.css` from Task 10.
- Produces: `parseTokens(css: string, theme: "light" | "dark"): Map<string, string>` exported from the test file for reuse by Task 12.

- [ ] **Step 1: Add culori**

```bash
npm install -D culori@^4
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/styles/counter-tokens.test.ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  parse,
  wcagContrast,
  differenceCiede2000,
  filterDeficiencyProt,
  filterDeficiencyDeuter,
  filterDeficiencyTrit,
} from "culori"

/**
 * tests/styles/token-parity.test.ts guards against copies of a token drifting
 * apart. This file guards the values themselves.
 *
 * The prototype states its own numbers: adjacent mx pairs clear dE 15 in
 * normal vision and under all three CVD models, where the four brand hexes
 * clear only 8.5; the gp ramp clears dE 16 and 3:1 on surface. Those hold for
 * the light set, which was designed. The dark set was not — it is ours, so it
 * is asserted rather than assumed.
 *
 * Precedent: --ink-faint shipped at 2.48:1 for months because nothing checked.
 */

const CSS = readFileSync(join(process.cwd(), "src", "styles", "counter.css"), "utf8")

/**
 * Every `--ct-*` declaration, resolved for one theme.
 *
 * Tokens are declared once as `light-dark(a, b)`, so this picks a side rather
 * than reading a second block. A token that is NOT a light-dark pair has no
 * dark value, which is a failure — that is how this test drives Task 12.
 */
export function parseTokens(css: string, theme: "light" | "dark"): Map<string, string> {
  const start = css.indexOf(":root {")
  if (start === -1) throw new Error("no :root block in counter.css")
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start))
  const out = new Map<string, string>()
  for (const m of body.matchAll(/(--ct-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const [, name, raw] = [m[0], m[1], m[2].trim()] as const
    const pair = raw.match(/^light-dark\(\s*(.+?)\s*,\s*(.+?)\s*\)$/)
    if (pair) {
      out.set(name, theme === "light" ? pair[1] : pair[2])
    } else if (theme === "light") {
      out.set(name, raw)
    } else {
      throw new Error(
        `${name} has no dark value: declare it as light-dark(light, dark)`,
      )
    }
  }
  return out
}

const DEFICIENCIES = {
  normal: <T>(c: T) => c,
  protanopia: filterDeficiencyProt(1),
  deuteranopia: filterDeficiencyDeuter(1),
  tritanopia: filterDeficiencyTrit(1),
} as const

function colorOf(tokens: Map<string, string>, name: string) {
  const raw = tokens.get(name)
  if (!raw) throw new Error(`missing token ${name}`)
  const c = parse(raw)
  if (!c) throw new Error(`unparseable token ${name}: ${raw}`)
  return c
}

/** Text-on-surface pairs and the WCAG ratio each must clear. */
const CONTRAST: Array<[fg: string, bg: string, min: number, why: string]> = [
  ["--ct-ink", "--ct-paper", 4.5, "body text on the page"],
  ["--ct-ink", "--ct-surface", 4.5, "body text on a panel"],
  ["--ct-ink-2", "--ct-paper", 4.5, "secondary prose"],
  ["--ct-ink-3", "--ct-paper", 4.5, "captions, folios, SKUs"],
  ["--ct-ink-3", "--ct-surface", 4.5, "captions on a panel"],
  ["--ct-accent", "--ct-paper", 4.5, "the proofmark, used as text"],
  ["--ct-accent", "--ct-accent-wash", 4.5, "accent text on its own wash"],
  ["--ct-signal-ink", "--ct-signal-wash", 4.5, "signal text on signal wash"],
  ["--ct-good", "--ct-good-wash", 4.5, "good text on good wash"],
  ["--ct-warn", "--ct-warn-wash", 4.5, "warn text on warn wash"],
  ["--ct-bad", "--ct-bad-wash", 4.5, "bad text on bad wash"],
  ["--ct-line-strong", "--ct-paper", 3, "a hairline that must be seen"],
]

const THEMES = ["light", "dark"] as const

describe.each(THEMES)("counter tokens — %s", (theme) => {
  const tokens = parseTokens(CSS, theme)

  it.each(CONTRAST)("%s on %s clears %s:1 (%s)", (fg, bg, min) => {
    const ratio = wcagContrast(colorOf(tokens, fg), colorOf(tokens, bg))
    expect(ratio).toBeGreaterThanOrEqual(min)
  })

  it.each(Object.keys(DEFICIENCIES))(
    "adjacent mx bands clear dE 15 under %s",
    (vision) => {
      const filter = DEFICIENCIES[vision as keyof typeof DEFICIENCIES]
      const bands = ["--ct-mx-1", "--ct-mx-2", "--ct-mx-3", "--ct-mx-4"].map((n) =>
        filter(colorOf(tokens, n)),
      )
      for (let i = 0; i < bands.length - 1; i++) {
        expect(differenceCiede2000()(bands[i], bands[i + 1])).toBeGreaterThanOrEqual(15)
      }
    },
  )

  it.each(Object.keys(DEFICIENCIES))(
    "adjacent gp steps clear dE 16 under %s",
    (vision) => {
      const filter = DEFICIENCIES[vision as keyof typeof DEFICIENCIES]
      const ramp = ["--ct-gp-1", "--ct-gp-2", "--ct-gp-3"].map((n) =>
        filter(colorOf(tokens, n)),
      )
      for (let i = 0; i < ramp.length - 1; i++) {
        expect(differenceCiede2000()(ramp[i], ramp[i + 1])).toBeGreaterThanOrEqual(16)
      }
    },
  )

  it("every gp step clears 3:1 on surface", () => {
    for (const n of ["--ct-gp-1", "--ct-gp-2", "--ct-gp-3"]) {
      expect(wcagContrast(colorOf(tokens, n), colorOf(tokens, "--ct-surface"))).toBeGreaterThanOrEqual(3)
    }
  })

  it("every mx band clears 3:1 on paper", () => {
    for (const n of ["--ct-mx-1", "--ct-mx-2", "--ct-mx-3", "--ct-mx-4"]) {
      expect(wcagContrast(colorOf(tokens, n), colorOf(tokens, "--ct-paper"))).toBeGreaterThanOrEqual(3)
    }
  })

  it("the surface stack is monotone, so panels read as lifted", () => {
    const l = (n: string) => parse(tokens.get(n)!)!.l ?? 0
    const stack = ["--ct-surface", "--ct-paper", "--ct-chrome", "--ct-sunk"].map(l)
    const descending = stack.every((v, i) => i === 0 || v <= stack[i - 1])
    const ascending = stack.every((v, i) => i === 0 || v >= stack[i - 1])
    expect(descending || ascending).toBe(true)
  })

  it("declares no pure white and no pure black", () => {
    for (const [name, value] of tokens) {
      if (!/^--ct-(ch|mx|gp|surface|paper|chrome|sunk|line|ink|accent|signal|good|warn|bad)/.test(name)) continue
      const c = parse(value)
      if (!c) continue
      expect(`${name} ${value}`).not.toMatch(/#fff\b|#ffffff|#000\b|#000000/i)
    }
  })

  it("declares every token exactly once, in a single :root block", () => {
    // A second block is how six copies of --ink-faint drifted apart. Tokens are
    // light-dark() pairs precisely so there is nothing to keep in step.
    expect(CSS.match(/^:root\s*\{/gm)?.length ?? 0).toBe(1)
    expect(CSS).not.toMatch(/prefers-color-scheme/)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/styles/counter-tokens.test.ts`
Expected: the light assertions PASS (Task 10's values are the prototype's, which were designed) and every dark assertion FAILS with `--ct-surface has no dark value: declare it as light-dark(light, dark)`. That is exactly right — Task 12 supplies the dark halves.

- [ ] **Step 4: Commit the test before the values it judges**

```bash
git add tests/styles/counter-tokens.test.ts package.json package-lock.json
git commit -m "test(counter): assert the colour claims instead of trusting them"
```

---

### Task 12: The dark set, authored against the test

The prototype never drew a dark product surface, so these values are ours. The starting set below preserves every relationship the light set encodes — the surface stack stays monotone, the `mx` bands stay fixed to their channel, the `gp` ramp stays monotone in lightness — inverted for a dark ground. **The test from Task 11 is the arbiter.** Adjust these numbers until it passes; do not weaken the test.

**Files:**
- Modify: `src/styles/counter.css`

**Interfaces:**
- Consumes: `tests/styles/counter-tokens.test.ts` from Task 11.
- Produces: a `:root[data-theme="dark"]` block with the identical token names as `:root`.

- [ ] **Step 1: Give every colour token its dark half, in place**

Do **not** add a second block. In `src/styles/counter.css`, convert each colour
declaration in the existing `:root` to a `light-dark()` pair — the light value
is already there and does not change. The type scale, radii and easing are not
colours and stay as they are.

```css
  /* surfaces — content sits lighter than chrome, in both grounds */
  --ct-surface:      light-dark(oklch(98.4% 0.004 66), oklch(22% 0.006 66));
  --ct-paper:        light-dark(oklch(96.2% 0.006 60), oklch(19% 0.007 60));
  --ct-chrome:       light-dark(oklch(94.4% 0.008 56), oklch(16.5% 0.008 56));
  --ct-sunk:         light-dark(oklch(92.6% 0.009 55), oklch(14% 0.009 55));
  --ct-line:         light-dark(oklch(89.5% 0.009 58), oklch(28% 0.009 58));
  --ct-line-strong:  light-dark(oklch(82.5% 0.013 55), oklch(38% 0.013 55));

  --ct-ink:          light-dark(oklch(24% 0.014 40), oklch(93% 0.010 60));
  --ct-ink-2:        light-dark(oklch(47% 0.012 45), oklch(74% 0.011 55));
  --ct-ink-3:        light-dark(oklch(55% 0.011 50), oklch(62% 0.011 52));

  --ct-accent:       light-dark(oklch(52% 0.19 27),   oklch(68% 0.170 27));
  --ct-accent-hi:    light-dark(oklch(44% 0.17 27),   oklch(76% 0.150 27));
  --ct-accent-wash:  light-dark(oklch(94.5% 0.028 27), oklch(27% 0.045 27));
  --ct-signal:       light-dark(oklch(80% 0.155 78),  oklch(78% 0.150 78));
  --ct-signal-wash:  light-dark(oklch(95.5% 0.042 82), oklch(26% 0.045 82));
  --ct-signal-line:  light-dark(oklch(87% 0.070 80),  oklch(36% 0.060 80));
  --ct-signal-ink:   light-dark(oklch(44% 0.095 70),  oklch(84% 0.090 78));
  --ct-good:         light-dark(oklch(47% 0.098 160), oklch(74% 0.115 160));
  --ct-good-wash:    light-dark(oklch(95.5% 0.026 160), oklch(24% 0.030 160));
  --ct-warn:         light-dark(oklch(53% 0.115 70),  oklch(78% 0.115 78));
  --ct-warn-wash:    light-dark(oklch(95.5% 0.035 78), oklch(25% 0.035 78));
  --ct-bad:          light-dark(oklch(50% 0.175 25),  oklch(70% 0.165 25));
  --ct-bad-wash:     light-dark(oklch(94.5% 0.030 25), oklch(26% 0.040 25));

  /* brand marks lifted off the dark ground; still always beside a text label */
  --ct-ch-house: light-dark(#4A4541, #B9B0A8);
  --ct-ch-dd:    light-dark(#EB1700, #FF6A54);
  --ct-ch-ue:    light-dark(#16110F, #E8E2DE);
  --ct-ch-gh:    light-dark(#F15C26, #FF8A5C);

  /* the band ramp inverts wholesale: still monotone in lightness, still fixed
     to the channel and never to its rank */
  --ct-mx-1: light-dark(oklch(29.5% 0.020 45), oklch(88% 0.020 45));
  --ct-mx-2: light-dark(oklch(45.5% 0.027 45), oklch(74% 0.027 45));
  --ct-mx-3: light-dark(oklch(60.5% 0.031 50), oklch(60% 0.031 50));
  --ct-mx-4: light-dark(oklch(76% 0.025 58),   oklch(47% 0.025 58));

  --ct-gp-1: light-dark(oklch(35.5% 0.125 28), oklch(62% 0.125 28));
  --ct-gp-2: light-dark(oklch(51.5% 0.158 30), oklch(73% 0.150 30));
  --ct-gp-3: light-dark(oklch(67% 0.118 45),   oklch(84% 0.110 45));
```

Then update the file's header comment: the "Task 12 converts…" note is now
history, so replace it with a line stating that every token is a `light-dark()`
pair and that adding a second block or a media query is a test failure.

- [ ] **Step 2: Run the test and let it drive the values**

Run: `npx vitest run tests/styles/counter-tokens.test.ts`
Expected: some assertions fail. For each failure, adjust the **lightness** of the offending dark token first — chroma and hue carry the design intent, lightness carries the contrast. Re-run after each change. Do not edit the test to make a value pass.

- [ ] **Step 3: Run until green**

Run: `npx vitest run tests/styles/counter-tokens.test.ts`
Expected: PASS, every assertion, both themes.

- [ ] **Step 4: Record what the dark set actually achieved**

```bash
npx vitest run tests/styles/counter-tokens.test.ts --reporter=verbose \
  | tee docs/counter/token-verification.txt
```

This file is the evidence behind "we designed dark ourselves".

- [ ] **Step 5: Run the gate**

```bash
npm test && npx tsc --noEmit && npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/styles/counter.css docs/counter/token-verification.txt
git commit -m "feat(counter): a dark set the prototype never drew, with the numbers to back it"
```

---

### Task 13: Theme resolution, without the flash

Three states: an explicit `light`, an explicit `dark`, and the default `system`. The stamp goes on `<html>` before first paint, or the page flashes the wrong theme.

**Files:**
- Create: `src/components/counter/theme-provider.tsx`
- Create: `src/components/counter/theme-toggle.tsx`
- Create: `tests/app/counter-theme.test.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Produces: `<CounterThemeProvider>` (client), `useCounterTheme(): { theme: Theme; resolved: "light" | "dark"; setTheme(t: Theme): void }`, `<ThemeToggle />`, and `type Theme = "light" | "dark" | "system"`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/app/counter-theme.test.tsx
import { describe, it, expect, beforeEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import { CounterThemeProvider, useCounterTheme } from "@/components/counter/theme-provider"

function Probe() {
  const { theme, resolved, setTheme } = useCounterTheme()
  return (
    <>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolved}</span>
      <button onClick={() => setTheme("dark")}>dark</button>
      <button onClick={() => setTheme("system")}>system</button>
    </>
  )
}

describe("counter theme", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute("data-theme")
  })

  it("defaults to system and stamps nothing", () => {
    render(<CounterThemeProvider><Probe /></CounterThemeProvider>)
    expect(screen.getByTestId("theme").textContent).toBe("system")
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false)
  })

  it("stamps data-theme on an explicit choice and persists it", () => {
    render(<CounterThemeProvider><Probe /></CounterThemeProvider>)
    act(() => { screen.getByText("dark").click() })
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark")
    expect(localStorage.getItem("counter-theme")).toBe("dark")
  })

  it("removes the stamp when returning to system", () => {
    render(<CounterThemeProvider><Probe /></CounterThemeProvider>)
    act(() => { screen.getByText("dark").click() })
    act(() => { screen.getByText("system").click() })
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false)
    expect(localStorage.getItem("counter-theme")).toBe("system")
  })

  it("restores a persisted choice on mount", () => {
    localStorage.setItem("counter-theme", "dark")
    render(<CounterThemeProvider><Probe /></CounterThemeProvider>)
    expect(screen.getByTestId("theme").textContent).toBe("dark")
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark")
  })

  it("survives a storage accessor that throws", () => {
    const original = Storage.prototype.getItem
    Storage.prototype.getItem = () => { throw new Error("blocked") }
    expect(() =>
      render(<CounterThemeProvider><Probe /></CounterThemeProvider>),
    ).not.toThrow()
    Storage.prototype.getItem = original
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/app/counter-theme.test.tsx`
Expected: FAIL — cannot resolve `@/components/counter/theme-provider`.

If `@testing-library/react` is not installed, add it now: `npm install -D @testing-library/react @testing-library/dom`.

- [ ] **Step 3: Write the provider**

```tsx
// src/components/counter/theme-provider.tsx
"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

export type Theme = "light" | "dark" | "system"

const STORAGE_KEY = "counter-theme"

interface ThemeContextValue {
  theme: Theme
  resolved: "light" | "dark"
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/** localStorage throws outright in some embedded contexts, so every access is guarded. */
function readStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === "light" || v === "dark" || v === "system" ? v : "system"
  } catch {
    return "system"
  }
}

function writeStored(t: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, t)
  } catch {
    /* a viewer with site data blocked still gets a working page, just not a remembered one */
  }
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches
}

/**
 * "system" stamps NOTHING, so bare :root and the prefers-color-scheme block in
 * counter.css do the work. An explicit choice stamps data-theme so it wins in
 * both directions.
 */
function applyTheme(t: Theme): void {
  const root = document.documentElement
  if (t === "system") {
    root.removeAttribute("data-theme")
    root.style.colorScheme = ""
  } else {
    root.setAttribute("data-theme", t)
    root.style.colorScheme = t
  }
}

export function CounterThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStored())
  const [systemDark, setSystemDark] = useState<boolean>(() => systemPrefersDark())

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    if (typeof matchMedia !== "function") return
    const mq = matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => setSystemDark(mq.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    writeStored(t)
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolved: theme === "system" ? (systemDark ? "dark" : "light") : theme,
      setTheme,
    }),
    [theme, systemDark, setTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useCounterTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useCounterTheme must be used inside CounterThemeProvider")
  return ctx
}

/**
 * Runs before first paint. Without it an explicit dark choice paints light for
 * one frame on every navigation that reloads the document.
 */
export const themeNoFlashScript = `
try {
  var t = localStorage.getItem("counter-theme");
  if (t === "light" || t === "dark") {
    document.documentElement.setAttribute("data-theme", t);
    document.documentElement.style.colorScheme = t;
  }
} catch (e) {}
`
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/app/counter-theme.test.tsx`
Expected: PASS, all five.

- [ ] **Step 5: Write the toggle**

```tsx
// src/components/counter/theme-toggle.tsx
"use client"

import { Monitor, Moon, Sun } from "lucide-react"
import { useCounterTheme, type Theme } from "./theme-provider"

const OPTIONS: Array<{ value: Theme; label: string; Icon: typeof Sun }> = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
]

export function ThemeToggle() {
  const { theme, setTheme } = useCounterTheme()
  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex rounded-ct-sm border border-ct-line bg-ct-chrome p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          onClick={() => setTheme(value)}
          className={
            theme === value
              ? "rounded-ct-sm bg-ct-surface px-2 py-1 text-ct-ink"
              : "rounded-ct-sm px-2 py-1 text-ct-ink-3 hover:text-ct-ink"
          }
        >
          <Icon size={14} aria-hidden />
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 6: Mount the provider and the no-flash script**

In `src/app/layout.tsx`, wrap the body's children in `<CounterThemeProvider>` and inject the script in `<head>`:

```tsx
import { CounterThemeProvider, themeNoFlashScript } from "@/components/counter/theme-provider"
```

Inside the returned JSX, add to `<head>`:

```tsx
<script dangerouslySetInnerHTML={{ __html: themeNoFlashScript }} />
```

and wrap the body content:

```tsx
<CounterThemeProvider>{children}</CounterThemeProvider>
```

- [ ] **Step 7: Confirm no media query was needed**

Run: `grep -n "prefers-color-scheme\|data-theme" src/styles/counter.css`
Expected: **no hits.** `light-dark()` resolves against `color-scheme`, and the
provider sets `color-scheme` on `<html>` — inline for an explicit choice, and
`light dark` from `:root` for system. So the CSS knows nothing about themes and
there is exactly one declaration per token.

This is the whole reason for `light-dark()`. Reintroducing a media query or a
`[data-theme]` block would duplicate 33 tokens, and
`tests/styles/counter-tokens.test.ts` fails if either appears.

- [ ] **Step 8: Run the gate**

```bash
npm test && npx tsc --noEmit && npm run build
```

Expected: PASS. `tests/styles/counter-tokens.test.ts` still passes — it reads the `[data-theme="dark"]` block, which is unchanged.

- [ ] **Step 9: Commit**

```bash
git add src/components/counter src/app/layout.tsx src/styles/counter.css tests/app/counter-theme.test.tsx package.json package-lock.json
git commit -m "feat(counter): three theme states, and no flash on any of them"
```

---

### Task 14: Bricolage Grotesque

Fraunces stays loaded for now. It is still used by four layouts whose pages have not been rebuilt, and removing it here would break them for no gain; the spec's Phase F sweep removes it once nothing reads it.

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/styles/counter.css`

**Interfaces:**
- Produces: `--font-bricolage` on `<html>`; Tailwind utility `font-ct-display`.

- [ ] **Step 1: Load the face**

In `src/app/layout.tsx`, alongside the existing `DM_Sans` and `JetBrains_Mono` imports:

```tsx
import { Bricolage_Grotesque } from "next/font/google"

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-bricolage",
  display: "swap",
})
```

Add `bricolage.variable` to the `className` on `<html>`, beside the existing font variables.

- [ ] **Step 2: Expose it as a utility**

In the `@theme inline` block of `src/styles/counter.css`:

```css
  --font-ct-display: var(--font-bricolage), "DM Sans", ui-sans-serif, system-ui, sans-serif;
  --font-ct-sans:    var(--font-dm-sans), ui-sans-serif, system-ui, sans-serif;
  --font-ct-mono:    var(--font-jetbrains-mono), ui-monospace, Menlo, monospace;
```

- [ ] **Step 3: Verify it loads and is actually used**

```bash
npm run build
grep -rn "font-ct-display" src | head
```

Expected: the build succeeds. The grep returning nothing is correct at this stage — no Counter page exists yet. The utility must exist before the first one does.

- [ ] **Step 4: Confirm four families are not being shipped to one route**

```bash
npm run bundle:check
```

Expected: within the baselines captured in Task 1. Fraunces and Bricolage coexist only until Phase F; if a route regresses now, record it in `docs/counter/baseline-bundles.txt` with a note rather than raising the budget.

- [ ] **Step 5: Commit**

```bash
git add src/app/layout.tsx src/styles/counter.css
git commit -m "feat(counter): Bricolage Grotesque, for titles and the wordmark only"
```

---

### Task 15: Make the rules unbreakable

Spec §2.3 lists four rules. `CLAUDE.md` currently states five similar rules as prose, and the prose has been violated repeatedly — that is why they are labelled tripwires. This task converts them into a failing build.

Written now, before any Counter page exists, so the first page is born under the gate.

**Files:**
- Create: `scripts/counter-lint.ts`
- Create: `tests/styles/counter-lint.test.ts`
- Create: `tests/styles/fixtures/counter-lint/` (two fixture files)
- Modify: `package.json` (scripts)

**Interfaces:**
- Produces: `lintCounter(roots: string[]): Violation[]` from `scripts/counter-lint.ts`, where `interface Violation { file: string; line: number; rule: string; text: string }`. Also `npm run tokens`.

- [ ] **Step 1: Write the fixtures the linter must judge**

```tsx
// tests/styles/fixtures/counter-lint/bad.tsx
// Every line below violates exactly one rule. The linter must find all five.
import { prisma } from "@/lib/prisma"
import { motion } from "framer-motion"
import { getCogs } from "@/app/actions/cogs-actions"

export function Bad({ section }: { section: { status: string } }) {
  if (section.status === "loading") return null
  return <div className="bg-sky-500" style={{ color: "#1a1613" }} />
}
```

```tsx
// tests/styles/fixtures/counter-lint/good.tsx
// The same component, written the way Counter requires.
import { Section } from "@/components/counter/surface/section"
import { useEntry } from "@/components/counter/motion/use-entry"

export function Good({ section }: { section: unknown }) {
  useEntry()
  return (
    <Section data={section as never}>
      <div className="rounded-ct bg-ct-paper text-ct-ink" />
    </Section>
  )
}
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/styles/counter-lint.test.ts
import { describe, it, expect } from "vitest"
import { join } from "node:path"
import { lintCounter } from "../../scripts/counter-lint"

const FIXTURES = join(process.cwd(), "tests", "styles", "fixtures", "counter-lint")

describe("counter lint", () => {
  const violations = lintCounter([FIXTURES])
  const rules = new Set(violations.map((v) => v.rule))

  it("catches a raw colour literal", () => {
    expect(rules).toContain("no-colour-literal")
  })

  it("catches a Tailwind palette colour", () => {
    expect(rules).toContain("no-tailwind-palette")
  })

  it("catches a page branching on section status", () => {
    expect(rules).toContain("no-status-branch")
  })

  it("catches a direct prisma or server-action import", () => {
    expect(rules).toContain("no-direct-data-import")
  })

  it("catches a direct framer-motion import", () => {
    expect(rules).toContain("no-direct-motion-import")
  })

  it("reports nothing for the compliant fixture", () => {
    expect(violations.filter((v) => v.file.endsWith("good.tsx"))).toEqual([])
  })

  it("reports the real Counter tree clean", () => {
    const real = lintCounter([
      join(process.cwd(), "src", "components", "counter"),
    ])
    expect(real).toEqual([])
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/styles/counter-lint.test.ts`
Expected: FAIL — cannot resolve `../../scripts/counter-lint`.

- [ ] **Step 4: Write the linter**

```ts
// scripts/counter-lint.ts
#!/usr/bin/env tsx
/**
 * The five CLAUDE.md tripwires, as a build failure instead of prose.
 *
 * They were prose for months and were violated repeatedly — which is what a
 * tripwire being hit means. Text-level checks are used deliberately: they cost
 * nothing, need no build, and run on a file the moment it is written.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

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
const STATUS_BRANCH = /\.status\s*(?:===|!==)|\bcase\s+["'](?:ready|stale|loading|failed|empty|not_computed)["']/
const DIRECT_DATA_IMPORT = /from\s+["'](?:@\/lib\/prisma|@\/app\/actions\/[^"']+|@prisma\/client)["']/
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

function walk(dir: string): string[] {
  let out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out = out.concat(walk(full))
    else out.push(full)
  }
  return out
}

export function lintCounter(roots: string[]): Violation[] {
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
      const lines = readFileSync(file, "utf8").split("\n")
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/styles/counter-lint.test.ts`
Expected: PASS, all seven.

- [ ] **Step 6: Wire the script**

In `package.json` `"scripts"`:

```json
"tokens": "tsx scripts/counter-lint.ts",
```

- [ ] **Step 7: Run it against the real tree**

Run: `npm run tokens`
Expected: `Counter rules: clean`.

The legacy `src/app/dashboard/**` is in `ROOTS` and is full of editorial code that violates these rules. If it reports violations there, that is expected and correct — those files are deleted by their rebuild phase. **Do not weaken the rules to accommodate them.** Instead, add the exact legacy paths to a `LEGACY` skip list at the top of `ROOTS` handling, with a comment naming the phase that deletes each, so the list can only shrink.

- [ ] **Step 8: Run the gate**

```bash
npm test && npm run tokens && npx tsc --noEmit && npm run build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add scripts/counter-lint.ts tests/styles/counter-lint.test.ts tests/styles/fixtures package.json
git commit -m "feat(counter): the tripwires become a build failure"
```

---

### Task 16: Rewrite the documents that now describe the wrong system

`DESIGN.md` describes the editorial docket — Fraunces italic, hairline radii, cream hex, `.inv-panel`. Every line of it is now wrong on this branch, and `CLAUDE.md` tripwire 1 actively instructs against Counter's tokens. Leaving them is worse than having no document, because both are loaded into context automatically.

**Files:**
- Modify: `DESIGN.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Rewrite `DESIGN.md` for Counter**

Replace the whole file. Keep the same front-matter shape so any tooling reading it still parses, and take every value from `src/styles/counter.css` rather than retyping it.

```markdown
---
name: Chris Neddy's Restaurant Dashboard
description: Counter — one system across the desk and the phone.
tokens: src/styles/counter.css
prototype: docs/counter/counter-prototype.html
spec: docs/superpowers/specs/2026-08-23-counter-design-system-design.md
---

# Counter

The token values live in [`src/styles/counter.css`](src/styles/counter.css) and
nowhere else. This document says what they mean and when to reach for them; it
does not duplicate them, because a second copy drifts.

## Type

Two tiers, three faces.

| Role | Face | Rule |
|---|---|---|
| Page titles, wordmark | Bricolage Grotesque 600–800 | `font-ct-display`. Nothing else. |
| Every figure | DM Sans 500–600 | `tabular-nums lining-nums`, always |
| Prose | DM Sans 400 | |
| Captions, folios, SKUs, status labels | JetBrains Mono | |

Scale is fixed px, ratio ~1.16: `text-ct-micro` 10 · `text-ct-cap` 11.5 ·
`text-ct-body` 13 · `text-ct-mid` 15 · `text-ct-lg` 18 · `text-ct-xl` 22 ·
`text-ct-hero` 30.

## Colour

Every colour is a `ct-` utility. There are no exceptions and `npm run tokens`
enforces it.

- **Surfaces** stack: `ct-surface` (a panel) sits lighter than `ct-paper` (the
  page), which sits lighter than `ct-chrome` and `ct-sunk`. No pure white, no
  pure black, every neutral tinted warm.
- **Ink** has three weights: `ct-ink`, `ct-ink-2`, `ct-ink-3`.
- **The accent is earned.** `ct-accent` is the proofmark. A hover is not an
  alarm; use `ct-sunk` or `ct-accent-wash` for interaction.
- **State** is `ct-good` / `ct-warn` / `ct-bad` / `ct-signal`, each with a
  `-wash` for its ground.
- **Channel identity** (`ct-ch-house`, `ct-ch-dd`, `ct-ch-ue`, `ct-ch-gh`) is for
  brand marks beside a text label. **Never for data** — as a set those four
  clear only ΔE 8.5.
- **Data bands** are `ct-mx-1…4`, separated by lightness, fixed to the channel
  and never to its rank. **Overshoot causes** are `ct-gp-1…3`.
- Colour the overshoot, not the measure. Only the distance past a reference is
  coloured.

Both themes are asserted, not assumed, by
[`tests/styles/counter-tokens.test.ts`](tests/styles/counter-tokens.test.ts) —
WCAG contrast plus CIEDE2000 separation under normal vision and all three CVD
models. If you change a token, that test is the judge.

## Shape and motion

Radii are `rounded-ct` (8px) and `rounded-ct-sm` (5px). Nothing else.

Motion comes from `src/components/counter/motion/` and never from an import of
`framer-motion` in a page. One orchestrated entry per screen, sections 36ms
apart, done inside 330ms. Charts draw once. Figures count up over 480ms.
Everything off under `prefers-reduced-motion`.

## The rules, and where they are enforced

Run `npm run tokens`. It fails the build on:

1. `no-colour-literal` — a hex, `oklch()`, `rgb()` or `hsl()` outside `counter.css`
2. `no-tailwind-palette` — `bg-sky-500` and every sibling
3. `no-status-branch` — a page inspecting `SectionData.status`; that belongs to `surface/`
4. `no-direct-data-import` — a page importing Prisma or a server action; pages call adapters
5. `no-direct-motion-import` — a page importing `framer-motion`

A sixth rule is enforced by review because it needs judgment: **a figure shown
on two pages comes from one function in `src/lib/counter/`.** Prime cost read
56.2% on Overview and 57.9% on the P&L for the same range, because one counted
hourly wages and the other hourly cost. `src/lib/counter/prime-cost.ts` exists
so that cannot happen twice.
```

- [ ] **Step 2: Replace the tripwires in `CLAUDE.md`**

Replace the section headed "The five tripwires Claude keeps hitting" and the
paragraph above it with:

```markdown
## Before touching any dashboard or mobile UI, read this

**Read [`DESIGN.md`](DESIGN.md).** This branch runs on **Counter** — Bricolage
titles, DM Sans tabular figures, oklch `ct-` tokens, 8px radii, light and dark.
The old editorial docket (Fraunces italic, cream hex, hairline radii,
`.inv-panel`) is being deleted page by page. Generic Tailwind or shadcn output
is wrong and so is editorial output.

**The rules are a build failure, not a suggestion. Run `npm run tokens`.**
It enforces: no colour literals, no Tailwind palette colours, no page branching
on `SectionData.status`, no page importing Prisma or a server action, no page
importing `framer-motion`. The reasoning for each is in `DESIGN.md`.

Two things the linter cannot check:

- **A figure shown on two pages comes from one function in `src/lib/counter/`.**
- **Don't split or restructure files >400 lines** without reading
  [`docs/refactor-playbook.md`](docs/refactor-playbook.md).
```

- [ ] **Step 3: Confirm nothing still points at the deleted guidance**

```bash
grep -rn "inv-panel\|inv-row\|order-row\|editorial docket\|Fraunces" CLAUDE.md DESIGN.md
```

Expected: no hits in either file. Hits elsewhere in the repo are fine — that code still exists until its rebuild phase.

- [ ] **Step 4: Run the full gate**

```bash
npm run drift && npm test && npm run tokens && npx tsc --noEmit && npm run build && npm run bundle:check
```

Expected: PASS, all six.

- [ ] **Step 5: Commit**

```bash
git add DESIGN.md CLAUDE.md
git commit -m "docs(counter): the documents describe the system that exists"
```

---

## Done when

- `npm outdated` shows nothing behind except rows recorded in `docs/counter/deferred-upgrades.md`
- `npm audit --omit=dev` reports no critical and no high
- `docs/counter/recharts-3-spike.md` carries a verdict, so the next plan's `<Chart>` task is unblocked
- `src/styles/counter.css` is the only file in the repo declaring a Counter colour
- `npx vitest run tests/styles/counter-tokens.test.ts` passes for **both** themes
- `npm run tokens` prints `Counter rules: clean`
- Toggling the theme changes the page with no flash on reload
- `DESIGN.md` and `CLAUDE.md` describe Counter

## Next plan

Plan 2 — Phase 1: `src/lib/counter/*` (`section-data`, `date-range`,
`prime-cost`, `channels`, `format`) and every primitive under
`src/components/counter/`, both surfaces, with no pages. Its `<Chart>` task
consumes the verdict from Task 3.
