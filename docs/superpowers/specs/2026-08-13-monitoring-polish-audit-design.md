# Monitoring Polish Audit — Design

**Date:** 2026-08-13
**Status:** Draft — scoped, not yet approved for implementation
**Scope:** Project 2 of 2. Project 1 (owner engagement tracking) shipped to main
on 2026-08-13; see `2026-08-13-owner-engagement-tracking-design.md`.

---

## Problem

The developer monitoring section is eight tabs and ~63 files that grew one panel
at a time. Each panel is individually reasonable; the surface as a whole is not
consistent, and Project 1 surfaced evidence that inconsistency there is not only
cosmetic — it hides real defects.

The concrete finding: four panels formatted timestamps with server-local getters
under a masthead that reads "PT". On Vercel's UTC runtime they displayed the
wrong day for evening activity, and because they are server components there was
no hydration warning to betray it. That was fixed in `6cc0c72`, but it was found
by a code reviewer chasing an unrelated question, not by anything systematic.
The audit's job is to find the rest of that class.

## Non-goals

- Redesigning the editorial system. `DESIGN.md` stands; this conforms to it.
- Adding features or new panels.
- Restructuring the tab taxonomy.
- Component test infrastructure. The project is node-only vitest by choice
  (no jsdom, no React Testing Library) and that stays true here — anything
  worth asserting gets extracted to a pure function, as `stepTracker` and
  `groupIntoSessions` were.

## Success criteria

1. Every timestamp, date, and day bucket across all eight tabs renders in
   Pacific, verified by a grep that finds zero local-getter date formatting
   outside `src/components/monitoring/time-format.ts`.
2. A reader can move between tabs without re-learning the layout: panel
   headers, empty states, number formatting, and row hover all follow one
   pattern.
3. No generic Tailwind color utility survives on any monitoring route.
4. Every panel renders correctly against empty data, and that is checked
   rather than assumed.

---

## Method

The audit runs per tab, not per concern — a tab is the unit a human actually
looks at, and cross-tab consistency is judged by comparing finished tabs.

**Per tab, in order:** Bridge, Activity, People, Infra, Costs, ML, Ingredients,
Cache.

For each:

1. **Correctness sweep first.** Date/time handling, number formatting, null and
   empty handling, and any arithmetic that could divide by zero or render `NaN`
   into a style value. Correctness defects found here are fixed immediately and
   separately from polish — they are not "polish".
2. **Consistency pass.** Compare against the reference idiom in
   `src/components/monitoring/people/login-history-table.tsx`: `.inv-panel`
   section, `RegisterMark` + italic Fraunces title, mono count on the right,
   italic Fraunces empty state. Numbers in `number` (DM Sans 600, tabular),
   captions and paths in `monoLabel`, prose in `fraunces17`.
3. **Density and hierarchy.** What is the tab's one question? The panel that
   answers it goes first and largest. Everything else is supporting.
4. **Tripwire scan.** Grep the tab's files for generic Tailwind color
   utilities and shadcn `<Card>`.

## Known work already identified

- **Timezone class, mostly fixed.** `6cc0c72` moved four panels plus
  `sessions-table` onto `src/components/monitoring/time-format.ts`. The audit
  should confirm nothing outside `src/components/monitoring/**` renders a
  monitoring timestamp, and extend the shared module rather than reintroducing
  local formatters.
- **Bridge index has no error boundary.** `getEngagementHeadline()` sits
  unguarded in a `Promise.all` alongside four other queries; any one of them
  throwing 500s the whole page. This was correct to leave during Project 1 (a
  broken deploy should be visible) but a monitoring index that dies when one
  metric is unavailable is the wrong trade for a page whose purpose is telling
  you what is broken. Decide deliberately: per-panel error boundaries, or
  keep the fail-loud behaviour.
- **`sessions-table` disclosure is incomplete.** The expand button has
  `aria-expanded` but no `aria-controls`/`id` pairing with the list it reveals.
- **Unreachable empty state.** When `summary` is empty the People page never
  mounts `SessionsTable`, so its empty-state copy cannot render. Either delete
  the dead branch or mount the panel.
- **`getEngagementHeadline` scoping.** It takes the globally-latest page view
  under a tile titled "Owner activity". Correct with one operational store and
  one non-developer account; wrong the day that changes.
- **Sort conventions in `engagement.ts`** differ across its four returned
  collections with no comment saying each is presentation-driven.

## Risks

- **The surface is large and the temptation is to touch everything.** Each tab
  should land as its own reviewable commit; a single sweeping refactor across 63
  files is not reviewable and will hide a defect.
- **Polish work rarely has tests.** The correctness sweep in step 1 is what
  gives this project teeth; if a tab's audit produces only styling changes,
  that is a signal the sweep was shallow, not that the tab was clean.

## Open questions for the human

1. Is the Bridge index's fail-loud behaviour intended, or should each panel
   degrade independently?
2. Is eight tabs still the right taxonomy, or has a tab earned merging or
   splitting since it was drawn?
