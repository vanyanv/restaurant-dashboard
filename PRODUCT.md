# Product

## Register
product

## Users
Two roles operating Chris Neddy's multi-store restaurant business:
- **Owner** — multi-store oversight; lives in P&L, COGS, ingredient pricing, cross-store comparisons, end-of-day reconciliation. Reads numbers in a back office, often after service has closed.
- **Store managers** — single-store, daily operations: prep tasks, daily reports, fast operational calls during or right after service. Mobile-capable.

## Product Purpose
Replace platform-hopping (Otter, Yelp, POS exports, spreadsheets) with one reconciled, truthful view of every store's sales, costs, and operations. The dashboard exists so a 30-second financial answer is possible without opening five tabs. Success looks like the owner closing the books at 11pm with numbers that tie, and a manager checking prep status from their phone in under 10 seconds.

## Brand Personality
**Rigorous, editorial, plainspoken.**
A serious newspaper's financial section, not a SaaS marketing page. Numbers are first-class citizens; prose serves them. Voice is direct, unhedged, and operator-aware: no marketing copy, no exclamation points, no "let's get started" friendliness. Headings can be Fraunces-italic; everything load-bearing is plain.

## Anti-references
This product should NOT feel like:
- **Toast / Square POS dashboards** — bright primary blues, oversized buttons, friendly-emoji empty states, generic restaurant-tech UI.
- **Notion / Coda card sprawl** — endless rounded cards with icon + heading + text, nested cards, soft drop shadows, "everything is a card" composition.
- **Linear / Vercel dark SaaS** — slate-900 backgrounds, neon accent gradients, AI-startup chrome.

Plus the four standing tripwires from `CLAUDE.md`:
1. No generic Tailwind colors on `/dashboard/*` — only the editorial tokens (`--ink`, `--ink-muted`, `--ink-faint`, `--paper`, `--hairline`, `--hairline-bold`, `--accent`).
2. Two-tier typography: Fraunces italic for prose / display only; numbers in DM Sans 500–600 with `tabular-nums lining-nums`; JetBrains Mono for captions, folios, SKUs, status labels.
3. Every interactive list row uses `.inv-row` / `.order-row` hover (red 4px `scaleY(0→1)` accent + warm-red wash + red total). Plain `hover:bg-muted/50` is wrong.
4. Page sections are `.inv-panel`, never shadcn `<Card className="rounded-xl shadow-sm">`.

## Design Principles
1. **Numbers are typography.** Tabular lining figures, never proportional. Mono for SKU-class labels. Serif italics reserved for prose and display titles.
2. **Hairlines, not shadows.** The newspaper layer model: frame with 1px tonal hairlines (`--hairline`, `--hairline-bold`), never elevation. No `shadow-*`, no `rounded-xl`.
3. **Earn the red.** `--accent #dc2626` is a proofmark, not decoration. Reserve for state changes, totals on hover, single emphasis points. If everything is red, nothing is.
4. **Operator, not audience.** Optimize for the person closing books at 11pm, not for marketing screenshots. Density, scannability, and reconciliation legibility beat visual flourish.
5. **Editorial discipline beats novelty.** Match the existing system across every page. Per-page reskins are a regression.

## Accessibility & Inclusion
- **WCAG AA** on contrast for every editorial token combination (`--ink` on `--paper`, `--ink-muted` on `--paper`, `--accent` on `--paper`). `--ink-faint` is decorative-only and must not carry meaning.
- Full keyboard reachability on every interactive surface; visible focus rings tuned for the warm-paper background, not default browser blue.
- `prefers-reduced-motion: reduce` disables the `dock-in` staggered reveal and the `.inv-row` / `.order-row` red-bar `scaleY` transition (instant state change, no movement).
- Per-platform stamp colors (DoorDash red, UberEats black, Grubhub orange, ChowNow green) must always be paired with a text label, never color-only.
