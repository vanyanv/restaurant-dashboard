# Chris Neddy's — Restaurant Dashboard

Multi-store restaurant analytics dashboard. Next.js 15 (App Router), React 19, Prisma/Postgres, TanStack Query, shadcn/ui, Tailwind v4, deployed on Vercel.

---

## Before touching any `/dashboard/**` UI, read this

**Read [`docs/frontend-patterns.md`](docs/frontend-patterns.md) before styling or composing any dashboard page.** The dashboard runs on an "editorial docket" design system — cream paper, Fraunces serif, JetBrains Mono tabular, hairline frames, red proofmark accent. Generic Tailwind/shadcn output will look wrong and will need to be redone.

## The five tripwires Claude keeps hitting

1. **No generic Tailwind colors on `/dashboard/*`.** Use the editorial tokens: `--ink`, `--ink-muted`, `--ink-faint`, `--paper`, `--hairline`, `--hairline-bold`, `--accent`. Never `bg-sky-*`, `text-emerald-*`, `border-violet-*`, etc. on dashboard routes.

2. **Two-tier typography.** Fraunces italic is for prose and display titles only. Numbers (KPI values, row totals, chart tooltip amounts, date ranges) render in **DM Sans weight 500–600 with `font-variant-numeric: tabular-nums lining-nums`**. Captions, folios, SKUs, status labels use JetBrains Mono.

3. **Every interactive list row uses the `.inv-row` / `.order-row` hover pattern.** Red 4px `scaleY(0→1)` accent bar animates in from the left; background washes to `rgba(220,38,38,0.045)`; the total turns `var(--accent)` red. Plain `hover:bg-muted/50` is not the pattern.

4. **Page sections are `.inv-panel`, not shadcn `<Card>`.** Hairline-bold border, 2px radius, warm paper background, no shadow. shadcn `<Card className="rounded-xl shadow-sm">` is wrong for dashboard composition.

5. **Don't split or restructure files >400 lines without reading [`docs/refactor-playbook.md`](docs/refactor-playbook.md).** The methodology assumes a re-export shim at the original path (and that shim must NOT have `"use server"` — it breaks Next.js re-exports), contract tests with mocked Prisma, and an explicit mobile-import check (`src/app/(mobile)/m/**` ∪ `src/lib/mobile/**`). New patterns discovered during a split get added back to the playbook.

## Other references

- Backend / architecture / data-fetching: [`docs/architecture-cheat-sheet.md`](docs/architecture-cheat-sheet.md)
- Deep-dive: [`docs/architecture-interview-guide.md`](docs/architecture-interview-guide.md)
- Refactor playbook (split big files safely): [`docs/refactor-playbook.md`](docs/refactor-playbook.md)

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
