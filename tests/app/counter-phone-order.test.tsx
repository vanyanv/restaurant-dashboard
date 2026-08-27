// @vitest-environment jsdom
/**
 * One order, on the phone — asserted against `P.order.phone()`'s own
 * composition (`docs/counter/counter-prototype.html:6617`).
 *
 * The prototype writes four blocks and nothing else:
 *
 *   <div><h2 class="mtitle">Order #4821</h2><p class="msub">DoorDash · 9:32pm</p></div>
 *   mstrip([['Ticket', …], ['You keep', …]])              — TWO cells, not five
 *   sec('Items', 'N lines', mlist(…))
 *   sec('What you keep', '', money(…))                    — MONEY lines, not math
 *   <p class="mono">…the tax sentence…</p>                — outside the section
 *
 * and the page is `nodate: true`, so `.mtop` carries no date chip.
 *
 * THE MONEY/MATH DISTINCTION IS THE POINT OF THIS FILE. The desk draws the
 * chain as arithmetic (`.mathline`, with `Net to you` ruled off in the middle);
 * the phone draws it as a statement (`.moneyline`, four rows, no `Net to you`).
 * They are different marks in the prototype and this surface takes the one the
 * prototype gives it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "@testing-library/react"

/*
 * `vi.hoisted`, not bare top-level consts — a `vi.mock` factory runs when the
 * mocked module is first imported, which under ESM is before any statement in
 * this file. See the desk file's own note.
 */
