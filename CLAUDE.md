# Chris Neddy's — Restaurant Dashboard

Multi-store restaurant analytics dashboard. Next.js 15 (App Router), React 19, Prisma/Postgres, TanStack Query, shadcn/ui, Tailwind v4, deployed on Vercel.

---

## Before touching any `/dashboard/**` UI, read this

**Read [`docs/frontend-patterns.md`](docs/frontend-patterns.md) before styling or composing any dashboard page.** The dashboard runs on an "editorial docket" design system — cream paper, Fraunces serif, JetBrains Mono tabular, hairline frames, red proofmark accent. Generic Tailwind/shadcn output will look wrong and will need to be redone.

## The four tripwires Claude keeps hitting

1. **No generic Tailwind colors on `/dashboard/*`.** Use the editorial tokens: `--ink`, `--ink-muted`, `--ink-faint`, `--paper`, `--hairline`, `--hairline-bold`, `--accent`. Never `bg-sky-*`, `text-emerald-*`, `border-violet-*`, etc. on dashboard routes.

2. **Two-tier typography.** Fraunces italic is for prose and display titles only. Numbers (KPI values, row totals, chart tooltip amounts, date ranges) render in **DM Sans weight 500–600 with `font-variant-numeric: tabular-nums lining-nums`**. Captions, folios, SKUs, status labels use JetBrains Mono.

3. **Every interactive list row uses the `.inv-row` / `.order-row` hover pattern.** Red 4px `scaleY(0→1)` accent bar animates in from the left; background washes to `rgba(220,38,38,0.045)`; the total turns `var(--accent)` red. Plain `hover:bg-muted/50` is not the pattern.

4. **Page sections are `.inv-panel`, not shadcn `<Card>`.** Hairline-bold border, 2px radius, warm paper background, no shadow. shadcn `<Card className="rounded-xl shadow-sm">` is wrong for dashboard composition.

## Other references

- Backend / architecture / data-fetching: [`docs/architecture-cheat-sheet.md`](docs/architecture-cheat-sheet.md)
- Deep-dive: [`docs/architecture-interview-guide.md`](docs/architecture-interview-guide.md)
