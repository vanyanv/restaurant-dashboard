# Counter — streaming architecture, and why the rebuild regressed

**Status:** APPROVED 2026-08-26 — binding for every Counter page, built and unbuilt
**Date:** 2026-08-26
**Applies to:** every Counter route, built and unbuilt (3 of 54 exist today)

---

## The decision this records

Approved by the owner on 2026-08-26, in these terms: *every page should be like
this so the whole app is extremely snappy and responsive, different data is
isolated for components so they don't block each other, and everything is
smooth.*

Three things follow, and they are requirements rather than aspirations:

1. **Universal, not selective.** This is the pattern for all 54 Counter pages.
   A page that does not stream is a defect, not a variation — which is why the
   enforcement in Task 2b of the plan is part of the work and not a follow-up.
2. **Per-component data isolation is the primary goal**, not a bonus on top of
   faster navigation. A section waiting on another section's query is the
   specific thing being removed. Section-level Suspense (Task 3) is therefore
   the load-bearing task in the plan; Tasks 1, 2 and 5 make it useful.
3. **Snappy is measurable or it is a claim.** Task 7 measures before and after,
   and reverts what does not help.

---

## The problem, measured

|  | `loading.tsx` | files using `Suspense` | shell in a layout |
|---|---|---|---|
| editorial (the system being replaced) | 12 | 17 | yes |
| **counter (the replacement)** | **0** | **0** | **no** |

Five defects, all introduced by the rebuild:

1. **The chrome remounts on every navigation.** `AppShell` — rail, topbar,
   store switcher, ask surface — is rendered inside each page's client
   component (4 mount sites, all pages; 0 layouts). A layout persists across
   sibling navigation in the App Router; a page does not. Navigation is
   genuinely client-side (`Rail` uses `next/link`, verified), so this is not a
   browser reload — React simply destroys and rebuilds the entire tree, which
   is indistinguishable from one to a reader.

2. **No loading boundary on any Counter route.** With neither `loading.tsx` nor
   a Suspense boundary, a click blocks on the server until every query in the
   page resolves, then swaps. The outgoing page stays frozen for the duration.

3. **No component isolation.** Each page awaits all sections and hands one
   finished object to one client component, so the strip cannot paint while the
   chart is still resolving.

4. **`SectionData.loading` is unreachable.** The union defines it and `Section`
   renders `Skeleton` for it, but `loading()` is produced in **zero** places
   outside its own definition. A six-state model was designed for this exact
   problem and the fetching pattern makes one state impossible.

5. **Sequential waterfalls.** `await getOverviewStores()` then
   `await getXSections(...)` — independent, run one after the other, on all
   three pages.

Already in place and not the problem: `reactCompiler: true`, Next 16.3.2,
React 19.2.8, `optimizePackageImports` across the heavy libraries. `ppr` and
`cacheComponents` are both available and neither is enabled. There is no
`template.tsx` anywhere (which would have forced remounts independently).

---

## Why this is urgent rather than a cleanup

Three Counter pages exist. Fifty-one remain. The pattern is copied page to page
by design — the plans say so explicitly, and each new page is written against
the last one as its model. Changing the pattern now costs three pages of
rework. Changing it after the rebuild costs fifty-three.

---

## Design

### A. Split the shell: persistent chrome to the layout, page head to the page

`src/app/dashboard/layout.tsx` becomes the mount site for the rail, the topbar,
the store switcher and the ask surface. `src/app/(mobile)/m/layout.tsx` does the
same for the phone.

**This works because the chrome is already URL-driven, not page-state-driven.**
The date control and the store switcher both write through `writeCounterParams`
and read through `readCounterParams` — they are `useSearchParams()` consumers
wearing callback props. Hoisted into the layout they read the URL directly and
push their own changes, and the `onSelectPreset` / `onSelectStore` prop drilling
disappears rather than moving.

`pathname` is currently passed to `AppShell` as a prop from each page. In the
layout it becomes `usePathname()` in a small client boundary — which is what the
`Rail` already does internally for its active state.

`PageHead` is already a separate component and stays with the page: the title
sentence, the sub-line and the page's own actions are genuinely page-specific.

**Interface change:** `AppShell` splits into `AppShell` (layout-level:
rail, topbar, store switcher, ask) and the existing `PageHead` (page-level).
Pages stop passing `stores`, `user`, `sync`, `today`, `presetId`,
`onSelectPreset`, `onSelectStore`, `askSuggestions`, `onAsk`, `pathname`.

### B. A loading boundary per Counter route

With the chrome in the layout, `loading.tsx` covers only the content area —
which is exactly right. The rail stays put, the content shows skeletons, and the
navigation is instant.

### C. Suspense per section, and a coherent story for "loading"

Pages stop awaiting the whole adapter. Each section resolves inside its own
Suspense boundary so the strip paints while the chart is still in flight.

Two mechanisms would otherwise compete to express "not here yet", so they are
assigned distinct jobs:

| state | means | produced by |
|---|---|---|
| Suspense fallback | first paint, nothing to show yet | the boundary |
| `stale` | a refetch is in flight and previous data is on screen | a client transition with prior data |
| `loading` | a refetch is in flight with nothing to show | a client transition with no prior data |

That makes the `loading` arm reachable for the first time and gives `stale` the
job it was designed for. **`SectionData` is not reduced** — the six states stay,
and `Section` remains the sole renderer.

### D. `Promise.all` for independent fetches

Mechanical, and it stops mattering much once C lands, but it is wrong as it
stands and it is three lines a page.

### E. Prefetch and pending feedback

- Rail links prefetch, so hovering the rail warms the destination.
- Next 16's `useLinkStatus` gives the clicked rail item a pending state, which
  is the difference between "instant" and "instant and legible".

### F. PPR / `cacheComponents` — proposed, gated on measurement

Both are available on 16.3.2. The static shell prerenders and the dynamic holes
stream, which is the strongest version of what this document is about. It is
also experimental and interacts with dynamic APIs in ways that need measuring
rather than assuming. **Enable on Counter routes only, behind a measurement,
after A-E land.** Not a prerequisite for any of them.

---

## The risk this carries, stated plainly

**The fidelity gate measures a landmark sequence and it currently passes on four
surfaces.** Two things could move it:

1. **Composition drift.** Moving the shell from page to layout must produce a
   byte-identical DOM. If it does not, the gate reds — which is the gate doing
   its job, and the reason this change is safe to attempt at all.
2. **Playwright capturing a Suspense fallback mid-stream.** A screenshot taken
   before the boundaries resolve would compare a skeleton against the
   prototype's finished page. The harness needs an explicit settle condition,
   and adding one must not become a way to paper over a genuinely slow page.

Both are checked by running `npm run fidelity` at every step, not at the end.

**Second risk:** `Section` is currently a server-safe component rendering
resolved data. Pushing sections behind Suspense with `use()` moves some of them
to client boundaries. The rule *no page branching on a `SectionData` status*
(enforced by `npm run tokens`) must survive that move — if the refactor makes
pages read `.status` to decide what to suspend, the change has failed.

---

## What this explicitly does not do

- It does not touch the adapters' figures. No money moves.
- It does not reduce `SectionData`.
- It does not restyle anything. Every landmark, class and token is unchanged.
- It does not migrate the ~19 remaining editorial pages, which already stream
  and are being deleted page by page regardless.
