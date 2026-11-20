// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { LaborDetail, LaborDetailView, LaborWeeksBlock } from "@/app/dashboard/(counter)/labor/labor-summary-ui"
import { buildLaborSummary, buildLaborWeeks } from "@/lib/counter/labor-summary"
import { buildLaborClock, buildLaborHours, buildLaborPeople, type LaborCrew } from "@/lib/counter/labor-crew"
import type { LaborDay, LaborTrendWeek, LaborWeek } from "@/lib/counter/labor-week"

const DAYS: Array<[string, string, number, number, number]> = [
  ["2026-11-09", "Mon Nov 9", 6400, 2050, 112],
  ["2026-11-10", "Tue Nov 10", 6100, 2010, 110],
  ["2026-11-11", "Wed Nov 11", 6900, 2070, 113],
  ["2026-11-12", "Thu Nov 12", 7300, 2120, 116],
  ["2026-11-13", "Fri Nov 13", 9800, 2450, 132],
  ["2026-11-14", "Sat Nov 14", 10600, 2540, 138],
  ["2026-11-15", "Sun Nov 15", 8700, 0, 0],
]
const days: LaborDay[] = DAYS.map(([key, label, sales, cost, hours]) => ({
  key,
  label,
  actualHours: hours,
  scheduledHours: null,
  cost,
  missingStoreDays: cost === 0 ? 2 : 0,
  costMissing: cost === 0,
  ratedSales: cost === 0 ? 0 : sales,
  splh: hours > 0 ? sales / hours : null,
  laborPct: cost === 0 ? null : (cost / sales) * 100,
  totalSales: sales,
  compare: null,
  awaitingStoreDays: 0,
}))
const week = {
  days,
  actualHours: 721,
  scheduledHours: null,
  cost: 13240,
  missingStoreDays: 2,
  blendedRate: 18.4,
  splh: 65.3,
  laborPct: 28.1,
  overtimeCost: 378,
  compare: null,
  awaitingDays: [],
  awaitingStoreDays: 0,
  provisionalDays: ["Sat Nov 14"],
} satisfies LaborWeek

const summary = buildLaborSummary({
  days,
  week,
  roles: [
    { position: "Line cook", payType: "HOURLY", hours: 410, cost: 7380, share: 47.3 },
    { position: "Cashier", payType: "HOURLY", hours: 262, cost: 4560, share: 29.2 },
    { position: "Shift lead", payType: "HOURLY", hours: 118, cost: 2480, share: 15.9 },
  ],
  storeShares: [
    { storeId: "h", name: "Hollywood", cost: 8330, ratedSales: 31200, laborPct: 26.7 },
    { storeId: "v", name: "Van Nuys", cost: 7280, ratedSales: 24600, laborPct: 29.6 },
    { storeId: "g", name: "Glendale", cost: 1090, ratedSales: 13300, laborPct: 8.2 },
  ],
  incompleteStoreIds: ["g"],
})

const PCTS = [26.1, 25.8, 27.2, 26.4, 25.9, 26.8, 27.5, 26.2, 26.6, 27.1, 26.9, 28.0]
const trend: LaborTrendWeek[] = PCTS.map((p, i) => {
  const start = new Date(2026, 7, 24 + i * 7)
  const end = new Date(2026, 7, 30 + i * 7)
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  const sales = 48000 + ((i * 7919) % 9000)
  return {
    key: iso(start),
    end: iso(end),
    label: `${start.getMonth() + 1}/${start.getDate()}`,
    cost: i === 3 ? 0 : (sales * p) / 100,
    hours: i === 3 ? 0 : 800 + i * 5,
    sales,
    laborPct: i === 3 ? 0 : p,
    splh: i === 3 ? null : sales / (800 + i * 5),
    missingStoreDays: i === 1 ? 3 : 0,
    isPartial: false,
  }
})
const weeks = buildLaborWeeks(trend, "2026-11-09", "2026-11-15")

