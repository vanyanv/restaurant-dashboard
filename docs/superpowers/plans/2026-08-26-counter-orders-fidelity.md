# Counter Orders: Fidelity Implementation Plan (Phase C, page 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/dashboard/orders` and `/dashboard/orders/[id]` on Counter to the prototype's own `P.orders` and `P.order`, both surfaces, and flip BOTH fidelity manifest entries to `"counter"` with a regression floor — zero extras, every absence recorded.

**Architecture:** Two primitives nobody has built (`Filters`, `MathLine`) come first, because both pages are mostly primitives that already exist. Then the server gap — the list row has no commission and the detail has no food cost — closed in the actions layer and in one new `src/lib/counter/order-costs.ts`. Then one adapter with two entry points, then the four compositions, then the gate.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 7, Prisma 7, Vitest 4 + RTL 16, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-25-counter-fidelity-addendum.md`, amending `docs/superpowers/specs/2026-08-23-counter-design-system-design.md`.

**Source of truth:** `P.orders` (line 4849) and `P.order` (line 6568) in `docs/counter/counter-prototype.html`, with data helpers `ORDERS` 4832, `ord4821()` 6541, `feeOf()` 3817, `chanPrice()` 3831, and `HOURS`/`HORD`/`HLO`/`HHI` 3662-3664. When this plan and the prototype disagree, the prototype wins and the plan gets fixed — that happened in **every task** of Phase B and most of Phase C.

## Why Orders is third, and why it is two pages

The rail order puts Orders after the P&L. It is also the first Counter page whose
content is a **list the reader filters**, which is why it needs the one primitive
the first two pages did not: filters that visibly filter. The prototype's own
note on the page says exactly that.

The list and the detail ship together rather than in two plans. Every row in the
list is a link into the detail, and a gated list whose rows lead to an editorial
page is a page that is half rebuilt while its gate says it is done. The manifest
carries both `orders` and `order`; both flip in Task 8 or neither does.

## What the schema genuinely publishes, and what it does not

Checked against `prisma/schema.prisma` before this plan was written, not assumed:

- `OtterOrder.commission` **exists** and is per-order. The prototype's Fees and
  Net columns are real; `OrderListRow` simply never selected the field.
- `OtterItemMapping` (`storeId`, `skuId`, `otterItemName` -> `recipeId`) and
  `OtterSubItemMapping` (`storeId`, `skuId` -> `recipeId`) **exist**. So an
  order line's food cost is real, and a line with no mapping is genuinely "not
  costed" — which is the prototype's own `l.cost == null` state and its "1 line
  not costed" strip caption. This is a match, not an invention.
- `batchRecipeCosts(accountId)` returns `{ totalCost, partial }` per recipe.
  `partial` is a second, weaker "not costed" — a mapped recipe whose own
  ingredients do not all price. Both render as not costed; only the mapping
  absence is counted in the strip caption.
- **Not published:** an order's accepted / ready / collected timestamps, and its
  payout id and payout date. The prototype's Timeline and Platform panels print
  five rows each; ours print what exists and no more. These are `Kv` ROWS, not
  landmarks — the `.kv` still renders, so nothing goes in `absentLandmarks` for
  them. Do not invent them.
- **Not published:** a per-order target of any kind. Every strip cell on both
  pages therefore carries no `reference`, and so no `.blt`, `.band` or `.sp`.
  That IS a landmark absence and Task 8 records it with a count.

## Global Constraints

- Branch is `dashboardv2`. No rebase.
- Gate: `rm -rf .next && npm test && npm run tokens && npx tsc --noEmit && npm run build`.
  **Stop any dev server before clearing `.next`** or the next sign-in returns 500.
- Tests live in a top-level `tests/` tree mirroring `src/`, never `__tests__/`.
- **A test that passes before the fix is not a test.** Break it, watch it red, restore, report both. Twelve such tests have been caught in this project; the last six were caught by implementers on themselves.
- `Section` is the sole state renderer. Every other primitive takes plain data.
- **No page inspects `SectionData.status`, imports Prisma, imports a server action directly, or imports `framer-motion`.**
- **Never fabricate a figure to close a gate.** An absence goes in the manifest's `absentLandmarks` with a reason and a count, and it fails as **stale** the day the data arrives.
- **Zero extras** (ruling F-R8) — an extra silently leaves the rendering comparison and shrinks what is checked.
- Under React 19 + RTL 16, only `fireEvent` commits state.
- `npm run shot -- <route> <out.png> <width> [light|dark]`. **The phone is `/m/...`, not the desk route at 390.**
- A dev server can serve **stale modules**, and a first sign-in against a cold server fails then passes on retry. Both are recorded false alarms.
- Colour literals are a build failure outside `counter.css`. The channel tint on a chip is `var(--ch-house|--ch-dd|--ch-ue|--ch-gh)`, resolved through the existing `src/lib/counter/channels.ts`, never a hex.

---

## Task 1: `Filters` — filters that visibly filter

**Files:**
- Create: `src/components/counter/surface/filters.tsx`
- Test: `tests/components/counter/filters.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `Filters`, `FilterToggle`.

