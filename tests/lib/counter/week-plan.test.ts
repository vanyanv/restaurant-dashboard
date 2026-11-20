import { describe, expect, it } from "vitest"
import {
  buildWeekPlan,
  defaultWeekFor,
  weatherWords,
  type PlanStoreDayInput,
  type PlanStoreInput,
  type WeekPlanInput,
} from "@/lib/counter/week-plan"

// Thursday 2026-11-19: this week is Mon 16 to Sun 22, next is Mon 23 to Sun 29.
const ASOF = "2026-11-19"
const THIS = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]
const NEXT = ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]

function fwd(key: string, over: Partial<PlanStoreDayInput> = {}): PlanStoreDayInput {
  return {
    key,
    forecast: 5000,
    actual: null,
    scheduled: 50,
    needed: 50,
    gap: 0,
    status: "level",
    hourly: [
      { hour: 17, needed: 6, staffed: 6 },
      { hour: 18, needed: 7, staffed: 7 },
    ],
    worst: null,
    ...over,
  }
}

function store(id: string, name: string, days: PlanStoreDayInput[], lastWeek: number | null = 35000): PlanStoreInput {
  return { id, name, days, lastWeek }
}

function base(over: Partial<WeekPlanInput> = {}): WeekPlanInput {
  const hw = store("hw", "Hollywood", [
    ...THIS.slice(0, 3).map((k) => ({ ...fwd(k), actual: 5200, status: "unknown" as const })),
    ...THIS.slice(3).map((k) => fwd(k)),
    ...NEXT.map((k) =>
      k === "2026-11-27"
        ? fwd(k, {
            scheduled: 41,
            gap: -9,
            status: "short",
            worst: { startHour: 17, endHour: 22 },
            hourly: [
              { hour: 17, needed: 8, staffed: 5 },
              { hour: 18, needed: 9, staffed: 5 },
            ],
          })
        : fwd(k),
    ),
  ])
  const gl = store(
    "gl",
    "Glendale",
    [...THIS.slice(3), ...NEXT].map((k) => fwd(k, { scheduled: 0, gap: null, status: "unscheduled" })),
    null,
  )
  return {
    asOf: ASOF,
    storeId: null,
    sales: [
      ...THIS.slice(0, 3).map((k) => ({
        key: k,
        forecast: 10000,
        p10: 9000,
        p90: 11000,
        actual: 10400,
        weatherPhrase: null,
        weatherHighC: null,
        event: null,
        attribution: null,
      })),
      ...[...THIS.slice(3), ...NEXT].map((k) => ({
        key: k,
        forecast: 10000,
        p10: 9000,
        p90: 11500,
        actual: null,
        weatherPhrase: "clear",
        weatherHighC: 22,
        event: k === "2026-11-27" ? "Pantages show" : null,
        attribution:
          k === "2026-11-27"
            ? { base: 9000, groups: [{ label: "Day of week", value: 1500 }, { label: "Weather", value: -300 }] }
            : null,
      })),
    ],
    lastWeek: 68000,
    stores: [hw, gl],
    runOut: [
      {
        key: "fries",
        name: "Fries",
        store: "Hollywood",
        outLabel: "Sat close",
        qty: "3 cases",
        href: "/dashboard/inventory",
        tag: "Order Fri",
        tagTone: "bad",
        forecastCoverDays: 3.4,
        flatCoverDays: 4,
        reorderLineDays: 2,
      },
    ],
    runOutNote: null,
    calls: [],
    accuracy: { inside: 23, sample: 28 },
    basePath: "/dashboard/decisions",
    ...over,
  }
}