const m = vi.hoisted(() => ({
  push: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
  redirect: vi.fn(),
  getOrderSections: vi.fn(),
  getOverviewStores: vi.fn(),
  getServerSession: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: m.push }),
  notFound: m.notFound,
  redirect: m.redirect,
}))
vi.mock("@/lib/counter/adapters/orders", () => ({ getOrderSections: m.getOrderSections }))
vi.mock("@/lib/counter/adapters/overview", () => ({ getOverviewStores: m.getOverviewStores }))
vi.mock("next-auth", () => ({ getServerSession: m.getServerSession }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

import { CounterPhoneOrderClient } from "@/app/(mobile)/m/orders/[id]/counter-phone-order-client"
import MobileOrderDetailPage from "@/app/(mobile)/m/orders/[id]/page"
import { ready, empty, failed } from "@/lib/counter/section-data"
import type { OrderItems, OrderKeep, OrderSections } from "@/lib/counter/adapters/orders"
import type { KvRow, QueueItem } from "@/components/counter"

const STORES = [
  { id: "hollywood", name: "Hollywood", stage: "trading" as const },
  { id: "glendale", name: "Glendale", stage: "pre_open" as const },
]

const SESSION = { user: { name: "Chris Karimian", role: "OWNER", accountId: "acc_1" } }

const HEAD = { title: "Order #4821", sub: "DoorDash · Aug 21, 9:32pm · 3 items" }

/**
 * The DESK's five cells. The phone picks two of them BY LABEL — "Ticket" and
 * "You keep" — so a cell inserted ahead of one cannot shift the other left and
 * print marketplace fees under a heading that says what you keep.
 *
 * `Commission` carries the FEE this order paid, as a positive amount behind a
 * minus sign. The editorial page this replaces printed `tax + commission` and,
 * because `OtterOrder.commission` is stored NEGATIVE, showed a figure smaller
 * than the tax alone — usually negative on a DoorDash order.
 */
const STRIP = [
  { label: "Ticket", value: "$36.65", delta: "DoorDash prices" },
  {
    label: "Commission",
    value: "−$9.16",
    delta: "25% of ticket",
    deltaTone: "is-down" as const,
  },
  { label: "You keep", value: "$27.49", delta: "75% of ticket" },
  {
    label: "Food cost",
    value: "−$8.10",
    delta: "1 line not costed",
    deltaTone: "is-down" as const,
  },
  { label: "Contribution", value: "$19.39", delta: "71% of what you keep" },
]

/** The same four lines the desk fixture uses — see its note on the two em dashes. */
const ITEMS: OrderItems = {
  meta: "2 lines · 2 modifiers",
  rows: [
    {
      key: "l1",
      name: "The Family Box",
      modifier: false,
      qty: "1",
      price: "$37.20",
      keep: "$27.90",
      cost: "$11.40",
      margin: "59%",
      uncosted: false,
    },
    {
      key: "l2",
      name: "Add Grilled Onion",
      modifier: true,
      qty: "1",
      price: "$0.00",
      keep: "$0.00",
      cost: "$0.12",
      margin: "—",
      uncosted: false,
    },
    {
      key: "l3",
      name: "Add Pickle",
      modifier: true,
      qty: "1",
      price: "$0.00",
      keep: "$0.00",
      cost: "not costed",
      margin: "—",
      uncosted: true,
    },
    {
      key: "l4",
      name: "Vanilla Shake (20 oz cup)",
      modifier: false,
      qty: "2",
      price: "$7.18",
      keep: "$5.38",
      cost: "$1.88",
      margin: "65%",
      uncosted: false,
    },
  ],
  total: {
    key: "total",
    name: "Total",
    modifier: false,
    qty: "5",
    price: "$44.38",
    keep: "$33.28",
    cost: "$13.40",
    margin: "60%",
    uncosted: false,
  },
  // The phone draws no total row and no chain — `mlist` is the lines alone —
  // so this is here for the type and stays empty.
  reconcile: [],
}

const KEEP: OrderKeep = {
  rows: [
    { key: "ticket", label: "Ticket, as charged on DoorDash", value: "$36.65" },
    { key: "commission", label: "− commission 25%", op: true, value: "−$9.16" },
    { key: "net", label: "Net to you", strong: true, rule: true, value: "$27.49" },
    { key: "food", label: "− food cost", op: true, noBorder: true, value: "−$8.10" },
    { key: "contribution", label: "Contribution", strong: true, noBorder: true, value: "$19.39" },
  ],
  note:
    "$4.85 of sales tax was collected and remitted by DoorDash. It is not in any figure above, " +
    "because it was never yours.",
}

const TIMELINE: KvRow[] = [{ label: "Placed", value: "9:32pm" }]

const PLATFORM: KvRow[] = [
  { label: "Channel", value: "DoorDash" },
  { label: "External id", value: "24FA9B55" },
  { label: "Store", value: "Hollywood" },
]

const NEEDS: QueueItem[] = [
  {
    key: "sku-pickle",
    tone: "warn",
    lead: "188",
    unit: "orders",
    title: "A modifier is not costed: Add Pickle",
    body: "Add Pickle is on this order and it has no recipe behind it.",
  },
]

const sections = (over: Partial<OrderSections> = {}): OrderSections => ({
  head: ready(HEAD),
  strip: ready(STRIP),
  items: ready(ITEMS),
  keep: ready(KEEP),
  timeline: ready(TIMELINE),
  platform: ready(PLATFORM),
  needsYou: ready(NEEDS),
  ...over,
})

function renderPhone(over: Partial<OrderSections> = {}) {
  m.push.mockClear()
  return render(<CounterPhoneOrderClient stores={STORES} sections={sections(over)} />)
}

const scroll = (c: HTMLElement) => c.querySelector(".mscroll") as HTMLElement

/** The landmark classes the fidelity gate counts, in the order they render. */
const LANDMARKS = [
  "mstrip",
  "mlist",
  "moneyline",
  "mathline",
  "sec",
  "sec__head",
  "sec__body",
  "strip",
  "tbl",
  "kv",
  "queue",
  "filters",
  "chart",
]

function landmarkSequence(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>("*"))
    .map((el) => LANDMARKS.filter((c) => el.classList.contains(c)).join("."))
    .filter(Boolean)
}

const rows = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>(".mli"))

beforeEach(() => {
  m.push.mockClear()
  m.notFound.mockClear()
  m.getOrderSections.mockReset()
  m.getOverviewStores.mockReset().mockResolvedValue(STORES)
  m.getServerSession.mockReset().mockResolvedValue(SESSION)
})

