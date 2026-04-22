# Frontend Patterns — Editorial Dashboard

> How to build pages under `src/app/dashboard/**` that look and feel like the rest of the dashboard. Optimized for fresh Claude sessions: if you skim only § 1 you'll still be ~80% right.

**Scope:** `/dashboard/*` routes only. `/login`, `/manager/*`, and shadcn primitive internals have their own rules — see § 7.

**Source of truth:** All design tokens and base classes live in [`src/app/dashboard/editorial.css`](../src/app/dashboard/editorial.css). This doc maps that file so you don't have to read 3,900 lines.

---

## § 1 — Rules that matter

The non-negotiables. If you only read one section, read this one.

1. **Use editorial tokens, not Tailwind color utilities.** On `/dashboard/**`, reach for `var(--ink)`, `var(--ink-muted)`, `var(--ink-faint)`, `var(--paper)`, `var(--hairline)`, `var(--hairline-bold)`, `var(--accent)`, `var(--accent-dark)`, `var(--accent-bg)`, `var(--subtract)`. Not `sky-*`, `emerald-*`, `violet-*`, `amber-*`, `rose-*`. Red is the only "hot" color and it means *pay attention* — use it sparingly.

2. **Page sections are `.inv-panel`, not `<Card>`.** Hairline-bold border, 2px radius, warm paper background, **no shadow**. Reserve shadcn `<Card>` for non-dashboard surfaces (settings forms, modals).

3. **Every interactive list row uses the `.inv-row` / `.order-row` hover pattern.** Red 4px vertical accent bar scales in from `scaleY(0)` → `scaleY(1)`, background washes to `rgba(220,38,38,0.045)`, and the `total-num` / `.inv-row__total` element turns `var(--accent)` red. A chevron icon fades in from `-4px → 0`. `hover:bg-muted/50` alone is not the pattern.

4. **Two-tier typography.**
   - **Fraunces italic** — prose and display (section titles, vendor names, empty-state titles, editorial topbar title).
   - **DM Sans 500–600 with `font-variant-numeric: tabular-nums lining-nums`** — all comparison-grade numbers (KPI values, row totals, hero amounts, chart tooltip amounts, date ranges in mastheads).
   - **JetBrains Mono** — captions, folios (`Fig. 01`, row `001`), SKUs, invoice numbers, status labels, column headers.

5. **Filters live in the URL, not in React state.** Filters are `searchParams`. Client components merge new values via `new URLSearchParams(searchParams?.toString())` and `router.replace(qs, { scroll: false })`. Preserves other filters, survives refresh, is shareable.

6. **Filters are visible, not hidden in dropdowns.** Status, time period, store — chip strips and pill bars. The existing `<Select>` for store in the topbar is the exception; new filters get chips.

7. **Mono caps captions above Fraunces italic values.** The visual rhythm across the whole dashboard is: `FONT-MONO LABEL IN CAPS` on top, `serif italic or DM-Sans-tabular value` below. This is the beat of every panel head, KPI, and meta row.

8. **No rounded-xl or shadow-sm.** Use `border-radius: 2px` and a hairline-bold border. The one blessed shadow is for floating popovers: `box-shadow: 0 10px 30px -12px rgba(26,22,19,0.18)`.

9. **Red is a proofmark, not a brand color.** Status stamps, live-dot pulse, peak bar in a chart, accent bar on hover, the dark red `--accent-dark` for approved stamps. Don't use red for primary actions or decorative gradients.

10. **Animated entrance uses `.dock-in dock-in-{1..12}`.** Applied to top-level cards/rows on first paint; creates a soft staggered reveal. Don't reinvent this with framer-motion.

11. **One Suspense per section, with a Skeleton fallback.** Section order is fixed by the shell; each renders independently via `<Suspense>` and is wrapped in `<SectionErrorBoundary>`.

---

## § 2 — Design tokens

All declared on `.editorial-surface` in `editorial.css` (lines 3–21). The dashboard layout wraps everything in this class, so tokens are available anywhere.

### Ink + paper

| Token | Hex | Use when |
|---|---|---|
| `--ink` | `#1a1613` | Primary text, strong numbers, solid fills on active chips |
| `--ink-muted` | `#6b625a` | Secondary text, store names, small meta |
| `--ink-faint` | `#a69d92` | Tertiary text, captions, "Unassigned" placeholder |
| `--paper` | `#fbf6ee` | Base page background (set on `.editorial-surface`) |
| `--paper-deep` | `#f4ecdf` | Deeper cream (bottom of body gradient, pagination bar, masthead fills) |