describe("week plan", () => {
  it("opens on this week Monday to Wednesday and next week from Thursday", () => {
    expect(defaultWeekFor("2026-11-16")).toBe("this")
    expect(defaultWeekFor("2026-11-18")).toBe("this")
    expect(defaultWeekFor("2026-11-19")).toBe("next")
    expect(defaultWeekFor("2026-11-22")).toBe("next")
  })

  it("puts the weather in words with the high in Fahrenheit", () => {
    expect(weatherWords("rain expected", 17)).toBe("Rain expected, 63°")
    expect(weatherWords(null, null)).toBeNull()
  })

  it("adds this week's sold days to its forecast days, and says which is which", () => {
    const w = buildWeekPlan(base()).weeks.this
    expect(w.sales.value).toBe("$71,200")
    expect(w.sales.sub).toBe("$31,200 sold so far, $40,000 forecast for the rest")
    expect(w.days.map((d) => d.kind)).toEqual(["sold", "sold", "sold", "today", "forecast", "forecast", "forecast"])
    expect(w.sentence.map((s) => s.text).join("")).toContain("This week is on track for about $71,200")
  })

  it("never counts a store with no schedule as hours short, and says so", () => {
    const w = buildWeekPlan(base()).weeks.next
    // Only Hollywood's hours: 7 days, 50 needed each, Friday 9 short.
    expect(w.hours.value).toBe("341 h")
    expect(w.hours.sub).toBe("The forecast needs about 350 h")
    expect(w.hours.missing).toBe("Glendale has no schedule, not counted")
    const fri = w.days.find((d) => d.key === "2026-11-27")!
    expect(fri.staffing).toEqual({ tone: "bad", text: "Short 9 h" })
    expect(w.days[0].staffing).toEqual({ tone: "warn", text: "1 with no schedule" })
    const said = w.sentence.map((s) => s.text).join("")
    expect(said).toContain("Hollywood is 9 hours short, most of it Friday evening.")
    expect(said).toContain("Glendale has no schedule in Harri")
    expect(w.todos.map((t) => t.what)).toContain("Add 9 hours Friday · Hollywood")
    expect(w.todos.map((t) => t.what)).toContain("Post Glendale's schedule in Harri")
  })

  it("compares a week with last week's sales, and labels a store not counted", () => {
    const w = buildWeekPlan(base()).weeks.next
    expect(w.sales.value).toBe("$70,000")
    expect(w.sales.vs).toEqual({ change: "▲ 2.9%", tone: "up", against: "vs $68,000 sold last week" })
    const gl = w.stores.find((s) => s.id === "gl")!
    expect(gl.status).toEqual({ tone: "warn", label: "No schedule" })
    expect(gl.figures.find((f) => f.label === "Vs last week")!.value).toBe("not counted")
    expect(gl.href).toBe("/dashboard/decisions?store=gl&week=next")
  })

  it("explains a day from the model's own waterfall, and fills any rest", () => {
    const fri = buildWeekPlan(base()).weeks.next.days.find((d) => d.key === "2026-11-27")!
    expect(fri.detail.why).toEqual([
      { label: "An average day", value: "$9,000" },
      { label: "Day of week", value: "+$1,500" },
      { label: "Weather", value: "−$300" },
      { label: "Other adjustments", value: "−$200" },
      { label: "Forecast", value: "$10,000" },
    ])
    expect(fri.detail.range).toBe("Likely between $9,000 and $11,500")
    expect(fri.detail.hours!.map((h) => h.short)).toEqual([3, 4])
    expect(fri.event).toBe("Pantages show")
  })

  it("shows no reasons when they cover only part of the day", () => {
    const input = base()
    const fri = input.sales.find((d) => d.key === "2026-11-27")!
    fri.attribution = { base: 4000, groups: [{ label: "Day of week", value: 800 }] }
    const day = buildWeekPlan(input).weeks.next.days.find((d) => d.key === "2026-11-27")!
    expect(day.detail.why).toBeNull()
    expect(day.detail.whyNote).toContain("only part of this day")
  })

  it("puts an order on the day it is due and leads the sentence with it", () => {
    const w = buildWeekPlan(base()).weeks.this
    // 3.4 days of cover, 2-day reorder line: order by Thursday + 1 = Friday.
    const order = w.todos.find((t) => t.kind === "Order")!
    expect(order.due).toBe("2026-11-20")
    expect(w.days.find((d) => d.key === "2026-11-20")!.ordersDue).toBe(1)
    expect(w.sentence.map((s) => s.text).join("")).toContain("Fries at Hollywood runs out Sat close unless you order by Friday.")
  })

  it("leaves a store with no forecast out of the total and says so", () => {
    const input = base()
    input.stores.push(store("vn", "Van Nuys", []))
    const w = buildWeekPlan(input).weeks.next
    expect(w.sales.missing).toContain("Van Nuys not forecast yet")
    expect(w.sentence.map((s) => s.text).join("")).toContain("Van Nuys has no forecast yet, so it is not in the total.")
    expect(w.stores.find((s) => s.id === "vn")!.status.label).toBe("No forecast yet")
  })

  it("drops the change on last week when a closed day is not counted yet", () => {
    const input = base()
    input.sales[0].actual = null
    const w = buildWeekPlan(input).weeks.this
    expect(w.sales.vs).toBeNull()
    expect(w.sales.missing).toContain("1 closed day not counted yet")
  })

  it("drops the change on last week when a store is left out of the total", () => {
    const input = base()
    input.stores.push(store("vn", "Van Nuys", []))
    expect(buildWeekPlan(input).weeks.next.sales.vs).toBeNull()
  })

  it("says a store that did not load did not load, never that it has no forecast", () => {
    const input = base()
    input.stores.push({ ...store("vn", "Van Nuys", []), failed: true })
    const w = buildWeekPlan(input).weeks.next
    expect(w.sentence.map((s) => s.text).join("")).not.toContain("Van Nuys")
    expect(w.stores.find((s) => s.id === "vn")!.status).toEqual({ tone: "wait", label: "Didn't load" })
  })

  it("does not let one store's spare hours cover another store's short hours", () => {
    const input = base()
    input.stores[1] = store(
      "gl",
      "Glendale",
      NEXT.map((k) => fwd(k, { hourly: [{ hour: 17, needed: 5, staffed: 8 }, { hour: 18, needed: 7, staffed: 7 }] })),
    )
    const fri = buildWeekPlan(input).weeks.next.days.find((d) => d.key === "2026-11-27")!
    expect(fri.detail.hours!.map((h) => h.short)).toEqual([3, 4])
  })

  it("shows no total, not $0, when nothing was forecast", () => {
    const w = buildWeekPlan(base({ sales: [] })).weeks.next
    expect(w.sales.value).toBeNull()
    expect(w.sales.missing).toBe("no forecast yet")
    expect(w.days.every((d) => d.kind === "none" && d.amount === null)).toBe(true)
  })
  it("keeps an order in the week it is due, not the week after", () => {
    const plan = buildWeekPlan(base())
    expect(plan.weeks.this.todos.some((t) => t.kind === "Order")).toBe(true)
    expect(plan.weeks.next.todos.some((t) => t.kind === "Order")).toBe(false)
  })

  it("drops the change on last week when a store is missing some days ahead", () => {
    const input = base()
    const hw = input.stores[0]
    hw.days = hw.days.map((d) => (d.key === "2026-11-29" ? { ...d, forecast: null } : d))
    const w = buildWeekPlan(input).weeks.next
    expect(w.sales.vs).toBeNull()
    expect(w.sales.missing).toContain("Hollywood not forecast for Sunday yet")
    expect(w.stores.find((s) => s.id === "hw")!.figures.find((f) => f.label === "Vs last week")!.value).toBe("not counted")
  })

  it("leaves an hour out of the chart when the forecast has no row for it", () => {
    const input = base()
    const hw = input.stores[0]
    hw.days = hw.days.map((d) =>
      d.key === "2026-11-27" ? { ...d, hourly: [{ hour: 17, needed: 8, staffed: 5 }, { hour: 18, needed: null, staffed: 5 }] } : d,
    )
    const fri = buildWeekPlan(input).weeks.next.days.find((d) => d.key === "2026-11-27")!
    expect(fri.detail.hours!.map((h) => h.hour)).toEqual([17])
  })

  it("asks for one store when only some stores wrote their reasons", () => {
    const input = base()
    input.sales = input.sales.map((d) => (d.key === "2026-11-27" ? { ...d, attribution: null, partialWhy: true } : d))
    const fri = buildWeekPlan(input).weeks.next.days.find((d) => d.key === "2026-11-27")!
    expect(fri.detail.why).toBeNull()
    expect(fri.detail.whyNote).toContain("only some stores")
  })
})
