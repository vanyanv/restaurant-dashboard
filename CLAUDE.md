# Chris Neddy's — Restaurant Dashboard

Multi-store restaurant analytics dashboard. Next.js 16 (App Router, Turbopack), React 19, Prisma 7/Postgres, TanStack Query, shadcn/ui, Tailwind v4, deployed on Vercel.

Note: `next lint` was removed in Next 16 and this repo has no ESLint installed. The whole-project gate is `npm test && npm run tokens && npx tsc --noEmit && npm run build`.

---

## Before touching any dashboard or mobile UI, read this

**Read [`DESIGN.md`](DESIGN.md).** This branch (`dashboardv2`) runs on **Counter**
— Bricolage Grotesque for page titles and the wordmark only, DM Sans tabular
figures for every number, JetBrains Mono for captions/folios/SKUs/status
labels, `oklch()` `ct-` tokens in `src/styles/counter.css` as the only colour
source, 8px/5px radii, both a light and a dark theme asserted by test. The old
pre-Counter design system (a serif italic display face, cream-toned hex
colours, hairline-bordered panels, a red hover-bar row pattern) is being
deleted page by page as each route is rebuilt — it still runs a majority of
`src/app/dashboard/**` and the mobile shell today, so don't mistake its
presence in the tree for it still being the target. Generic Tailwind/shadcn
output is wrong on a Counter page, and so is output copying the old serif
system — neither is what a rebuilt page should look like.

**The rules are a build failure, not prose to remember. Run `npm run tokens`.**
It enforces, on `src/app/dashboard/**`, `src/app/(mobile)/m/**`,
`src/components/counter/**` and `src/lib/counter/**`: no colour literal
outside `counter.css`, no generic Tailwind palette colour, no page branching
on a `SectionData` status, no page importing Prisma or a server action
directly, no page importing `framer-motion` directly, no page or page client
importing or rendering `AppShell`/`PhoneShell` (they belong to a layout), no
`next/font` declared outside the root layout without `preload: false` (Next
puts the root `not-found` in every route's entry graph, so a font preloaded
there is downloaded on every screen and painted on almost none — this rule
walks `src/app/**` and `src/components/**`, wider than the roots above), no
directory under a `(counter)` route group holding a `page.tsx` without a
`loading.tsx` beside it, and no `page.tsx` under a `(counter)` route group
`await`ing a `get*Sections(...)` loader instead of the not-awaited
`get*SectionPromises(...)` streaming shape (the two order-detail routes are
exempted by name — see DESIGN.md). It has documented holes (regex, not an AST) — see
`DESIGN.md` and the module comment in `scripts/counter-lint.ts`.

Two things the linter cannot check, because they need judgment:

- **A figure shown on two pages comes from one function in
  `src/lib/counter/`.** (`src/lib/counter/*` doesn't exist yet — it's the
  next phase — but the rule applies from the moment it does.)
- **Don't split or restructure files >400 lines without reading
  [`docs/refactor-playbook.md`](docs/refactor-playbook.md).** The methodology
  assumes a re-export shim at the original path (and that shim must NOT have
  `"use server"` — it breaks Next.js re-exports), contract tests with mocked
  Prisma, and an explicit mobile-import check (`src/app/(mobile)/m/**` ∪
  `src/lib/mobile/**`). New patterns discovered during a split get added back
  to the playbook.

## Database migrations

Convention is `prisma db push` + a hand-written `prisma/manual-migrations/YYYY-MM-DD_*.sql`.
**Never `prisma migrate dev`** — it would reset the Neon production database.

**Run `npm run db:drift` before any schema change.** It reports differences between
schema.prisma and the live database. It must say "No difference detected" before you start;
if it doesn't, the database is carrying objects the schema no longer declares, and `db push`
will offer to delete them as the price of your migration. That happened once: the 2026-08-17
audit removed three models from the schema and left the tables in the database, so adding one
nullable column on 2026-08-19 came with a prompt to drop 129 rows. Resolve drift first, as its
own change, with the data archived — never by reaching for `--accept-data-loss`.

## Other references

- Refactor playbook (split big files safely): [`docs/refactor-playbook.md`](docs/refactor-playbook.md)

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