```ts
export interface FilterToggle {
  /** Stable id — the value written to the URL. */
  id: string
  label: string
  /** A `ct-` custom property NAME, e.g. "--ch-dd". Never a colour literal. */
  tint?: string
  pressed: boolean
}

export function Filters(props: {
  search: string
  searchPlaceholder: string
  searchLabel: string
  onSearch: (next: string) => void
  toggles: FilterToggle[]
  onToggle: (id: string) => void
  /** Shown only when something is actually filtered. */
  onClear?: () => void
  /** The prototype's `8 of 187`. Pre-formatted. */
  count: string
}): ReactNode
```

The DOM is the prototype's, from line 4857:

```html
<div class="filters">
  <label class="search"><svg …/><input type="search" placeholder="…" aria-label="…"></label>
  <div class="togs">
    <button class="tog" type="button" style="--pc:var(--ch-dd)" aria-pressed="true"><i></i>DoorDash</button>
    …
  </div>
  <button class="clear" type="button">Clear filters</button>
  <span class="count">8 of 187</span>
</div>
```

Three details the CSS makes load-bearing (`src/styles/counter-components.css:220-233`):

- `.filters .clear[hidden]{display:none}` — the clear button is **rendered and
  hidden**, not conditionally absent. A conditionally-absent button changes the
  landmark count between a filtered and an unfiltered page, and the fidelity
  gate compares one render. Emit it always; set the `hidden` attribute when
  `onClear` is undefined.
- `.tog[aria-pressed="true"]` is the entire pressed style. The button MUST carry
  `aria-pressed`, both values, always — not `data-on`, not a class.
- `.tog i` reads `var(--pc, var(--ink-3))`. A toggle with no tint omits the
  inline property and inherits the fallback; it does not pass `--pc:none`.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react"
import { fireEvent } from "@testing-library/react"
import { Filters } from "@/components/counter/surface/filters"

const TOGGLES = [
  { id: "house", label: "In-house", tint: "--ch-house", pressed: false },
  { id: "doordash", label: "DoorDash", tint: "--ch-dd", pressed: true },
]

function setup(over: Partial<Parameters<typeof Filters>[0]> = {}) {
  const props = {
    search: "",
    searchPlaceholder: "Order ID, customer, item",
    searchLabel: "Search orders",
    onSearch: vi.fn(),
    toggles: TOGGLES,
    onToggle: vi.fn(),
    count: "8 of 187",
    ...over,
  }
  render(<Filters {...props} />)
  return props
}

it("presses exactly the toggles that are pressed", () => {
  setup()
  expect(screen.getByRole("button", { name: "In-house" })).toHaveAttribute("aria-pressed", "false")
  expect(screen.getByRole("button", { name: "DoorDash" })).toHaveAttribute("aria-pressed", "true")
})

it("hides the clear button rather than dropping it", () => {
  setup({ onClear: undefined })
  const clear = screen.getByRole("button", { name: "Clear filters", hidden: true })
  expect(clear).toHaveAttribute("hidden")
})

it("shows the clear button when there is something to clear", () => {
  const onClear = vi.fn()
  setup({ onClear })
  const clear = screen.getByRole("button", { name: "Clear filters" })
  expect(clear).not.toHaveAttribute("hidden")
  fireEvent.click(clear)
  expect(onClear).toHaveBeenCalled()
})

it("puts the channel tint on the swatch as a custom property, not a colour", () => {
  setup()
  const dd = screen.getByRole("button", { name: "DoorDash" })
  expect(dd.getAttribute("style")).toBe("--pc: var(--ch-dd);")
})

it("omits --pc entirely when a toggle has no tint", () => {
  setup({ toggles: [{ id: "all", label: "All", pressed: false }] })
  expect(screen.getByRole("button", { name: "All" }).getAttribute("style")).toBeFalsy()
})

