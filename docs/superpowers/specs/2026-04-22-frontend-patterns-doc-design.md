# Frontend Patterns Reference Doc — Design Spec

**Date:** 2026-04-22
**Author:** Chris (with Claude)
**Status:** approved, pending implementation

---

## Context

The dashboard has an elaborate "editorial" design system — warm cream paper, Fraunces serif, JetBrains Mono tabular numerals, red accent proofmarks, hairline frames, `.order-row`-style hover accent bars. All of it lives in `src/app/dashboard/editorial.css` (~3,900 lines) with no map.

When a Claude session is asked to build or redesign a dashboard page, it consistently falls off the system in the same ways:

- Reaches for generic Tailwind colors (sky / emerald / violet / amber) instead of the ink/paper/hairline/accent tokens
- Uses shadcn `<Card className="rounded-xl shadow-sm">` for page sections instead of the `.inv-panel` hairline-frame pattern
- Gives list rows a weak `hover:bg-muted/50` state instead of the red `scaleY` accent-bar hover that the rest of the dashboard uses
- Puts comparison-grade numbers (KPIs, row totals) on italic display serif, making digits hard to scan
- Hides filters in dropdowns instead of using the visible chip-strip pattern

We lived through two rounds of the invoices redesign before the editorial theme was actually applied, because Claude had no reference to check against. This project creates that reference.

**Intended outcome:** a fresh Claude session opens the repo, automatically reads `CLAUDE.md`, is immediately directed to `docs/frontend-patterns.md` before touching any dashboard UI, and produces on-brand output on the first pass.

## Non-Goals

- **Not** a complete frontend playbook. Data fetching, React Query, shadcn-primitive wiring, chart internals — all out of scope. (Option C in brainstorming; rejected.)
- **Not** documentation for `/manager/*` or `/login/*` routes. The editorial theme is `/dashboard/*` only.
- **Not** a human-facing onboarding doc. It's optimized for Claude consumption; humans reading it is a bonus, not a requirement.
- **Not** a refactor of `editorial.css`. The doc describes what exists; it does not reorganize it.

---

## Scope — Two Files

### File 1: `CLAUDE.md` (project root)

A thin "doorbell" file, ~20–25 lines, auto-loaded by Claude Code at session start.

**Contents:**

- One-sentence project identity (Next.js 15 App Router, multi-store restaurant analytics dashboard)
- A loud directive: **"Before styling or composing any `/dashboard/**` page, read `docs/frontend-patterns.md`."**
- 3–4 tripwire rules inlined — the ones most frequently broken:
  - No generic Tailwind colors on `/dashboard/*` — use editorial tokens (`--ink`, `--accent`, `--paper`, etc.)
  - Fraunces is for prose and display. Numbers (KPIs, row totals, chart tooltips) use DM Sans with `tabular-nums lining-nums`.
  - Every interactive list row uses the `.inv-row` / `.order-row` hover pattern (red `scaleY` accent bar + total turns red).
  - Page sections are `.inv-panel` (hairline-frame paper), not shadcn `<Card>`.
- Pointer to `docs/architecture-cheat-sheet.md` for backend/architecture context
- Nothing else. No token tables, no component library. Just the doorbell.

### File 2: `docs/frontend-patterns.md`

The long-form reference. Top-weighted: the first ~300 words give 80% of the value; the rest is lookup. Sits next to the existing `docs/architecture-cheat-sheet.md`.

**Structure:**

1. **§ 1 — Rules that matter** (~15 bullets, above-the-fold)
   The non-negotiables, compressed. Editorial tokens only on `/dashboard`. Two-tier typography. `.inv-row` hover pattern. Hairline-frame panels over shadcn cards. URL-as-filter-state (filters live in `searchParams`). Fraunces for prose, DM Sans tabular for numbers, JetBrains Mono for captions.

2. **§ 2 — Design tokens**
   Full CSS variable table from `editorial-surface`. Hex values + one-line "use when." Includes `--ink`, `--ink-muted`, `--ink-faint`, `--paper`, `--paper-deep`, `--hairline`, `--hairline-bold`, `--accent`, `--accent-dark`, `--accent-bg`, `--subtract`, and the platform colors.

3. **§ 3 — Typography (two-tier rule)**
   Fraunces italic for prose/display. DM Sans 500–600 with `font-variant-numeric: tabular-nums lining-nums` and `font-feature-settings: "tnum", "lnum"` for all numbers. JetBrains Mono for captions/folios/SKUs/status labels. Copy-paste-ready font declarations.

