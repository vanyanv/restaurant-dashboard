# Shell verification: `AppShell` seen in a real browser

Task 5 of Plan 4. Every defect that mattered in Plans 2–4 was invisible to
the test suite — the 12 markup-assertion tests `AppShell`/`Rail`/`EntryItem`
already have prove structure, not appearance. This file is the missing
evidence: a real Chromium session, signed in with the `.env.test.local`
credentials, driving a throwaway harness
(`src/app/counter-shell-harness/page.tsx`) that rendered `AppShell` at
`pathname="/dashboard/invoices/INV-2842"` — a detail route one level below
a real rail destination — wrapping five `EntryItem`-wrapped `Section`s built
from plausible restaurant numbers: a KPI `Strip`, a `Chart` line (7-day
sales trend), a `Chart` bar with a negative reading (COGS variance), and two
`Table`s (recent invoices, labor by role). The harness was deleted
immediately after this session — see the `git diff` in this task's commit,
which shows no trace of it.

Method: `npm run dev` on `http://localhost:3000`, Playwright driving real
Chromium at a 1440×900 viewport (desktop; 900px tall is the brief's "normal
viewport height" test). Theme was set the way a real user takes it —
`localStorage.setItem("counter-theme", …)` followed by a reload, not a
stubbed provider. Screenshots were written to a scratch directory outside
the repo and are not committed, matching this plan's harness-is-throwaway
policy; paths are recorded below for reference within this session.

## Screenshots

- `shell-light.png` / `shell-dark.png` — viewport (1440×900), scrolled to top
- `shell-light-full.png` / `shell-dark-full.png` — full page
- `shell-light-scrolled.png` / `shell-dark-scrolled.png` — scrolled to the
  bottom of the page
- `shell-dark-border-zoom.png` — a 100×120px crop straddling the rail/page
  boundary in dark, at the point the rail column meets the first `Section`

(all under the session's scratch directory, deleted with the rest of the
session's temp files — not part of this commit)

## Do the five groups read as five groups?

Yes, clearly. Each `NavGroup` caption ("TODAY", "MONEY", "MENU", "STOCK AND
SUPPLIERS", "ADMIN") renders in uppercase JetBrains Mono at `ct-micro` size
with its own `pt-2`/`pb-1` padding, and the five `role="group"` blocks sit in
a `gap-3` column. At a glance the rail reads as five short clusters with
air between them, not a flat run of seventeen rows — the caption plus the
gap is doing real work, not just an accessibility label.

## Is the active destination obvious without reading it?

Yes. With `pathname="/dashboard/invoices/INV-2842"`, "Invoices" gets
`bg-ct-accent-wash` + `text-ct-accent-hi` — a warm red-tinted wash the eye
catches before the label registers, in both themes (confirmed in
`shell-light.png` / `shell-dark.png`). `aria-current="page"` and the visual
wash both landed on the same element (`aria-current` query returned exactly
`["Invoices"]`, never the detail page's own non-existent rail row), which is
`isActive`'s prefix-match doing its job (note 48) — a child route of a
destination still lights the parent, and there's no separate code path that
could disagree with the colour about which one it is.

## Does the wordmark carry the palette (note 15)?

Yes, on this evidence. "Chris N Eddy's" in red Bricolage sits alone at the
top of the rail column — the only Bricolage outside a page title — and the
same hue reappears exactly twice more on the same screen: the active nav
wash and the "Ask about this" hover. Three uses of one red, the wordmark
first, reads as one brand colour rather than three unrelated accents. Minor
caveat, not a defect: that red is now doing three jobs at once (brand
identity, "you are here", and generic interactive hover) — with real content
below the fold it's worth watching whether "ask about this" hover ever
appears in the same glance as the active rail item and dilutes which one is
the brand.

## Does the rail fit in one glance at 900px, per note 24?

Partially — and the qualifier is a real finding, not a nitpick. Scrolled to
the top, yes: all seventeen items plus five captions render between y≈13 and
y≈838 of the 900px viewport in `shell-light.png` / `shell-dark.png` — no
internal scrollbar, everything readable without scrolling. `nav.scrollHeight
=== nav.clientHeight` (1388px, confirmed via `getBoundingClientRect`), so
the rail itself never needs to scroll internally.

But the rail is not `position: sticky` or fixed, and its column div carries
`h-full` inside a parent that's only `min-h-dvh` (a minimum, not a cap). On
this harness's five real sections the page's total scroll height is 1435px
against a 900px viewport, so the *whole page* scrolls — rail included.
Comparing `shell-dark.png` (top) to `shell-dark-scrolled.png` (bottom): the
"Today", "Money" and "Menu" groups that were visible on load have scrolled
out of the top of the viewport by the time "Labor by role" (the fifth
section) is in view, leaving only "Stock and suppliers" and "Admin" on
screen. Seventeen fits in one glance on a page short enough to need no
scrolling at all — which nothing with five real sections and a table of any
size will be. This isn't what note 24 claimed (that seventeen destinations,
not thirty-two, fit the rail without scrolling the rail) — that part holds
— but a reader will reasonably expect persistent navigation from a rail this
information-dense, and today it scrolls away like part of the page.

## In dark, does the rail column separate from the page?

Yes — but not for the reason the design intends, and the real mechanism is
a bug worth fixing before Plan 5. `--ct-chrome` (dark) is `oklch(16.5% …)`
and `--ct-paper` (dark) is `oklch(19% …)` — 2.5 points of L apart, tight, in
line with the risk a reviewer flagged about the dark surface stack. On
background colour alone this would be a subtle boundary. What actually
separates the two in `shell-dark.png` is the 1px `border-r border-ct-line`
on the rail column — and it is not rendering the `--ct-line` token at all.

**Finding: `border-ct-line` does not resolve to `--ct-line` anywhere it was
checked.** Measured via `getComputedStyle` on three separate elements
(the rail column's `border-right-color`, a `Section` panel's `border-color`,
and a `Table` row's `border-bottom-color`), in both themes:

| Element | Expected (`--ct-line`) | Actual (both themes) |
|---|---|---|
| Rail column `border-right-color` | `oklch(89.5% .009 58)` light / `oklch(28% .009 58)` dark | `rgb(229, 231, 235)` |
| `Section` panel `border-color` | same | `rgb(229, 231, 235)` |
| `Table` row `border-bottom-color` | same | `rgb(229, 231, 235)` |

`rgb(229, 231, 235)` is not a rendering of either `--ct-line` value — it's
cool/blue-leaning (B > G > R), where `--ct-line` is deliberately warm
(R ≥ G ≥ B, hue 58). It's Tailwind v4's own preflight fallback
(`border-color: var(--color-gray-200, currentColor)`), and it is **identical
in light and dark** — impossible for a real `light-dark()` token where the
two values are 61.5 points of L apart. Every hairline this session measured
is rendering that fallback, not the design's border colour, in every
`Section`, every `Table` row, and the rail's own separator — `bg-ct-*` and
`text-ct-*` utilities on the same elements resolve correctly (confirmed
separately: `Rail`'s `bg-ct-chrome` and the active item's `text-ct-accent-hi`
both differ correctly by theme), so this is specific to `border-{ct-color}`
utilities, not the token layer generally.

Net effect on the specific question asked: in dark, the rail visibly
separates from the page (`shell-dark-border-zoom.png` shows an unmistakably
bright line at the boundary) — but it's brighter and more prominent than
the design intends, not tighter. The intended `--ct-line` dark value
(28% L) is still lighter than both surfaces either side of it (16.5% and
19%), so once this is fixed the boundary should still read, just far more
quietly than what's on screen today. This should be fixed — and every
other `border-ct-*` callsite re-checked — before Plan 5 adds more surfaces
that lean on the same token.

## Anything else that looked wrong

- The bug above is systemic, not shell-specific — it affects `Section` and
  `Table`, which this task didn't touch. Flagging it here because the shell
  was the first place any of these primitives was ever rendered together
  in a real browser, at real content size, where it became visible.
- Dev-server-side, four theme/motion passes each logged
  `⨯ Error: The destination stream closed early` in the `npm run dev`
  terminal. This tracks with the driver script issuing a fresh
  `page.goto`/`page.reload` before the previous response had fully
  streamed, not a defect in the shell — no equivalent ever appeared in the
  **browser** console (see below), which is what the brief asks about.

## Entry motion (Step 2)

Measured via inline `style.animationName` / `style.animationDelay` /
`style.animationDuration` on each `[data-entry-item]`, immediately after
navigation and again after a settle period — this is the same real-DOM
method `docs/counter/motion-verification.md` used, now against the shell's
actual five sections instead of a hook-only harness.

**`reducedMotion: "no-preference"`** — all 5 `EntryItem`s got `ct-entry`
with the exact stagger `useEntry` documents:

| Index | `animation-delay` | `animation-duration` |
|---|---|---|
| 0 | `0ms` | `220ms` |
| 1 | `36ms` | `220ms` |
| 2 | `72ms` | `220ms` |
| 3 | `108ms` | `220ms` |
| 4 | `144ms` | `186ms` |

Index 4 is the first to compress (`330 - 144 = 186`, matching the
documented `Math.max(0, Math.min(220, 330 - delay))` formula exactly) — the
harness's five sections are too few to reach the "instant" tail
(index ≥ 10), but the one compressed sample present lands exactly where the
doc comment's own worked example (`ENTRY_TOTAL_MS - delay`) predicts.

**`reducedMotion: "reduce"`** — `animationName`, `animationDelay` and
`animationDuration` were the empty string (`""`) on all 5 items, at every
sample. No `[data-entry-item]` anywhere carried an `animation-name`.

**Console, both settings: 0 errors.** This is the first production mount of
`useEntry` — Plan 3 proved the hook in a harness of its own making; this is
the shell that will actually use it, and it hydrates clean. Also checked
under a light→dark theme switch via the real `localStorage` path (not a
stubbed provider): 0 console errors in all four passes (light load, dark
load, no-preference load, reduce load). The theme-provider hydration fix
this plan made earlier holds under its first real consumer.

## Summary

Structure and behaviour are correct: five groups read as five, exactly one
destination is ever current (by `aria-current` and colour together, always
agreeing), a detail route keeps its parent lit, the wordmark's red reads as
the brand once it's next to the rail's own red, entry motion staggers
exactly on spec and turns off completely under reduced motion, and the
shell's first real mount produced zero console errors in either theme. Two
real findings came out of actually looking: the rail is not sticky, so it
scrolls away on any page taller than a viewport (which five sections
already is); and `border-ct-line` — and by extension every `border-ct-*`
utility — silently falls back to a generic, non-theme-reactive grey instead
of the design's hairline token, in every primitive checked, in both themes.
