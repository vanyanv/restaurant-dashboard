---
name: counter-page
description: MANDATORY before building, rebuilding or mocking any dashboard or phone page (src/app/dashboard/**, src/app/(mobile)/m/**), including "Made Plain" rebuilds and new tabs or sections. Page layout checklist so pages don't become long scrolls.
---

# Building a Counter page

This is the checklist form of DESIGN.md "Page layout". Read that section
once; then work through this list for the mock, again for the build, and
paste the last block into the PR body.

The mistake this exists to stop: a page built as one long stack. On
2026-11-20 the Labor rebuild shipped as one long scroll on desk and phone,
and ~40 other pages had the same shape (a short plain top, then an
"Every figure, as before" fold holding the whole old page).

## Plan the page before writing code

1. Write down the page's one question ("How much did we keep this week?").
2. List every block the page will show. Put the answer and up to four
   blocks on the first tab. Group everything else into at most five tabs
   with one- or two-word names. If a group has no name an owner would tap,
   delete it rather than fold it.
3. For each list: what are the top 5–8 rows, and where does "Show all"
   go?
4. Phone: the same tabs in the same order, rows as stacked cards. Will
   every tab label fit at 360 px?

Show this plan in the mock (desk and phone, both tabs visible) before
building. The owner reviews mocks before builds.

## Build

- Head in this order: `Answer` (one sentence), `BigNumber` with vs last
  period, `Freshness`, status in words. Missing input = labelled
  ("Waiting on Harri"), never $0 or 0.0 h.
- Tabs: shared `Tabs` from `@/components/counter/ui`, as links with
  `?tab=` so reload, back and shared links keep the tab.
- `Fold` only for one secondary thing ("How this is worked out", the full
  statement). Never "Every figure, as before".
- `NeedsYou` collapsed, at most three groups, one fix button each.
- Lists capped with "Show all N".
- No model/table names, build notes or mono paragraphs in the UI.
- Shared blocks, `useAct`/`useLeaving` for presses (DESIGN.md Motion).
- Loading (DESIGN.md "Page layout" rule 9): every streamed block is a
  `Section`, never your own `<Suspense>`; `next/dynamic` loading is
  `<LoadingBlock />`, never `null`; the route's `loading.tsx` lists the first
  tab's sections in the same order; a late line keeps its height empty.

## Check

- `npm run tokens`. `page-too-long` and `fold-holds-a-page` fail the build.
  Never add a file to `KNOWN` in `scripts/page-layout-lint.ts` to get
  green. If you fixed a listed page, delete its line (the check tells you
  with `page-layout-known-stale`).
- `no-raw-suspense` and `no-empty-dynamic-loading` fail the build if a
  page can pop in or jump while it loads.
- The linter can't see lists without a cap, a page that hides its length in
  child components, or a phone tab that is 5 screens long. Check those by
  eye at 390 px and 1440 px.
- `npm run fidelity -- --grep <pageId>` per CLAUDE.md, if a database is
  available.

## PR body block

```
Page layout (DESIGN.md "Page layout")
- Question: …
- Tabs: Summary (answer + N blocks) · … · …
- Lists capped: … (top N, Show all)
- Folds: … (one thing each)
- Phone: same tabs; longest tab ≈ … px at 390 wide / not measured
```