### Dividers

| Token | Hex | Use when |
|---|---|---|
| `--hairline` | `#e8dfd3` | Thin row dividers inside panels, dotted section rules |
| `--hairline-bold` | `#c9beaf` | Panel borders, toolbar outlines, input borders |

### Accents

| Token | Hex | Use when |
|---|---|---|
| `--accent` | `#dc2626` | Proofmark red: hover accent bar, row total on hover, REVIEW stamps, live-dot pulse, peak bar in a chart |
| `--accent-dark` | `#7c1515` | APPROVED stamps, active-nav text, user-card chrome |
| `--accent-bg` | `#fcecec` | Pale red wash for "needs review" alert buttons |
| `--subtract` | `#8a3a3a` | REJECTED stamps (paired with strikethrough) |

### Platform stamps

| Token | Hex | Platform |
|---|---|---|
| `--platform-doordash` | `#eb1700` | DoorDash |
| `--platform-ubereats` | `#0b0b0b` | Uber Eats |
| `--platform-grubhub` | `#f15c26` | Grubhub |
| `--platform-chownow` | `#16a085` | ChowNow |
| `--platform-neutral` | `#4a4541` | BNM-Web, CSS-POS |

### Page atmosphere

`.editorial-surface` composes a radial-gradient + linear-gradient background plus a fixed-position SVG grain overlay (5% opacity, `multiply` blend). Don't try to replicate this per-component — just place content inside the surface.

---

## § 3 — Typography (two-tier rule)

Three fonts. One job each. Don't mix.

### Fraunces serif italic — prose and display

**Use for:** section titles, masthead headings, vendor names in list rows, empty-state titles, panel titles, chart caption eyebrow (`<em>The spending rhythm</em>`).

**Don't use for:** numbers anyone might need to compare or verify — digits lose their counters at small sizes and italic lowercase numerals look ambiguous.

Font family (already loaded globally):
```css
font-family: var(--font-fraunces), "Iowan Old Style", Georgia, serif;
font-variation-settings: "opsz" 96, "SOFT" 40;
font-style: italic;
font-weight: 500;
letter-spacing: -0.02em;
```

For big display (e.g. editorial topbar title), bump `opsz` to 144 and `letter-spacing` to `-0.03em`. Use `.font-display-tight` for poster-size numerals in non-dashboard contexts.

### DM Sans tabular — all numbers

**Use for:** KPI values, row totals, hero spend amounts, chart tooltip amounts, date ranges in mastheads, anything a user scans or compares.

**Canonical rule:**
```css
font-family: var(--font-dm-sans), ui-sans-serif, sans-serif;
font-weight: 500;      /* or 600 for row-dense columns */
font-variant-numeric: tabular-nums lining-nums;
font-feature-settings: "tnum", "lnum", "ss01";
letter-spacing: -0.02em;  /* -0.014em for smaller sizes */
```

Size guide: 60–68px for hero spend, 28px for KPI value, 20px for panel amount, 15–16px for row total, 14.5px for meta value. Sans reads heavier than serif — size down ~15% versus Fraunces.

### JetBrains Mono — captions, folios, codes

**Use for:** caption labels above values (`TOTAL SPEND · APR 22 — MAY 22`), folio numbers (`001`, `Fig. 01`), invoice numbers (`№ 2026-001`), SKU codes, dates in list rows, pagination counter (`FOLIO 1 / 3`), chart tick labels, column headers.

**Canonical rule:**
```css
font-family: var(--font-jetbrains-mono), ui-monospace, Menlo, monospace;
font-variant-numeric: tabular-nums;
font-size: 10–11px;
letter-spacing: 0.18–0.24em;
text-transform: uppercase;
color: var(--ink-faint);   /* or --ink-muted for slightly louder */
```

The `.font-label`, `.font-stamp`, and `.font-mono` utility classes in `editorial.css` cover most needs.

### Combined rule of thumb

> **Mono caps captions above DM Sans tabular values, inside a Fraunces italic frame.** Every panel head, every KPI, every hero follows this rhythm.