const crew: LaborCrew = {
  stores: [
    { id: "h", name: "Hollywood" },
    { id: "v", name: "Van Nuys" },
    { id: "g", name: "Glendale" },
  ],
  shifts: [
    ...Array.from({ length: 6 }, () => ({ storeId: "h", userId: 1, minutes: 450, weekStart: "2026-11-09" })),
    ...Array.from({ length: 5 }, () => ({ storeId: "h", userId: 2, minutes: 420, weekStart: "2026-11-09" })),
    ...Array.from({ length: 5 }, () => ({ storeId: "v", userId: 3, minutes: 390, weekStart: "2026-11-09" })),
    ...Array.from({ length: 4 }, () => ({ storeId: "v", userId: 4, minutes: 360, weekStart: "2026-11-09" })),
    ...Array.from({ length: 3 }, () => ({ storeId: "g", userId: 5, minutes: 300, weekStart: "2026-11-09" })),
  ],
  weeks: [{ userId: 1, weekStart: "2026-11-09", minutes: 2700 }],
  alerts: [
    { storeId: "v", userId: 3, alertCode: "MISSED_CLOCK_OUT_OT_NOW" },
    { storeId: "v", userId: 4, alertCode: "MISSED_CLOCK_OUT_OT_NOW" },
    { storeId: "v", userId: 4, alertCode: "LATE_CLOCK_IN" },
    { storeId: "h", userId: 2, alertCode: "MISSED_CLOCK_IN" },
  ],
  names: [
    { userId: 1, firstName: "Sample", lastName: "One" },
    { userId: 2, firstName: "Sample", lastName: "Two" },
    { userId: 3, firstName: "Sample", lastName: "Three" },
    { userId: 4, firstName: "Sample", lastName: "Four" },
  ],
}
const people = buildLaborPeople(crew)!
const clock = buildLaborClock(crew)
const hours = buildLaborHours(
  {
    hours: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22].map((hour, i) => ({
      hour,
      scheduled: [3, 5, 5, 4, 3, 3, 5, 6, 6, 5, 4, 3][i],
      demand: [14, 31, 28, 17, 11, 12, 26, 38, 35, 24, 15, 8][i],
    })),
    tightest: 18,
    sentence: "6 PM is the tightest hour: 38 orders forecast with 6 people on the schedule.",
  },
  "Mon, Nov 16",
)
const leaks = {
  rows: [
    { key: "LATE_CLOCK_OUT", leak: "Clocked out late", kind: "leak", alerts: "14", hours: "6.2 h", cost: "$114", people: "8" },
    { key: "EARLY_CLOCK_IN", leak: "Clocked in early", kind: "leak", alerts: "9", hours: "2.1 h", cost: "$39", people: "5" },
    { key: "LATE_CLOCK_IN", leak: "Clocked in late", kind: "short", alerts: "1", hours: "0.4 h", cost: "$7", people: "1" },
    { key: "MISSED_CLOCK_OUT_OT_NOW", leak: "Missed clock-out", kind: "uncostable", alerts: "2", hours: "—", cost: "—", people: "2" },
  ],
  total: { hours: "8.3 h", cost: "$153" },
  items: [],
  fixes: [],
  meta: "",
  note: "Missed punches carry no duration in Harri, so they are counted and never given a dollar figure.",
}

describe("Labor detail views", () => {
  it("draws each day, the stores and the roles, with missing said in words", () => {
    const onStore = vi.fn()
    const { container } = render(<LaborDetailView s={summary} onStore={onStore} />)
    expect(container.querySelectorAll(".cu-bars--cells .cu-bar")).toHaveLength(7)
    expect(container.querySelector('.cu-bar[data-hatched="true"] .cu-bar__value')?.textContent).toBe("missing")
    expect(screen.getByText("so far")).toBeTruthy()
    fireEvent.click(screen.getByText("Van Nuys"))
    expect(onStore).toHaveBeenCalledWith("v")
    expect(screen.getByText("Labor looks incomplete")).toBeTruthy()
    expect(screen.getByText(/Overtime paid: \$378/)).toBeTruthy()
  })

  it("opens a tapped week as a Monday-to-Sunday range and compares any two weeks", () => {
    const onWeek = vi.fn()
    const { container } = render(<LaborWeeksBlock w={weeks} onWeek={onWeek} />)
    const bars = container.querySelectorAll<HTMLButtonElement>(".cu-split__b")
    expect(bars).toHaveLength(12)
    expect(bars[11].getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(bars[9])
    const r = onWeek.mock.calls[0][0] as { start: Date; end: Date }
    expect([r.start.getMonth(), r.start.getDate(), r.end.getMonth(), r.end.getDate()]).toEqual([9, 26, 10, 1])

    const share = () => Array.from(container.querySelectorAll(".cu-cmp__row")).find((x) => x.textContent?.includes("share of sales"))
    expect(share()?.textContent).toContain("28.0%26.9%▲ 1.1 pts")
    fireEvent.change(screen.getByLabelText("Against"), { target: { value: trend[3].key } })
    expect(share()?.textContent).toContain("28.0%missing")

  })

  it("splits the page into short tabs and draws only the open one", () => {
    const ready = <T,>(data: T) => ({ status: "ready" as const, data })
    const { container } = render(
      <LaborDetail
        lead={<p>the sentence</p>}
        sections={{ summary: ready(summary), weeks: ready(weeks), hours: ready(hours), people: ready(people), clock: ready(clock), leaks: ready(leaks) } as never}
        pending={false}
        onWeek={() => {}}
        onStore={() => {}}
      />,
    )
    expect(screen.getByText("the sentence")).toBeTruthy()
    expect(container.querySelectorAll(".cu-bar")).toHaveLength(7)
    expect(container.querySelector(".cu-split")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Compare weeks" }))
    expect(screen.queryByText("the sentence")).toBeNull()
    expect(container.querySelectorAll(".cu-split__b")).toHaveLength(12)

    fireEvent.click(screen.getByRole("button", { name: "Stores and roles" }))
    expect(screen.getByText("Hollywood")).toBeTruthy()
    expect(container.querySelector(".cu-split")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Hours" }))
    expect(container.querySelectorAll(".cu-bar")).toHaveLength(12)
    expect(screen.getByText("tightest hour")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "People" }))
    expect(container.querySelectorAll(".cu-rows tbody tr")).toHaveLength(5)
    expect(screen.getByText("Sample O.")).toBeTruthy()
    expect(screen.getByText("45 h the week of Nov 9")).toBeTruthy()
    expect(screen.queryByText("Sample One")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Time clock" }))
    expect(container.querySelectorAll(".cu-bar")).toHaveLength(3)
    expect(screen.getByText("Clocked out late")).toBeTruthy()
    // Late in is not a cost and a missed punch has no duration: neither is in the paid-for table.
    expect(screen.queryByText("Clocked in late")).toBeNull()
    expect(screen.queryByText("Missed clock-out")).toBeNull()
    expect(screen.getByText(/Paid for outside the schedule: 8.3 h, \$153/)).toBeTruthy()
  })
})