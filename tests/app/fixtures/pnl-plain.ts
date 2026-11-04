/** The P&L "made plain" section as both page tests hand it to the islands. */
import { serializeWeekWindow, type WeekWindow } from "@/lib/counter/date-range"
import type { PlainLine, PnlPlain } from "@/lib/counter/pnl-plain"

export function plainFixture(WEEKS: WeekWindow[], storeIds: [string, string] = ["hollywood", "glendale"]): PnlPlain {
const PLAIN_WEEKS = WEEKS.map((w, i) => ({
  window: serializeWeekWindow(w),
  label: `${w.start.getMonth() + 1}/${w.start.getDate()}`,
  sales: 80_000 + i * 500,
  kept: 20_000 + i * 400,
  keptPct: 0.25,
  atMost: i === 7,
}))

const line = (key: PlainLine["key"], label: string, amount: number, how: string, tone: PlainLine["tone"] = "ok"): PlainLine => ({
  key, label, amount, share: amount / 84_102, changePts: key === "fees" ? -1.2 : 0.4, how, tone,
})

return {
  sales: 84_102,
  kept: 23_916,
  keptPct: 0.284,
  atMost: "at most · 2 Glendale days of labor missing",
  vsPrior: { label: "Oct 19 – 25", kept: 4_413, pts: 2.6, sales: 8_493 },
  sentence: "You kept 28¢ of every dollar on $84,102 in sales. Some labor is missing, so the true number is lower.",
  statuses: [
    { tone: "ok", text: "Sales: from Otter" },
    { tone: "bad", text: "Labor: 2 store-days missing" },
  ],
  todos: [
    { tone: "bad", title: "Labor is missing", items: ["Glendale: no Harri labor on 2 days with sales."], action: { label: "Open Labor", href: "/dashboard/labor" } },
    { tone: "warn", title: "Fill in store settings", items: ["Not on file: Glendale cleaning."], action: { label: "Open store settings", href: `/dashboard/stores/${storeIds[1]}` } },
  ],
  lines: [
    line("fees", "App fees", 10_650, "18% real fees, the rest at your rates", "warn"),
    line("food", "Food", 20_766, "recipe cost of what sold"),
    line("labor", "Labor", 21_349, "2 days missing", "bad"),
    line("fixed", "Rent & fixed", 7_421, "1 not on file", "warn"),
    line("kept", "Kept", 23_916, "at most"),
  ],
  weeks: PLAIN_WEEKS,
  days: [
    {
      date: "2026-08-24", label: "Mon 8/24", short: "Mon", sales: 9_140, kept: 1_963, keptPct: 0.215, atMost: false, best: false, laborMissing: [],
      lines: [line("fees", "App fees", 1_356, "of app orders"), line("food", "Food", 2_305, "recipe cost"), line("labor", "Labor", 2_456, "from Harri"), line("fixed", "Rent & fixed", 1_060, "one day"), line("kept", "Kept", 1_963, "what is left")],
      stores: [
        { storeId: storeIds[0], name: "Hollywood", sales: 5_849, kept: 1_846, laborMissing: false },
        { storeId: storeIds[1], name: "Glendale", sales: 3_291, kept: 117, laborMissing: false },
      ],
    },
    {
      date: "2026-08-25", label: "Tue 8/25", short: "Tue", sales: 9_831, kept: 2_364, keptPct: 0.24, atMost: true, best: true, laborMissing: ["Glendale"],
      lines: [line("labor", "Labor", 2_486, "no Harri labor for Glendale", "bad"), line("kept", "Kept", 2_364, "at most")],
      stores: [
        { storeId: storeIds[0], name: "Hollywood", sales: 6_573, kept: 2_335, laborMissing: false },
        { storeId: storeIds[1], name: "Glendale", sales: 6, kept: -291, laborMissing: true },
      ],
    },
  ],
  stores: [
    { storeId: storeIds[0], name: "Hollywood", sales: 47_977, kept: 15_786, keptPct: 0.329, keptChange: -698, food: 0.24, labor: 0.23, fees: 0.14, atMost: false, flags: [] },
    { storeId: storeIds[1], name: "Glendale", sales: 9_681, kept: 3_629, keptPct: 0.375, keptChange: null, food: 0.27, labor: 0.1, fees: 0.04, atMost: true, flags: ["2 days of labor missing"] },
  ],
}
}