---

## § 4 — Component patterns

Every pattern below has a live implementation in the codebase. Prefer composition over reinvention.

### `EditorialTopbar`

**Source:** `src/app/dashboard/components/editorial-topbar.tsx`

Every dashboard page's top bar. Renders a sidebar trigger, a `§ N` section label, an italic Fraunces title, optional mono caps "stamps" (last-sync timestamps, status), and an `ml-auto` slot for action buttons (store filter, sync button).

```tsx
<EditorialTopbar
  section="§ 02"
  title="Invoices"
  stamps={<span>{lastSyncText}</span>}
>
  <StoreFilter userId={userId} current={currentStore} />
  <SyncButton />
</EditorialTopbar>
```

### `.inv-panel` — paper-framed container

**Source:** `editorial.css` `§ 02 INVOICES` block (search for `.inv-panel`).

Replaces shadcn `<Card>` for dashboard sections. Hairline-bold border, 2px radius, warm paper background, no shadow.

```tsx
<section className="inv-panel" aria-label="...">
  {/* content */}
</section>
```

For flush content (no inner padding — e.g. the invoice list), add `.inv-panel--flush`.

### `.order-row` / `.inv-row` — interactive hover row

**Source:** `editorial.css` — search `.order-row` (line ~131) for the canonical implementation, `.inv-row` (line ~4535) for the invoice variant.

The signature hover: a 4px red vertical bar on the left scales in from `scaleY(0)` → `scaleY(1)` over 220ms, the background washes to `rgba(220,38,38,0.045)`, the total turns `var(--accent)`, and a chevron fades in from `-4px → 0`. Focus-visible gets the same treatment.

```tsx
<button type="button" className="inv-row">
  <span className="inv-row__folio">001</span>
  <span className="inv-row__vendor">
    <span className="inv-row__vendor-name">Sysco Foods</span>
    <span className="inv-row__vendor-meta">
      <em>№ 2026-001</em> · <span>14 items</span>
    </span>
  </span>
  {/* ...date, store, total, status... */}
  <span className="inv-row__total">$2,487.22</span>
  <ChevronRight className="inv-row__chev" />
</button>
```

For order-style rows (different column layout), use `.order-row` with child class `.total-num` on the amount — the hover coloring hooks off that class.

### `.platform-stamp` / `.inv-stamp` — proofmark badges

**Source:** `editorial.css` `.platform-stamp` (line ~196) and `.inv-stamp` (search `inv-stamp`).

Tilted (`rotate(-0.5deg)` or `-1.5deg` for louder variants) pill-shaped badges with `1.5px solid currentColor` border, DM Sans caps, 0.14em tracking, 9.5px. The border and text share `currentColor`, so one color styles both.

```tsx
{/* Platform */}
<span className="platform-stamp" data-platform="doordash">DoorDash</span>

{/* Invoice status */}
<span className="inv-stamp" data-status="REVIEW">Needs review</span>
```

Status data-attributes the invoice stamp supports: `MATCHED`, `APPROVED`, `REVIEW`, `PENDING`, `REJECTED`. `REJECTED` auto-strikes through.

### `.toolbar-btn` / `.inv-period__pill` — hairline-outlined buttons

**Source:** `editorial.css` `.toolbar-btn` (line ~272) and `.inv-period__pill`.

Rectangular button, `1px solid var(--hairline-bold)` by default. Hover: border turns `var(--ink)` and a subtle `rgba(0,0,0,0.02)` wash fills in. Active (`.active` or `[data-active="true"]`): border and text go `var(--accent)` with `var(--accent-bg)` fill.

For the period-selector pill-group pattern (segmented, grouped with internal hairlines), use `.inv-period__pills` as the wrapper with `.inv-period__pill` children.

### `.search-shell` / `.inv-toolbar__search` — hairline search input

**Source:** `editorial.css` `.search-shell` (line ~294).

Hairline-bold outlined container with 55% white fill, 8–12px padding, transparent borderless input inside. Placeholder renders in italic Fraunces at `var(--ink-faint)`. Focus-within → border goes `var(--ink)`.

```tsx
<div className="inv-toolbar__search">
  <Search className="h-4 w-4" />
  <input type="text" placeholder="Search by vendor…" />
</div>
```

### `.inv-kpis` — four-column ledger strip