it("reports typing through onSearch", () => {
  const props = setup()
  fireEvent.change(screen.getByLabelText("Search orders"), { target: { value: "4821" } })
  expect(props.onSearch).toHaveBeenCalledWith("4821")
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/components/counter/filters.test.tsx`
Expected: FAIL — cannot resolve `@/components/counter/surface/filters`.

- [ ] **Step 3: Implement**

Use the existing icon source for the magnifier — `src/components/counter/shell/nav-icons.ts` holds the prototype's `svg()` paths. If it has no `search` glyph, add it there from the prototype's own `ICONS` table rather than inlining a `<path>` in this component; every other glyph on Counter comes from that one file.

- [ ] **Step 4: Run the test and watch it pass**

- [ ] **Step 5: Prove the tint test is real**

Change `--pc` to a hex in the component, re-run, watch the tint test go red and `npm run tokens` fail. Restore. Report both outputs.

- [ ] **Step 6: Commit**

```bash
git add src/components/counter/surface/filters.tsx tests/components/counter/filters.test.tsx src/components/counter/shell/nav-icons.ts
git commit -m "feat(counter): filters that visibly filter"
```

---

## Task 2: `MathLine` — the chain, shown as arithmetic

**Files:**
- Create: `src/components/counter/surface/math-line.tsx`
- Test: `tests/components/counter/math-line.test.tsx`

**Interfaces:**
- Produces: `MathLines`, `MathRow`.

The prototype's "What you keep" panel (line 6592) is six `.mathline` divs. Note 20's
rule — arithmetic is shown as arithmetic — is why it is not a `Kv`.

```ts
export interface MathRow {
  key: string
  label: string
  /** The prototype's `<span class="op">` — this row is an operation, not a term. */
  op?: boolean
  /** Pre-formatted, already carrying its own sign. */
  value: string
  /** `<b>` on both label and value. The prototype bolds Net to you and Contribution. */
  strong?: boolean
  /** The rule above a subtotal. */
  rule?: boolean
  /** Drop the row's own bottom border — the prototype's trailing rows. */
  noBorder?: boolean
}

export function MathLines({ rows }: { rows: MathRow[] }): ReactNode
```

**The one thing this component must refuse to do.** The prototype's own comment
at line 6600 records the bug it already fixed once: *"Tax was drawn as a
subtraction and then not subtracted: the net printed underneath it was the
ticket less commission alone."* Tax is stated in prose beneath the panel and is
**not** a row. A `MathRow` whose `op` is true is a term in the sum; there is no
way to draw an operation that is not applied. If a caller wants to say something
about money that did not move, that is the `<p class="mono">` under the panel,
which is the caller's own child, not a row.

The prototype's inline styles (`border-top:1px solid var(--line-strong)` and
`border-bottom:none`) become the `rule` and `noBorder` flags. **They may not be
ported as inline `style` attributes** — an inline border here would be the only
place in Counter where a rule is drawn by a page rather than a sheet.
(An earlier draft of this plan claimed `npm run tokens` would fail on the inline
form. It does not; that was measured. Its colour rule matches hex/`oklch`/`rgb`/
`hsl` literals, not `var()` references, which it cannot ban outright because
assigning one to a custom property is the sanctioned pattern. This rule is held
by review, not by the build.) Add
two modifier classes to `src/styles/counter-repairs.css`:

```css
/* `P.order`'s "What you keep" panel draws two rules with inline styles
   (prototype lines 6595-6598). Ported as classes: an inline `var(--line-strong)`
   is a colour reference outside counter.css, which `npm run tokens` fails, and
   a page drawing its own rules is exactly what the sheet exists to prevent. */
.mathline.is-rule { border-top: 1px solid var(--line-strong); padding-top: 9px; border-bottom: none }
.mathline.is-open { border-bottom: none }
```

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react"
import { MathLines } from "@/components/counter/surface/math-line"

const ROWS = [
  { key: "ticket", label: "Ticket, as charged on DoorDash", value: "$36.65" },
  { key: "fee", label: "− commission 20%", op: true, value: "−$7.33" },
  { key: "net", label: "Net to you", value: "$29.32", strong: true, rule: true },
  { key: "cost", label: "− food cost", op: true, value: "−$8.10", noBorder: true },
]

it("marks operations and terms differently", () => {
  const { container } = render(<MathLines rows={ROWS} />)
  const rows = container.querySelectorAll(".mathline")
  expect(rows).toHaveLength(4)
  expect(rows[0].querySelector("span.op")).toBeNull()
  expect(rows[1].querySelector("span.op")).not.toBeNull()
})

it("bolds both halves of a strong row", () => {
  const { container } = render(<MathLines rows={ROWS} />)
  const net = container.querySelectorAll(".mathline")[2]
  expect(net.querySelector("span > b")?.textContent).toBe("Net to you")
  expect(net.querySelector(":scope > b")?.textContent).toBe("$29.32")
})

it("draws the rule above a subtotal as a class, never an inline style", () => {
  const { container } = render(<MathLines rows={ROWS} />)
  const net = container.querySelectorAll(".mathline")[2]
  expect(net.className).toContain("is-rule")
  expect(net.getAttribute("style")).toBeFalsy()
})

it("opens the trailing rows", () => {
  const { container } = render(<MathLines rows={ROWS} />)
  expect(container.querySelectorAll(".mathline")[3].className).toContain("is-open")
})
```

- [ ] **Step 2: Run it and watch it fail**
- [ ] **Step 3: Implement the component and the two repair rules**
- [ ] **Step 4: Run the test and watch it pass**
- [ ] **Step 5: Prove the inline-style test is real**

Replace `is-rule` with the prototype's inline `style` and re-run: the rule test goes red. `npm run tokens` will stay clean — see the note above; do not treat that as a failure of the step.

- [ ] **Step 6: Commit**

```bash
git add src/components/counter/surface/math-line.tsx tests/components/counter/math-line.test.tsx src/styles/counter-repairs.css
git commit -m "feat(counter): the chain from ticket to contribution, shown as arithmetic"
```

---

## Task 3: The server gap — commission on a row, food cost on a line

**Files:**
- Modify: `src/app/actions/order-actions.ts`
- Create: `src/lib/counter/order-costs.ts`
- Test: `tests/lib/counter/order-costs.test.ts`
- Test: `tests/app/actions/order-actions.test.ts` (extend if it exists; create if not)

**Interfaces:**
- Consumes: `batchRecipeCosts` from `@/lib/recipe-cost-batch`.
- Produces:
  - `OrderListRow.commission: number` and `OrderListResponse.undrainedCount: number`
  - `resolveLineCosts(input): LineCost[]` and `LineCost`

### 3a. `OrderListRow.commission` and `undrainedCount`

`getOrdersList` already reads `OtterOrder`; `commission` is a column on it
(`prisma/schema.prisma`, `model OtterOrder`). Add it to the `select` and to the
mapped row. Add `undrainedCount` to `OrderListResponse` — a `count` under the
same `where` plus `detailsFetchedAt: null`. That count is served by the partial
index `OtterOrder_pending_details_idx`
(`prisma/manual-migrations/2026-05-03_otter_pending_details_index.sql`), so it
does not need a new one. **No schema change and no migration.** Do not run
`prisma db push`; do not run `prisma migrate dev` under any circumstance.

### 3c. `OrderListResponse.totals` — the strip is about the range, not the page

`getOrdersList` is cursor-paginated and returns at most 200 rows. The Orders
strip reads "Orders", "Net sales", "Avg ticket" and "Marketplace fees" for the
**whole matched range**, so it may not be summed from `rows` — a strip summing
one page of a paginated list silently reports the page as if it were the range.
`totalCount` already does this correctly for the order count; the money figures
need the same treatment.

Add one `prisma.otterOrder.aggregate` under the SAME `where` to the existing
`Promise.all`, and expose it:

```ts
export type OrderListTotals = {
  /** Σ subtotal − Σ discount, over every matched order. */
  netSales: number
  /** Σ commission, over every matched order. */
  commission: number
  /** Σ subtotal − Σ discount, over matched orders whose platform is not in-house. */
  thirdPartyNetSales: number
}
```

`thirdPartyNetSales` is what "23.3% of 3P" is a percentage OF, so it cannot be
derived from the other two. It needs its own aggregate with the in-house
platform excluded; use `src/lib/counter/channels.ts` to decide which platform
strings are in-house rather than string-matching "css-pos" here.

**Four early-return branches** in `getOrdersList` return a literal response
object. Adding required fields to `OrderListResponse` makes every one of them a
type error — that is the point. Fix all four; do not widen the type to optional
to avoid them.

### 3b. `resolveLineCosts`

A pure function, so it is testable without a database. The adapter does the
querying and hands it plain rows.

```ts
export interface LineCostInput {
  /** `OtterOrderItem` and `OtterOrderSubItem` flattened, in render order. */
  lines: Array<{
    key: string
    name: string
    /** A sub-item — the prototype's `l.mod`. */
    modifier: boolean
    skuId: string
    quantity: number
    /** What the channel charged for this line. */
    price: number
  }>
  /** skuId -> recipeId, from OtterItemMapping / OtterSubItemMapping. */
  recipeBySku: Map<string, string>
  /** recipeId -> { totalCost, partial }, from batchRecipeCosts. */
  costByRecipe: Map<string, { totalCost: number; partial: boolean }>
  /** The order's commission as a fraction of its ticket. */
  commissionRate: number
}

export interface LineCost {
  key: string
  name: string
  modifier: boolean
  quantity: number
  price: number
  /** price × (1 − commissionRate) — the prototype's `l.keep`. */
  keep: number
  /** null when this line has no recipe behind it, or its recipe does not fully price. */
  cost: number | null
  /** Why there is no cost, for the queue item. */
  uncostedReason: "unmapped" | "partial" | null
}
```

Rules, each of which is a test below:

1. `keep` is `price * (1 - commissionRate)`, per line, never the order's net split proportionally afterwards.
2. `cost` multiplies the recipe's `totalCost` by `quantity`. A recipe costed per portion and an order of three is three portions.
3. A sku with no mapping gives `cost: null, uncostedReason: "unmapped"`.
4. A mapped recipe with `partial: true` gives `cost: null, uncostedReason: "partial"`. **Not** a partial number — a margin computed from an incomplete recipe reads better than the truth and is wrong in the flattering direction.
5. A zero `keep` gives no margin at all downstream; `resolveLineCosts` does not divide, so this rule binds the adapter, not this function.

- [ ] **Step 1: Write the failing tests**

```ts
import { resolveLineCosts } from "@/lib/counter/order-costs"

const base = {
  recipeBySku: new Map([["SKU-SLIDER", "r1"]]),
  costByRecipe: new Map([["r1", { totalCost: 2.5, partial: false }]]),
  commissionRate: 0.2,
}

it("keeps each line net of the channel's own rate", () => {
  const [l] = resolveLineCosts({
    ...base,
    lines: [{ key: "a", name: "Double Slider", modifier: false, skuId: "SKU-SLIDER", quantity: 1, price: 10 }],
  })
  expect(l.keep).toBeCloseTo(8)
})

it("costs a quantity of three as three portions", () => {
  const [l] = resolveLineCosts({
    ...base,
    lines: [{ key: "a", name: "Double Slider", modifier: false, skuId: "SKU-SLIDER", quantity: 3, price: 30 }],
  })
  expect(l.cost).toBeCloseTo(7.5)
})

it("reports an unmapped sku as not costed rather than as zero", () => {
  const [l] = resolveLineCosts({
    ...base,
    lines: [{ key: "a", name: "Add Grilled Onion", modifier: true, skuId: "SKU-ONION", quantity: 1, price: 0.95 }],
  })
  expect(l.cost).toBeNull()
  expect(l.uncostedReason).toBe("unmapped")
})

it("refuses a partial recipe's cost instead of flattering the margin", () => {
  const [l] = resolveLineCosts({
    ...base,
    costByRecipe: new Map([["r1", { totalCost: 2.5, partial: true }]]),
    lines: [{ key: "a", name: "Double Slider", modifier: false, skuId: "SKU-SLIDER", quantity: 1, price: 10 }],
  })
  expect(l.cost).toBeNull()
  expect(l.uncostedReason).toBe("partial")
})
```

- [ ] **Step 2: Run and watch all four fail**
- [ ] **Step 3: Implement `resolveLineCosts` and the two action changes**
- [ ] **Step 4: Run and watch them pass**
- [ ] **Step 5: Prove the partial test is real**

Make the partial branch return `totalCost * quantity`. Re-run: that one test goes red and the other three stay green. Restore. Report both.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/order-actions.ts src/lib/counter/order-costs.ts tests/lib/counter/order-costs.test.ts
git commit -m "feat(orders): an order row knows what the marketplace took, and a line knows what it cost"
```

---

## Task 4: `adapters/orders.ts`

**Files:**
- Create: `src/lib/counter/adapters/orders.ts`
- Test: `tests/lib/counter/adapters/orders.test.ts`

**Interfaces:**
- Consumes: `classify` from `./types`; `getOrdersList`, `getOrderDetail` from `@/app/actions/order-actions`; `getHourlyPatternsForRange` from `@/app/actions/hourly-orders-actions`; `resolveLineCosts` from `../order-costs`; `CHANNELS` from `../channels`; `money` (its `{ cents: true }` form is the prototype’s `USD2`) from `../format`.
- Produces: `getOrdersSections(input): Promise<OrdersSections>` and `getOrderSections(input): Promise<OrderSections>`, plus every interface below.

Follow `src/lib/counter/adapters/pnl.ts` for shape: exported interfaces at the
top with the prototype line each one ports, one exported entry point per page,
every section built by a pure `build*` function that takes loaded data and
returns plain serialisable props. **The `build*` functions are the unit under
test; the entry points are not tested against a live database.**

### `OrdersSections` — `P.orders.desk()` line 4853

```ts
export interface OrdersSections {
  /** `strip([...])` line 4854. Five cells, none with a reference — see below. */
  strip: SectionData<StripCell[]>
  /** The filter bar and the table, one section: the count is the table's own. */
  list: SectionData<OrdersList>
  /** `sec('Orders by hour', …)` line 4870. */
  byHour: SectionData<ChartSpec>
}

export interface OrdersList {
  toggles: FilterToggle[]
  search: string
  /** The prototype's `8 of 187` — shown of matched. */
  count: string
  rows: OrdersRow[]
}

export interface OrdersRow {
  key: string
  href: string
  /** `#4821`. */
  id: string
  /** `9:32pm`, in the STORE's timezone. */
  time: string
  channel: { label: string; tint: string }
  items: string
  ticket: string
  /** An em dash when the channel took nothing. */
  fees: string
  net: string
}
```

The five strip cells, each from a real figure:

| Cell | Value | Delta | Caption |
|---|---|---|---|
| Orders | matched row count | vs the comparison range | — |
| Net sales | Σ `subtotal − discount` | vs the comparison range | — |
| Avg ticket | net ÷ orders | vs the comparison range | — |
| Marketplace fees | Σ `commission` | — | `N% of 3P` |
| Unsynced to POS | `undrainedCount` | — | see the ruling |

**Ruling O-R1 — "Unsynced to POS" keeps the prototype's slot and gets an honest
caption.** The prototype's fifth cell counts orders the POS never matched. This
schema tracks a different thing under the same shape: `detailsFetchedAt IS NULL`
— orders whose line detail we have not yet drained from Otter. The figure is
real, it answers the same reader's question ("is anything missing?"), and it is
zero on a healthy day exactly as the prototype's is. It ships in that slot with
the label **"Details not drained"** and the caption `all drained` / `N pending`.
Renaming it is the honest half; dropping it would leave a four-cell strip and a
landmark absence for data we do have. Cost if wrong: a label a reader has to
learn once.

**Ruling O-R2 — no strip cell on either page carries a `reference`.** Nothing in
the schema publishes a per-order target, a fee ceiling or a ticket floor.
Following the Overview's own precedent (Scan-R1), the figures ship with no
meter and Task 8 records `.blt`, `.band` and `.sp` absences with exact counts.
Do not pass a `reference` built from a constant in this file.

`byHour` is a `bars` chart from `getHourlyPatternsForRange`, whose comparison
groups give the band the prototype draws. Its meta is the prototype's
`band = the last four <dow>s` — build that string from the range's own weekday,
never hardcode "Thursdays".

### `OrderSections` — `P.order.desk()` line 6572

```ts
export interface OrderSections {
  /** Line 6574. Five cells. */
  strip: SectionData<StripCell[]>
  /** `sec('Items', …)` line 6580 — the lines table with its total row. */
  items: SectionData<OrderItems>
  /** `sec('What you keep', …)` line 6593 — the MathLines panel and its prose. */
  keep: SectionData<OrderKeep>
  /** `sec('Timeline', 'from the POS', kv(…))` line 6608. */
  timeline: SectionData<KvRow[]>
  /** `sec('Platform', …, kv(…))` line 6610. */
  platform: SectionData<KvRow[]>
  /** `sec('Needs you', …, queue(…))` line 6613. */
  needsYou: SectionData<QueueItem[]>
  /** The masthead's `title` and `sub` — line 6570. */
  head: SectionData<{ title: string; sub: string }>
}

export interface OrderItems {
  meta: string
  rows: OrderItemRow[]
  total: OrderItemRow
}

export interface OrderKeep {
  rows: MathRow[]
  /** The tax sentence and the uncosted warning, already assembled. */
  note: string
}
```

Four rules the tests pin:

1. **The items table's total row is the sum of the rows drawn above it** (note 39). Compute it here from `rows`, never from the order's own `total` column — a total that disagrees with its own lines is the defect the cascade was built to prevent.
2. **A margin is never printed when `keep` is zero.** `(keep − cost) / keep` on a comped line is a division by zero; the cell renders an em dash.
3. **The tax sentence states and does not subtract.** Tax appears only in `note`, never in `rows` — the prototype's own repaired bug, ported as a rule.
4. **`needsYou` counts unmapped lines, and is `empty` when there are none.** The prototype hardcodes one item; ours builds one queue entry per distinct unmapped sku, naming the sku and how many of this account's orders in the last period carried it. When every line is costed, the section is `empty` with reason `no_match`, not a queue of length zero.

- [ ] **Step 1: Write the failing tests** for the `build*` functions — one per rule above, plus one asserting no cell carries a `reference` (ruling O-R2), plus one asserting the em-dash fee for an in-house order.

- [ ] **Step 2: Run and watch them fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run and watch them pass**
- [ ] **Step 5: Prove the total-row test is real**

Change the total row to read the order's `total` column and feed the test an order whose column disagrees with its lines by a cent. Watch it go red. Restore. Report both.

- [ ] **Step 6: Commit**

```bash
git add src/lib/counter/adapters/orders.ts tests/lib/counter/adapters/orders.test.ts
git commit -m "feat(counter): one adapter for the list of orders and for one order"
```

---

## Task 4b: The band the prototype draws, and a filter that can express "In-house"

**Added after Task 4, from two gaps it found. Files:**
- Modify: `src/lib/hourly-orders.ts`, `src/app/actions/hourly-orders-actions.ts`
- Modify: `src/app/actions/order-actions.ts`
- Modify: `src/lib/counter/adapters/orders.ts` (`buildOrdersByHour`, `buildToggles`)
- Test: `tests/lib/hourly-orders.test.ts`, `tests/lib/counter/adapters/orders.test.ts`

### 4b-i. A per-hour band, because the data is already in hand

`sec('Orders by hour', 'band = the last four <dow>s', chart({… band:{lo:HLO, hi:HHI} …}))`
— prototype line 4870. Task 4 could not draw it: `HourlyOrderPoint` publishes
`avgOrderCount`, the MEAN across the four baseline weeks, and
`OrderPatternsHourlyComparison.groupTotals` are whole-period totals with no hour
attached. A `{lo,hi}` built from a mean is a zero-width band drawn as a range —
correctly refused, and shipped as a dashed baseline line instead.

But the spread is not missing, only discarded. `readHourlyPatterns` already
queries **every `(date, hour)` row for all four comparison groups** in one
`findMany` and hands them to `bucketHourlyRows`, which averages them. Publish
the spread instead of only its mean:

```ts
export interface HourlyOrderPoint {
  // …existing fields unchanged…
  /** Per-baseline-group order counts for THIS hour, weeks with no data removed. */
  groupOrderCounts: number[]
}
```

`buildOrdersByHour` then draws `band: { lo: min(groupOrderCounts), hi: max(...) }`
per hour, which is what the prototype draws, and **drops the dashed baseline
series**. That series is an EXTRA landmark under ruling F-R8 and would block
Task 8's gate; this is why 4b comes before the compositions rather than after.

An hour whose `groupOrderCounts` is empty (no baseline week had data) gets no
band at that hour, not a band of zero. Keep the existing `hasBaseline` guard for
the whole-chart case.

**Do not change `avgOrderCount`.** The Overview's pace lines read it and the
Overview is already gated; a changed mean would show up there as a regression.

### 4b-ii. A filter that can express "In-house"

`getOrdersList` filters on ONE `platform` string, but `css-pos` and `bnm-web`
both map to the `house` channel (`CHANNEL_FOR_PLATFORM` in `channel-mix.ts`), so
a per-channel toggle cannot be expressed and Task 4 shipped toggles per raw
slug. The prototype's four toggles are CHANNELS (line 4859) — In-house,
DoorDash, Uber Eats, Grubhub — so the filter has to widen:

```ts
export type OrderListFilters = {
  // …existing…
  /** Raw platform slugs. Any match. Supersedes `platform`, which stays for callers that pass one. */
  platforms?: string[] | null
}
```

`where.platform = { in: platforms }` when the array is non-empty. An empty array
means **no filter**, not "match nothing" — a reader who deselects every toggle
is asking to see everything, which is also what the prototype's Clear does.
Test that case explicitly; it is the one a naive `in: []` gets backwards by
returning zero rows.

Then `buildToggles` emits one toggle per `ChannelId` with `markVarFor(id)` as the
tint, and the adapter maps selected channels to their slugs through
`CHANNEL_FOR_PLATFORM`.

- [ ] **Step 1: Write the failing tests** — per-hour lo/hi across four uneven groups; an hour with no baseline data; `platforms: []` returning everything; a channel toggle selecting both house slugs.
- [ ] **Step 2: Run and watch them fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run and watch them pass**
- [ ] **Step 5: Prove the empty-array test is real** — change the filter to `in: platforms` unconditionally, watch that one test go red while the others stay green, restore, report both.
- [ ] **Step 6: Confirm the Overview did not move** — `npm run fidelity -- --grep Overview` must stay green, because `avgOrderCount` feeds its pace lines.
- [ ] **Step 7: Commit**

---

## Task 5: The desk list — `/dashboard/orders`

**Files:**
- Create: `src/app/dashboard/orders/page.tsx`
- Create: `src/app/dashboard/orders/counter-orders-client.tsx`
- Delete: `src/app/dashboard/(editorial)/orders/page.tsx`, `loading.tsx`, `components/`
- Test: `tests/app/counter-orders.test.tsx`

The route **graduates out of `(editorial)`** — that is both the migration
mechanism and how anyone sees what is left. Copy the session/params/adapter
shape from `src/app/dashboard/pnl/page.tsx` exactly: resolve the session, read
the params once, resolve `today` once, call `getOverviewStores()` for the
switcher, call `getOrdersSections(...)` once, pass plain props.

**No owner gate.** The P&L redirects a non-owner because every section on it is
one owner-only rollup. Orders is not: a manager who can see the dashboard can
see the orders that came through their own store. Do not copy the
`hasOwnerAccess` block.

The filter state lives in the URL through `writeCounterParams`, not in
component state — a filtered list has to survive a reload and be linkable. Add
`channels` (comma-separated ids) and `q` to `src/lib/counter/url-state.ts` in
this task, with tests in `tests/lib/counter/url-state.test.ts` covering: absent
means all channels, an unknown channel id is dropped rather than throwing, and
clearing removes both keys instead of writing empty ones.

Client-island tests (RTL, `fireEvent` only): pressing a toggle writes the URL;
the clear button is hidden with no filters and shown with one; the count reads
"shown of matched".

### Two things Task 4's review handed to this task

**The `byHour` section has page-level furniture the adapter does not carry.**
The prototype's `sec('Orders by hour', …)` (lines 4874-4877) closes with a
`<p class="mono">` — *"This is the list. The shape of it — which channel, which
hour, which way it is moving — is one page over."* — and a `.btnrow` holding a
`.btn` reading **"Open analytics"**, pointing at `/dashboard/analytics`. Neither
is a figure, so neither belongs in `OrdersByHour`; both are the composition's to
render, as children of that `Section`. **Render them, or Task 8 reports two
missing landmarks.**

**`list` never goes empty, and that needs writing down.** `buildOrdersList`
returns a `ready` list with zero rows when a filter matches nothing, rather than
`empty("no_match")` — deliberately, because the filter bar lives INSIDE that
section and an empty state would take the reader's filters away along with the
rows, leaving them no way to widen the search that just failed. That is the
right call and the mirror of rule 4, so state it in the island's own comment.
The table still needs something in the zero-row case: the prototype has no such
state, so render the `.filters` bar with an empty `Table` beneath it.


- [ ] **Step 1: Write the failing island tests**
- [ ] **Step 2: Run and watch them fail**
- [ ] **Step 3: Implement the page, the island, and the two url-state keys**
- [ ] **Step 4: Run and watch them pass**
- [ ] **Step 5: Photograph it**

```bash
npm run shot -- /dashboard/orders /tmp/orders-desk.png 1440
npm run shot -- /dashboard/orders /tmp/orders-desk-dark.png 1440 dark
```

Open both. Compare against `P.orders.desk()` rendered in the prototype. Report what differs; do not flip any gate in this task.

- [ ] **Step 6: Commit**

---

## Task 6: The phone list — `/m/orders`

**Files:**
- Modify: `src/app/(mobile)/m/orders/page.tsx`
- Create: `src/app/(mobile)/m/orders/counter-phone-orders-client.tsx`
- Test: `tests/app/counter-phone-orders.test.tsx`

`P.orders.phone()` line 4880 is three blocks: the `mtitle`/`msub` pair, a
two-cell `mstrip` (Orders, Avg ticket), and `sec('Latest', '8 shown', mlist(...))`
over the first six rows. **The phone has no filter bar** — the prototype does
not draw one and neither do we.

The `msub` is `<orders> orders · <net sales>` — both figures come from the SAME
`getOrdersSections` call the desk uses, not a second loader. One adapter, two
surfaces; that is what stops one range having two answers.

Follow `src/app/(mobile)/m/pnl/page.tsx` for the wrapper, including
`export const dynamic = "force-dynamic"` and the `data-perf-ready="/m/orders"`
div.

- [ ] **Step 1: Write the failing island test** — asserts the six-row cap and that each row's `href` is the detail route.
- [ ] **Step 2: Run and watch it fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run and watch it pass**
- [ ] **Step 5: Photograph it at 390 on the `/m/` route**

```bash
npm run shot -- /m/orders /tmp/orders-phone.png 390
npm run shot -- /m/orders /tmp/orders-phone-dark.png 390 dark
```

- [ ] **Step 6: Commit**

---

## Task 7: The detail, both surfaces — `/dashboard/orders/[id]` and `/m/orders/[id]`

**Files:**
- Create: `src/app/dashboard/orders/[id]/page.tsx`, `counter-order-client.tsx`
- Modify: `src/app/(mobile)/m/orders/[id]/page.tsx`
- Create: `src/app/(mobile)/m/orders/[id]/counter-phone-order-client.tsx`
- Delete: `src/app/dashboard/(editorial)/orders/[id]/`
- Test: `tests/app/counter-order.test.tsx` and `tests/app/counter-phone-order.test.tsx`

Both surfaces call `getOrderSections` once. The page carries `nodate: true` in
the prototype (line 6569) — **the date control does not render on a detail
page**, because one order does not have a range. Check how `AppShell` is told
that; if it has no such prop yet, add one rather than hiding the control with
CSS.

Desk layout, from line 6579: `strip`, then a `.split` holding Items and What you
keep, then a `.tri` holding Timeline, Platform and Needs you. `.split` and `.tri`
are bare wrapper divs the ported sheet already styles — write them inline in the
island exactly as `counter-overview-client.tsx` already does.

Phone layout, from line 6617: title/sub, a two-cell `mstrip` (Ticket, You keep),
`sec('Items', …, mlist(…))`, `sec('What you keep', '', MoneyLines)`, then the tax
prose. `MoneyLines` already exists — use it; do not use `MathLines` on the phone,
because the prototype does not.

An order id that does not exist, or belongs to another account, must
`notFound()`. `getOrderDetail` already returns `null` for both; do not render an
empty page.

- [ ] **Step 1: Write the failing island tests** — the em-dash margin on a zero-keep line; the not-costed cell; tax absent from the money rows on both surfaces; a 404 for an unknown id.
- [ ] **Step 2: Run and watch them fail**
- [ ] **Step 3: Implement all four files**
- [ ] **Step 4: Run and watch them pass**
- [ ] **Step 5: Photograph all four**

Pick a real order id out of the database for the shots; record which one in the report so the next task can reuse it.

- [ ] **Step 6: Commit**

---

## Task 8: Flip both gates

**Files:**
- Modify: `e2e/fidelity/manifest.ts`
- Modify: `docs/superpowers/specs/2026-08-25-counter-fidelity-addendum.md` (the phase table)

- [ ] **Step 1: Run the gate against the pages as they stand**

```bash
npm run fidelity -- --grep "Orders|An order"
```

They are still `editorial`, so they SKIP. Temporarily flip both to `"counter"`
with a placeholder baseline of `{ desktop: 0, mobile: 0 }` and re-run to get the
real counts and the real difference list.

- [ ] **Step 2: Drive the differences to zero extras**

Every `extra` is a defect in our page and must be fixed in the composition, never
forgiven — ruling F-R8, an extra silently leaves the rendering comparison.

- [ ] **Step 3: Record every absence with its count and its reason**

The `absentLandmarks` entries this plan already knows are owed, from ruling O-R2:
`.blt`, `.band` and `.sp` under every strip cell on both pages. Write the exact
per-surface counts the run reports, and the sentence naming what would produce
them (`buildStrip` in `adapters/orders.ts`, with no per-order target published
by `prisma/schema.prisma`). An allowance that forgives fewer than it budgets
fails as **stale**, so the counts must be exact.

The detail page's missing Timeline and Platform ROWS are **not** absences —
`.kv` renders. Do not add entries for them.

- [ ] **Step 4: Set the real baselines and run the gate twice, the second run cold**

```bash
npm run fidelity
rm -rf .next && npm run fidelity
```

Both runs must be green. The cold run is what catches a page that only passes
against a warm dev server's stale modules.

- [ ] **Step 5: Run the whole-project gate**

```bash
rm -rf .next && npm test && npm run tokens && npx tsc --noEmit && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add e2e/fidelity/manifest.ts docs/superpowers/specs/2026-08-25-counter-fidelity-addendum.md
git commit -m "test(fidelity): the orders list and one order are gated"
```

---

## Self-review

**Spec coverage.** The addendum requires, per page: the CSS ported not
approximated (Tasks 1-2 add two components against the already-ported sheet and
add exactly two repair rules, with a written reason); one adapter per page
(Task 4); both surfaces built together (Tasks 5-7); three Playwright passes per
surface with a recorded baseline (Task 8). Covered.

**Placeholders.** Task 4's test step names its cases rather than printing them,
which is the one place this plan describes tests instead of writing them. That is
deliberate: the exact fixtures depend on `OrderDetail`'s real shape, which the
implementer reads in Task 3. Every rule those tests must pin is stated
numerically above, so there is nothing for the implementer to invent.

**Type consistency.** `FilterToggle` is produced by Task 1 and consumed by
Task 4's `OrdersList`. `MathRow` is produced by Task 2 and consumed by Task 4's
`OrderKeep`. `LineCost` is produced by Task 3 and consumed by Task 4. `StripCell`
is `FigureProps`, re-exported from `adapters/pnl.ts` — Task 4 must import it
from there rather than declare a second one.

**One gap this plan leaves open on purpose.** `getOrdersList` is cursor
paginated and the prototype's table is eight rows with no pager. Task 5 renders
the first page and the count says "shown of matched", which is honest and
matches the prototype's `8 of 187`. A real pager is a follow-up, not a fidelity
requirement — the prototype does not draw one.
