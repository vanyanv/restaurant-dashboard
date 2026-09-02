# Product

## Register
product

## Users
One audience operating Chris Neddy's multi-store restaurant business:
- **Owner** — multi-store oversight; lives in P&L, COGS, ingredient pricing, cross-store comparisons, end-of-day reconciliation. Reads numbers in a back office, often after service has closed; checks pace and alerts from a phone between stores. (A `DEVELOPER` role exists as a strict superset for operating the system itself; there is no store-manager role.)

## Product Purpose
Replace platform-hopping (Otter, POS exports, spreadsheets) with one reconciled, truthful view of every store's sales, costs, and operations. The dashboard exists so a 30-second financial answer is possible without opening five tabs. Success looks like the owner closing the books at 11pm with numbers that tie, and getting the same answer from their phone in under 10 seconds.

## Design system
This branch (`dashboardv2`) runs on **Counter**, documented in full in [`DESIGN.md`](DESIGN.md) with the tokens in [`src/styles/counter.css`](src/styles/counter.css). The short version, because every design decision on a dashboard page has to land inside it:

- **Three faces, two tiers.** Bricolage Grotesque 600/700/800 for page titles and the wordmark, and nothing else — never at body weight, never on a number. DM Sans 500–600 with `tabular-nums lining-nums` for every figure. DM Sans 400 for prose. JetBrains Mono for captions, folios, SKUs and status labels.
- **Seven fixed px steps**, ratio ~1.16: `text-ct-micro` (10) through `text-ct-hero` (30). Not fluid, not clamped, never a raw px value that happens to match.
- **33 colour tokens, `oklch()`, `light-dark()` pairs**, declared once in `counter.css`. Surfaces stack `ct-surface` > `ct-paper` > `ct-chrome` > `ct-sunk`. Ink has three weights. No pure white, no pure black, every neutral warm-tinted.
- **Two radii**, `rounded-ct` (8px) and `rounded-ct-sm` (5px). Nothing else.
- **One easing curve**, `--ct-ease`. Motion lives behind hooks in `src/components/counter/motion/` and is off under `prefers-reduced-motion` in exactly one place.
- **Both themes are asserted by test**, not eyeballed: `tests/styles/counter-tokens.test.ts`, 154 assertions across two themes and four colour-vision models.

The pre-Counter system — a serif italic display face (Fraunces), cream hex colours, `.inv-panel` hairline panels, the `.inv-row` red hover-bar pattern, `--ink`/`--paper`/`--accent` variables — is **being deleted**, not maintained. It still runs the `(editorial)` route group and part of the phone shell. Reproducing it on a Counter page is a regression, exactly as much as generic Tailwind output is.

## Brand Personality
**Rigorous, plainspoken, unhurried.**
A well-set financial statement, not a SaaS marketing page. Numbers are first-class citizens; prose serves them. Voice is direct, unhedged and operator-aware: no marketing copy, no exclamation points, no "let's get started" friendliness, no encouragement. A page states what is true and what is not yet known, and stops.

The display face carries the page title and the wordmark. Everything load-bearing — every figure, every label, every control — is plain. Personality comes from restraint and precision, not from decoration.

## Anti-references
This product should NOT feel like:
- **Toast / Square POS dashboards** — bright primary blues, oversized buttons, friendly-emoji empty states, generic restaurant-tech UI.
- **Notion / Coda card sprawl** — endless rounded cards with icon + heading + text, nested cards, soft drop shadows, "everything is a card" composition.
- **Linear / Vercel dark SaaS** — slate-900 backgrounds, neon accent gradients, AI-startup chrome.
- **Its own predecessor** — the cream-and-Fraunces editorial system. Off-brand now, not just old.

Eight of the rules are a build failure rather than a preference. `npm run tokens` (`scripts/counter-lint.ts`) fails on: a colour literal outside `counter.css`; a generic Tailwind palette class; a page branching on a `SectionData` status; a page importing Prisma or a server action directly; a page importing `framer-motion` directly; a page mounting `AppShell`/`PhoneShell` (a layout owns those); a `(counter)` route directory with a `page.tsx` and no `loading.tsx`; and a `(counter)` `page.tsx` awaiting `get*Sections(...)` instead of the streaming `get*SectionPromises(...)` shape. It is a regex with five documented holes — read the module comment before trusting a clean run.

Two more need judgment and cannot be linted: a figure shown on two pages comes from **one** function in `src/lib/counter/`, and no file over 400 lines gets split without [`docs/refactor-playbook.md`](docs/refactor-playbook.md).

## Design Principles
1. **Numbers are typography.** Tabular lining figures, always. Mono for SKU-class labels. The display face never touches a figure.
2. **Tokens, or it doesn't ship.** Every colour is a `ct-` utility. A value that isn't in `counter.css` doesn't exist; if it should, it goes in `counter.css` and gets a test, not into a page.
3. **Earn the accent.** `ct-accent` is a proofmark: state, selection, a flagged value. More than one at rest on a screen means something is wrong. Ordinary hover and pressed feedback is `ct-sunk` or `ct-accent-wash`.
4. **Honest gaps beat plausible numbers.** A section nothing computes yet renders `owed`, not a zero. A figure that cannot be scoped to the selected range is `owed` too, not shown with a caveat — a caveat under the same heading as range-scoped figures answers a different question in the same breath.
5. **One place per concern.** Six section states render in `Section` and nowhere else. Range and store live in the URL and nowhere else. Seventeen nav destinations live in `nav.ts` and nowhere else. A second implementation is the defect, even when it looks correct.
6. **Operator, not audience.** Optimise for the person closing books at 11pm, not for a screenshot. Density, scannability and reconciliation legibility beat visual flourish.
7. **One system across the desk and the phone.** `/dashboard/x` and `/m/x` are the same product at two sizes. The phone is a lean glance-and-do cut of the desk, not a separate design.

## Accessibility & Inclusion
- **WCAG AA on both themes, asserted by test.** 26 token/surface pairings are checked against real prototype markup, hover rows and error rows included. `ct-ink-3` was moved twice to clear it. If a token changes, `tests/styles/counter-tokens.test.ts` is the judge, not a screenshot.
- **Colour never carries data alone.** Channel identity (`ct-ch-*`) is always paired with a text label — the four channel colours sit only ΔE 8.5 apart. Charts use the `ct-mx-*` data bands, separated by lightness rather than hue, and fixed to the channel rather than to its rank in a given chart.
- **`aria-current`, not colour, announces the current destination.** Both come from one `isActive()` call so they cannot disagree.
- **`prefers-reduced-motion` is honoured in one place.** `useReducedMotion()` defaults to REDUCED when `matchMedia` is unavailable, and does not read `matchMedia` during render — SSR and first client render must agree on the final value. A missed animation is cosmetic; an unwanted one can cause harm.
- **Full keyboard reachability, visible focus.** ⌘K opens Ask from anywhere and Escape restores focus to whatever held it. A `Table` row without an `href` is not a link, not focusable, and wears no pointer.
- **Popovers stay inside the frame.** Menus measure the trigger and the viewport on open and clamp, rather than fixing a width and hoping. Verified at 1440, 900 and 390px.