**Source:** `editorial.css` `.inv-kpis` (search).

A single hairline-bold framed strip split into 4 equal cells by internal hairlines (2 on mobile). Each cell has a mono folio (`Fig. 01`), DM Sans caps label, DM Sans 500 tabular value, small sub. When `--alert` modifier is applied, the value turns red and a pulsing live-dot appears.

```tsx
<div className="inv-kpis">
  <div className="inv-kpi inv-kpi--alert dock-in dock-in-1">
    <span className="inv-kpi__folio">Fig. 01</span>
    <span className="inv-kpi__label">Needs review</span>
    <span className="inv-kpi__value">3</span>
    <span className="inv-kpi__sub">flagged invoices</span>
  </div>
  {/* ...three more... */}
</div>
```

### Smaller atoms

- **`.perforation`** — dashed horizontal divider between ledger groups, with optional text in the middle.
- **`.hairline`** — plain horizontal rule with `var(--hairline)` color.
- **`.live-dot`** — 6px pulsing red dot (1.8s infinite); used for live / needs-attention indicators.
- **`.kbd-chip`** — JetBrains Mono 10px chip with hairline-bold border; for keyboard shortcuts.
- **`.dock-in dock-in-{1..12}`** — staggered fade-up entrance (480ms cubic-bezier, 60ms delay step). Apply to top-level panel/row on first paint.

---

## § 5 — Page composition template

Every dashboard page follows the same skeleton. Copy it. Don't improvise.

### File layout

```
src/app/dashboard/<feature>/
├── page.tsx                              (server: auth + parse searchParams)
└── components/
    ├── <feature>-shell.tsx               (server: EditorialTopbar + body layout)
    ├── <feature>-client.tsx              (client: interactive bits)
    ├── sections/
    │   ├── data.ts                       (React.cache fetchers + parseFilters)
    │   ├── <name>-section.tsx            (server: fetches via data.ts)
    │   └── topbar-bits.tsx               (server: store filter, sync button)
    └── ...                                (additional client components)
```

### `page.tsx`

```tsx
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { MyFeatureShell } from "./components/my-feature-shell"
import { parseMyFilters } from "./components/sections/data"

export default async function MyFeaturePage({
  searchParams,
}: {
  searchParams: Promise<{
    storeId?: string
    status?: string
    page?: string
  }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sp = await searchParams
  const filters = parseMyFilters(sp)

  return <MyFeatureShell userId={session.user.id} filters={filters} />
}
```

### Shell

Wrap body in `<EditorialTopbar>` + a scrollable container. Inside, one `<Suspense>` per section, each with a `<SectionErrorBoundary>` and a matching `<Skeleton>` fallback.

```tsx
<div className="flex flex-col h-full">
  <EditorialTopbar section="§ 03" title="My Feature" stamps={<LastSyncText />}>
    <StoreFilter userId={userId} current={currentStore} />
    <SyncButton />
  </EditorialTopbar>

  <div className="flex-1 overflow-auto px-4 pb-8 pt-4 sm:px-6 sm:pt-5">
    <div className="mx-auto flex max-w-350 flex-col gap-5 sm:gap-6">
      <SectionErrorBoundary label="Summary unavailable">
        <Suspense fallback={<KpiCardsSkeleton />}>
          <MySummarySection filters={filters} />
        </Suspense>
      </SectionErrorBoundary>

      {/* ...additional sections in the same pattern... */}
    </div>
  </div>
</div>
```

### `sections/data.ts`

Server-only module. Wraps server actions in `React.cache` so parallel sections share a single DB hit per render. Also exports the filter parser.

```ts
import { cache } from "react"
import { getMyData } from "@/app/actions/my-actions"

export interface MyFilters {
  storeId?: string
  status?: string
  page?: number
}

export function parseMyFilters(sp: {
  storeId?: string
  status?: string
  page?: string
}): MyFilters {
  // ...normalize, handle "all", coerce numbers
}

export const fetchMyData = cache(
  (storeId: string | undefined, status: string | undefined) =>
    getMyData({ storeId, status })
)
```

### URL-as-state for filters

Client components mutate filters by composing a new query string and replacing the URL:

```tsx
const router = useRouter()
const searchParams = useSearchParams()

const pushFilters = (next: Record<string, string | null>) => {
  const params = new URLSearchParams(searchParams?.toString() ?? "")
  params.delete("page") // filters reset pagination
  for (const [k, v] of Object.entries(next)) {
    if (v === null || v === "" || v === "all") params.delete(k)
    else params.set(k, v)
  }
  const qs = params.toString()
  router.replace(
    qs ? `/dashboard/my-feature?${qs}` : "/dashboard/my-feature",
    { scroll: false }
  )
}
```

This preserves filters not being changed. Never use `router.push` (adds to history stack on every keystroke) and never `new URLSearchParams()` empty (wipes unrelated filters).

---

## § 6 — Anti-patterns (DO / DON'T)

What Claude keeps getting wrong. Each row is one swap.

| ❌ Don't | ✅ Do | Why |
|---|---|---|
| `bg-sky-500/10 text-emerald-700 border-rose-500/20` | `bg-(--accent-bg) text-(--accent-dark) border-(--hairline-bold)` or equivalent inline `style` with `var()` | Dashboard is a single warm palette; framework color utilities fight it |
| `<Card className="rounded-xl shadow-sm">` for a page section | `<section className="inv-panel">` | Dashboard panels are paper-framed ledgers, not tech cards |
| `hover:bg-muted/50` on a list row | `.inv-row` (or `.order-row`) — red `scaleY` accent bar + total color shift + chevron fade-in | The signature hover is the "am I clicking this?" answer |
| Italic Fraunces at 34px for a KPI number | DM Sans 500 at 28px with `tabular-nums lining-nums` | Italic serif digits are hard to scan |
| Status filter inside a `<Select>` dropdown | Visible `.inv-status-chip` strip | Filters are meant to be obvious, not hidden |
| `rounded-xl`, `shadow-sm`, `shadow-md` | `border-radius: 2px`, hairline-bold border, no shadow (paper-shadow `0 10px 30px -12px rgba(26,22,19,0.18)` only for popovers) | Editorial surfaces are flat paper, not floating cards |
| Local `useState` for filters | URL `searchParams` + `router.replace` | Filters are shareable, survive refresh, and roundtrip through server components |
| Sentence-case button text for captions / toolbar labels | DM Sans caps with 0.12–0.18em tracking (or `.font-label` / `.font-stamp`) | Consistent editorial rhythm across the whole dashboard |
| `Inter`, `Roboto`, `system-ui` for numbers | DM Sans 500–600 with tabular-nums lining-nums | Project font; stays on-brand |
| Bright framework purple / teal / gradients | `--accent` red sparingly, and only as a "pay attention" signal | Red is a proofmark, not a brand color |
| A single big `<Suspense>` around the whole page body | One `<Suspense>` per section with its own `<Skeleton>` | Independent streaming; users see usable content faster |

---

## § 7 — When NOT to use the editorial theme

Some places intentionally live outside `.editorial-surface`:

- **`/login`** — has its own visual treatment. Don't import editorial styles.
- **`/manager/*`** — separate visual language, scoped to manager role.
- **shadcn primitive internals** — Dialog portal content, Popover inner chrome, DropdownMenu items. Style via `className` on the primitive with `var(--token)` values; don't wrap the primitive in an editorial panel.
- **Chart tooltips** — recharts doesn't reliably pick up `className`, so set inline `style={{ ... }}` using `var(--token)` strings. See `src/app/dashboard/invoices/components/spend-trend-client.tsx` for the pattern.
- **Raw error / loading states returned from middleware or API routes** — these are JSON, not UI.

---

## § 8 — Adding new patterns

If you invent a new visual component while building a page:

1. **Add styles to `src/app/dashboard/editorial.css`** under a `§` comment block. Follow the existing `§ 02 INVOICES` convention — a header banner, then grouped rules. Prefix new class names with a feature short-code (`inv-`, `pnl-`, etc.) so they don't collide.

2. **Document the class in this file under § 4** — what it is, when to use, a minimal code snippet. One short subsection per pattern.

3. **Use existing tokens.** If you need a new token (e.g. a new accent variant), add it to `.editorial-surface` in `editorial.css` at the top, not ad-hoc in the new rule.

4. **Lean on existing patterns first.** If your new component is a variant of an existing one (another row layout, another KPI strip), extend the existing class with a modifier (`--dense`, `--alert`) before introducing a new base.