4. **§ 4 — Component patterns**
   Each pattern gets: what it is, when to use, class name, minimal code snippet.
   - `EditorialTopbar` (section + title + stamps + action children)
   - `.order-row` / `.inv-row` — interactive hover row with red `scaleY` accent bar + total color-shift on hover
   - `.inv-panel` — paper-framed container, replaces shadcn `<Card>` for dashboard sections
   - `.platform-stamp` / `.inv-stamp` — tilted proofmark badges with `currentColor` borders
   - `.toolbar-btn` / `.inv-period__pill` — hairline-outlined buttons, red when active
   - `.search-shell` / `.inv-toolbar__search` — hairline-bold input, italic Fraunces placeholder
   - `.inv-kpis` — 4-column hairline-divided ledger strip with mono folio + italic/sans value + caption sub
   - `.perforation`, `.hairline`, `.live-dot`, `.kbd-chip`

5. **§ 5 — Page composition template**
   The skeleton every dashboard page follows, with concrete file/folder names:
   ```
   page.tsx                                    (server: auth + parse searchParams)
     → components/<feature>-shell.tsx          (server: layout + EditorialTopbar)
       → <Suspense><SectionErrorBoundary>      (one per section, with Skeleton fallback)
         → components/sections/<name>-section.tsx  (server: fetches data via cached fetcher)
           → components/<name>-client.tsx      (client: URL-driven filters, router.replace)
     → components/sections/data.ts             (React.cache fetchers + parseFilters helper)
   ```
   Plus the URL-as-state rule: filters live in `searchParams`; client components merge new values via `new URLSearchParams(searchParams?.toString())` and `router.replace(qs, { scroll: false })`.

6. **§ 6 — Anti-patterns** (DO / DON'T table)
   The ~8–10 most common misses, side-by-side. Examples:
   - ❌ `bg-sky-500/10 text-emerald-700` → ✅ `bg-(--accent-bg) text-(--accent-dark)`
   - ❌ `<Card className="rounded-xl shadow-sm">` → ✅ `<section className="inv-panel">`
   - ❌ `hover:bg-muted/50` on list rows → ✅ `.inv-row` with red `scaleY` accent bar + total hover color
   - ❌ Italic Fraunces at 34px for KPI value → ✅ DM Sans 500 at 28px with `tabular-nums lining-nums`
   - ❌ Status filter in a `<Select>` dropdown → ✅ visible chip strip (`.inv-status-chip`)
   - ❌ `rounded-xl`, `shadow-sm` → ✅ `border-radius: 2px`, hairline-bold border, no shadow (or the paper shadow `0 10px 30px -12px rgba(26,22,19,0.18)` for popovers)
   - ❌ Local `useState` for filters → ✅ URL searchParams
   - ❌ Button inner text in sentence case → ✅ `font-label` DM Sans caps with 0.12–0.18em tracking for caption/toolbar text

7. **§ 7 — When NOT to use the editorial theme** (~5 lines)
   `/login` and `/manager/*` have their own visual languages. shadcn primitive internals (Dialog portal content, Popover inner chrome) should be customized via class prop, not wrapped. Chart tooltips use inline `style={{ ... }}` with `var(--token)` strings (recharts doesn't reliably pick up className).

8. **§ 8 — Adding new patterns**
   If you invent a new visual component while building a page:
   1. Add CSS to `src/app/dashboard/editorial.css` under a `§ <section>` comment block (follow the existing `§ 02 INVOICES` convention)
   2. Document the class and its intended use in this file under § 4

---

## File Layout

```
restaurant-dashboard/
├── CLAUDE.md                              ← NEW (thin doorbell)
└── docs/
    ├── architecture-cheat-sheet.md        (existing — backend)
    ├── architecture-interview-guide.md    (existing — backend)
    └── frontend-patterns.md               ← NEW (long-form reference)
```

No changes to `editorial.css` or any component code.

---

## Verification

- `CLAUDE.md` loads at session start (test: start a fresh Claude Code session in the repo, verify the doorbell text appears in context).
- Following the `CLAUDE.md` pointer lands on `docs/frontend-patterns.md`.
- Every CSS class named in the doc can be `grep`-confirmed in `src/app/dashboard/editorial.css`.
- Every token listed in § 2 matches the actual value in `editorial.css` line 4–15 (`.editorial-surface` custom properties).
- File-path references in § 5 match the actual structure of `src/app/dashboard/invoices/` (the template was extracted from there).
- End-to-end dry run: ask a new Claude session "build a simple orders-summary dashboard page with filters and a list," check that the output uses `.inv-panel`, the `.inv-row` hover pattern, DM Sans tabular numbers, and URL-driven filters. If it doesn't, the doc needs stronger tripwires.

---

## Out of Scope (explicit)

- Refactoring `editorial.css` into smaller files (attractive but unrelated)
- Migrating existing shadcn `<Card>` usages to `.inv-panel` (separate cleanup task; this doc prevents *new* violations)
- Documentation for backend, data fetching, charts, or shadcn components beyond a brief mention
- Onboarding docs for human developers (the doc is readable by humans but not tuned for them)