describe("Counter one order — the phone", () => {
  it("puts .ct-root and .ct-phone ABOVE .mscroll, so .mtop is inside the token root", () => {
    const { container } = renderPhone()
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toBe("ct-root ct-phone")
    expect([...root.children].map((c) => c.className)).toEqual(["mtop", "mscroll"])
  })

  it("composes the page in `P.order.phone()`'s order — four blocks, nothing else", () => {
    const { container } = renderPhone()
    expect(landmarkSequence(scroll(container))).toEqual([
      "mstrip",
      "sec",
      "sec__head",
      "sec__body",
      "mlist",
      "sec",
      "sec__head",
      "sec__body",
      "moneyline",
      "moneyline",
      "moneyline",
      "moneyline",
    ])
  })

  it("draws NO date chip — the page is `nodate: true`", () => {
    // `phoneFor()` writes `(p.nodate ? '' : CD.chip())`, so the slot is empty
    // and there is no `CD.sheet()` under `.mscroll` either. Not hidden: absent.
    const { container } = renderPhone()
    const top = container.querySelector(".mtop") as HTMLElement
    expect(top.querySelector(".cdchip")).toBeNull()
    expect(container.querySelector(".msheet")?.textContent ?? "").not.toContain("Compare")
    expect(container.textContent).not.toContain("Last 7 days")
  })

  it("carries the prototype's `.mback` to the list this order came from", () => {
    // `trailOf('order')` is `['orders']`, so `phoneFor()` emits `.mback` with
    // the parent's own name. It goes to the PHONE's list, not the desk path —
    // a link is also what lands in the address bar.
    const { container } = renderPhone()
    const back = container.querySelector(".mback") as HTMLAnchorElement
    expect(back).not.toBeNull()
    expect(back.getAttribute("href")).toBe("/m/orders")
    expect(back.textContent).toContain("Orders")
  })

  it("heads the page with the order and its own sentence", () => {
    const { container } = renderPhone()
    expect(container.querySelector(".mtitle")?.textContent).toBe("Order #4821")
    expect(container.querySelector(".msub")?.textContent).toBe(
      "DoorDash · Aug 21, 9:32pm · 3 items",
    )
  })

  /* ── The strip ─────────────────────────────────────────────────────── */

  it("draws the prototype's TWO cells — Ticket and You keep, not the desk's five", () => {
    const { container } = renderPhone()
    const strip = container.querySelector(".mstrip") as HTMLElement
    expect(Array.from(strip.querySelectorAll(".k")).map((e) => e.textContent)).toEqual([
      "Ticket",
      "You keep",
    ])
    expect(Array.from(strip.querySelectorAll(".v")).map((e) => e.textContent)).toEqual([
      "$36.65",
      "$27.49",
    ])
    expect(strip.textContent).not.toContain("Contribution")
  })

  /* ── The money statement ───────────────────────────────────────────── */

  it("uses MoneyLines, not MathLines — the prototype's `money()`, not its `.mathline`", () => {
    const { container } = renderPhone()
    expect(container.querySelector(".mathline")).toBeNull()
    expect(container.querySelectorAll(".moneyline").length).toBeGreaterThan(0)
  })

  it("states four rows, drops `Net to you`, and shows the FEE as a positive charge", () => {
    // `money([['Ticket', …], ['Commission N%', '−$…','bad'], ['Food cost','−$…'],
    //         ['Contribution', …,'total']])` — line 6626. No `Net to you`.
    //
    // THE FEE FIGURE. The editorial page this replaces printed
    // `tax + commission` with a NEGATIVE commission column and so showed less
    // than the tax alone. The figure here is the marketplace's cut, drawn as
    // the deduction it is.
    const { container } = renderPhone()
    const lines = Array.from(container.querySelectorAll(".moneyline")).map((l) => [
      l.querySelector("span:first-child")?.textContent,
      l.querySelector("span:last-child")?.textContent,
    ])
    expect(lines).toEqual([
      ["Ticket", "$36.65"],
      ["Commission", "−$9.16"],
      ["Food cost", "−$8.10"],
      ["Contribution", "$19.39"],
    ])
    expect(container.textContent).not.toContain("Net to you")
    // Not "−$-9.16", and not a figure below the tax: the fee is $9.16.
    expect(lines[1][1]).toBe("−$9.16")
  })

  it("ends the statement with `.moneyline.total` and tones the commission bad", () => {
    const { container } = renderPhone()
    const all = Array.from(container.querySelectorAll(".moneyline"))
    expect(all[all.length - 1].className).toBe("moneyline total")
    expect(all[0].className).toBe("moneyline")
    const commission = all[1].querySelector("span:last-child") as HTMLElement
    expect(commission.getAttribute("style")).toContain("var(--bad)")
  })

  it("keeps TAX out of the money rows and states it in the prose below the section", () => {
    const { container } = renderPhone()
    for (const l of Array.from(container.querySelectorAll(".moneyline"))) {
      expect(l.textContent).not.toContain("$4.85")
    }
    const prose = scroll(container).querySelector(".mono") as HTMLElement
    expect(prose.textContent).toContain("$4.85 of sales tax")
    // Outside the section, exactly as `P.order.phone()` writes it.
    expect(prose.closest(".sec")).toBeNull()
  })

  /* ── The item list ─────────────────────────────────────────────────── */

  it("prints the margin under each costed line and `not costed` under one that is not", () => {
    const { container } = renderPhone()
    const notes = rows(container).map((r) => r.querySelector(".rt em")?.textContent ?? null)
    expect(notes).toEqual(["59% margin", null, "not costed", "65% margin"])
  })

  it("says nothing rather than `— margin` on a line that keeps nothing", () => {
    // `money(null)`'s em dash is not a sentence. The list's own `no fees` rule,
    // one page over, is the same decision: a qualifier that reads as a dash is
    // dropped rather than printed.
    const { container } = renderPhone()
    const onion = rows(container)[1]
    expect(onion.textContent).not.toContain("— margin")
    expect(onion.querySelector(".rt em")).toBeNull()
  })

  it("tones a not-costed line down and a costed one up", () => {
    const { container } = renderPhone()
    const tones = rows(container).map((r) => r.querySelector(".rt em")?.className ?? null)
    expect(tones).toEqual(["up", null, "down", "up"])
  })

  it("marks a modifier as one, and says when it has no recipe", () => {
    const { container } = renderPhone()
    const details = rows(container).map((r) => r.querySelector("div > span")?.textContent)
    expect(details).toEqual(["1", "modifier", "modifier · no recipe", "2"])
  })

  it("makes no row a link — the adapter carries no destination for a line", () => {
    // `.mli.is-link` is set from `href` alone, and the sheet's own comment says
    // the chevron comes with the destination or not at all.
    const { container } = renderPhone()
    expect(container.querySelectorAll(".mli.is-link")).toHaveLength(0)
  })

  /* ── What the phone drops ──────────────────────────────────────────── */

  it("draws NO Timeline, Platform or Needs you — all three are desk-only", () => {
    const { container } = renderPhone()
    expect(container.querySelector(".kv")).toBeNull()
    expect(container.querySelector(".queue")).toBeNull()
    expect(container.textContent).not.toContain("Timeline")
    expect(container.textContent).not.toContain("Needs you")
    expect(container.textContent).not.toContain("24FA9B55")
  })

  it("lets one section fail without taking the rest of the page with it", () => {
    const { container } = renderPhone({ items: failed("Otter timed out", "retryOrder") })
    expect(container.querySelector(".mlist")).toBeNull()
    expect(container.textContent).toContain("Otter timed out")
    expect(container.querySelectorAll(".moneyline")).toHaveLength(4)
  })
})

describe("Counter one order — the phone page", () => {
  const call = () => MobileOrderDetailPage({ params: Promise.resolve({ id: "nope" }) })

  it("404s on an id that does not exist or is not this account's", async () => {
    m.getOrderSections.mockResolvedValue(sections({ head: empty("no_match") }))
    await expect(call()).rejects.toThrow("NEXT_NOT_FOUND")
    expect(m.notFound).toHaveBeenCalledTimes(1)
  })

  it("does NOT 404 when the load FAILED — that is an outage, not a missing order", async () => {
    m.getOrderSections.mockResolvedValue(sections({ head: failed("db down", "retryOrder") }))
    await expect(call()).resolves.toBeTruthy()
    expect(m.notFound).not.toHaveBeenCalled()
  })

  it("calls the adapter exactly ONCE, with the id and the session's account", async () => {
    m.getOrderSections.mockResolvedValue(sections())
    await MobileOrderDetailPage({ params: Promise.resolve({ id: "1f708833" }) })
    expect(m.getOrderSections).toHaveBeenCalledTimes(1)
    expect(m.getOrderSections).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "1f708833", accountId: "acc_1" }),
    )
  })
})
