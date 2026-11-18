// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

let PATH = "/dashboard/alerts"
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => PATH,
  useSearchParams: () => new URLSearchParams(),
}))

import { AlertsPlainView } from "@/app/dashboard/(counter)/alerts/alerts-plain-ui"
import { DecisionsPlainView } from "@/app/dashboard/(counter)/decisions/decisions-plain-ui"
import { buildAlertsPlain } from "@/lib/counter/alerts-plain"
import { buildDecisionsPlain } from "@/lib/counter/decisions-plain"

const ALERTS = buildAlertsPlain({
  openRows: [
    { target: "INGREDIENT", severity: "CRITICAL" },
    { target: "MENU_ITEM", severity: "WATCH" },
    { target: "MENU_ITEM", severity: "WATCH" },
  ],
  serious: [{ id: "a1", title: "Ground beef is up 18%", body: null, run: null }],
  counts: { open: 3, critical: 1 },
  closed: 0,
})

const DECISIONS = buildDecisionsPlain({
  total: 112_400,
  vsPrior: 0.061,
  vsText: "▲ 6.1% on last week",
  accuracy: { inside: 24, sample: 30 },
  laborGapHours: 0,
  laborShort: false,
  runOut: { rows: [{ key: "f", name: "Fries", store: "Van Nuys", outLabel: "Thu 11/20 lunch", qty: "2 cases", href: "/dashboard/count/item/f", tagTone: "bad" }] },
  calls: [{ key: "c1", title: "Add a closer on Saturday", why: "Short 11 hours.", lead: "$420", unit: "/wk", note: "decays daily", act: "Open labor", href: "/dashboard/labor" }],
})

describe("Alerts made plain", () => {
  it("leads with the sentence, lists the serious one with a button, and folds the rest into groups", () => {
    PATH = "/dashboard/alerts"
    const onOpen = vi.fn()
    const { container } = render(<AlertsPlainView p={ALERTS} onOpen={onOpen} />)
    expect(container.querySelector(".cu-answer")!.textContent).toContain("3 alerts are open.")
    fireEvent.click(screen.getByRole("button", { name: "Open it" }))
    expect(onOpen).toHaveBeenCalledWith("a1")
    const needs = container.querySelector("details.cu-needs") as HTMLDetailsElement
    expect(needs.open).toBe(false)
    expect(needs.querySelector("a")!.getAttribute("href")).toBe("/dashboard/menu/items")
  })

  it("keeps a phone reader on the phone", () => {
    PATH = "/m/alerts"
    const { container } = render(<AlertsPlainView p={ALERTS} onOpen={() => {}} />)
    expect(container.querySelector("details.cu-needs a")!.getAttribute("href")).toBe("/m/menu/items")
  })
})

describe("Decisions made plain", () => {
  it("shows the week's expected sales, what runs out and the calls, each with one button", () => {
    PATH = "/dashboard/decisions"
    const { container } = render(<DecisionsPlainView p={DECISIONS} />)
    expect(container.querySelector(".cu-big__value")!.firstChild!.textContent).toBe("$112,400")
    expect(container.querySelector(".cu-vs--up")!.textContent).toBe("▲ 6.1% on last week")
    expect(screen.getByRole("link", { name: "Order" }).getAttribute("href")).toBe("/dashboard/count/item/f")
    expect(screen.getByRole("link", { name: "Open labor" }).getAttribute("href")).toBe("/dashboard/labor")
  })
})
