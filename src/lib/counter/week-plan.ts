import { count, money, moneyCompact } from "@/lib/counter/format"
import { parseDayKey, weekDayKeys, weekLabel } from "@/lib/counter/week-window"

/**
 * The Week ahead page as a plan (owner's go on the mock, 2026-11-20:
 * https://claude.ai/artifact/9X3YWGHNAKdimeJh6ToQNF): this week and next,
 * each day with its sales (sold solid, forecast tagged), weather, events and
 * staffing in words; what a day's number is made of and which hours are
 * short; three store cards; and the week's to-do list.
 *
 * It forecasts nothing and counts no hours of its own. Every figure is one
 * the Decisions loader already decided: `predictedRevenue`, `p10`/`p90`,
 * the labor lane (`scheduledHours`, `neededHours`, `gapHours`, `status`), the
 * hourly cover, the attribution waterfall, the reconciled actuals and the
 * shelf's run-out rows. This file sums them over a week and puts them in
 * words. Missing is never zero: a store with no schedule says "No schedule"
 * and is left out of the hours, and a store with no forecast is left out of
 * the total, and the sentence says so.
 */

export type PlanTone = "good" | "warn" | "bad" | "wait"
export type PlanWeekKey = "this" | "next"

/** The scoped sales for one day, from the loader (forward) or the settled read (closed). */
export interface PlanSalesDayInput {
  key: string
  forecast: number | null
  p10: number | null
  p90: number | null
  /** Sold, from reconciliation. Null on a forward day, or a closed day not reconciled yet. */
  actual: number | null
  weatherPhrase: string | null
  weatherHighC: number | null
  /** Only an event the signal ranked major. */
  event: string | null
  attribution: { base: number; groups: Array<{ label: string; value: number }> } | null
  /**
   * True when some stores in view wrote reasons for this day and others did
   * not, so `attribution` was withheld rather than shown as a partial story.
   */
  partialWhy?: boolean
}

export type PlanLaborStatus = "short" | "level" | "heavy" | "unscheduled" | "unknown"

/** One store's day: its own forecast, labor lane and hourly cover. */
export interface PlanStoreDayInput {
  key: string
  forecast: number | null
  actual: number | null
  scheduled: number
  needed: number | null
  gap: number | null
  status: PlanLaborStatus
  hourly: Array<{ hour: number; needed: number | null; staffed: number }>
  worst: { startHour: number; endHour: number } | null
}

export interface PlanStoreInput {
  id: string
  name: string
  days: PlanStoreDayInput[]
  /** Sold Monday to Sunday last week, or null when any day is not reconciled. */
  lastWeek: number | null
  /** Its days could not be read. Never treated as "no forecast". */
  failed?: boolean
}

export interface PlanRunOutInput {
  key: string
  name: string
  store: string | null
  outLabel: string
  qty: string
  href: string
  tag: string
  tagTone: string
  forecastCoverDays: number | null
  flatCoverDays: number | null
  reorderLineDays: number
}

export interface PlanCallInput {
  key: string
  title: string
  why: string
  act?: string
  href?: string
}

export interface WeekPlanInput {
  /** Today, YYYY-MM-DD, the loader's own day. */
  asOf: string
  /** The store the page is scoped to, or null for every store. */
  storeId: string | null
  /** This Monday through next Sunday for the scope. Days with no source are left out. */
  sales: PlanSalesDayInput[]
  /** Scope's sales last Monday to Sunday, or null when not every day is reconciled. */
  lastWeek: number | null
  /** Every store in the account, for the cards; the scope's are the ones counted. */
  stores: PlanStoreInput[]
  /** The shelf's rows for the scope, or null when it could not be read. */
  runOut: PlanRunOutInput[] | null
  runOutNote: string | null
  calls: PlanCallInput[]
  accuracy: { inside: number | null; sample: number }
  /** Desk path of this page; hrefs are built on it. */
  basePath: string
}

export interface PlanTodo {
  key: string
  kind: "Order" | "Schedule" | "Calls"
  what: string
  why: string
  /** The day it is due, when it has one. */
  due: string | null
  action: { label: string; href: string } | null
  bad: boolean
}

export interface PlanHourBar {
  hour: number
  label: string
  staffed: number
  short: number
}

export interface PlanDayDetail {
  /** "What makes this number", top to bottom. Null when the model wrote no reasons. */
  why: Array<{ label: string; value: string }> | null
  /** One line under the reasons, or in their place. */
  whyNote: string
  /** "Likely between $12,100 and $14,300", or null. */
  range: string | null
  /** People against need, per hour. Null when no scoped store has a schedule to compare. */
  hours: PlanHourBar[] | null
  /** One sentence per store about that day's hours. */
  hoursNotes: Array<{ tone: PlanTone; text: string }>
  stores: Array<{ id: string; name: string; amount: string; status: { tone: PlanTone; text: string } | null }>
}

export interface PlanDay {
  key: string
  /** "Mon" */
  dow: string
  /** "23" */
  date: string
  /** "Monday, Nov 23" */
  full: string
  /** "Monday" */
  weekday: string
  kind: "sold" | "today" | "forecast" | "none"
  /** Sold on a sold day, the forecast otherwise; null when neither exists. */
  amount: number | null
  /** "$13.2K" */
  short: string
  p10: number | null
  p90: number | null
  weather: string | null
  event: string | null
  staffing: { tone: PlanTone; text: string }
  /** Orders due that day. */
  ordersDue: number
  detail: PlanDayDetail
}

export interface PlanStoreCard {
  id: string
  name: string
  href: string
  status: { tone: PlanTone; label: string }
  figures: Array<{ label: string; value: string }>
  note: string
}

export interface PlanFigure {
  value: string | null
  vs: { change: string; tone: "up" | "down" | "flat"; against: string } | null
  sub: string
  missing?: string
}

export interface PlanWeek {
  key: PlanWeekKey
  /** "This week" */
  name: string
  /** "Nov 23 – 29" */
  label: string
  sentence: Array<{ text: string; strong?: boolean }>
  sales: PlanFigure
  hours: PlanFigure
  todo: PlanFigure
  days: PlanDay[]
  todos: PlanTodo[]
  stores: PlanStoreCard[]
  /** The day the detail opens on. */
  defaultDay: string | null
}

export interface WeekPlan {
  defaultWeek: PlanWeekKey
  weeks: Record<PlanWeekKey, PlanWeek>
  scope: { id: string | null; name: string }
  scopes: Array<{ key: string; label: string; href: string }>
  shelf: Array<{ key: string; what: string; why: string; tone: PlanTone; tag: string }>
  shelfNote: string | null
  accuracy: { tone: PlanTone; text: string }
}

/** Above this share of the forecast unexplained, the reasons are not shown. */
const WHY_REST_LIMIT = 0.1

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const hrs = (h: number) => {
  const r = Math.round(h * 10) / 10
  return Number.isInteger(r) ? count(r) : r.toFixed(1)
}
const hoursWord = (h: number) => `${hrs(h)} ${Math.round(h * 10) === 10 ? "hour" : "hours"}`
const pctWords = (v: number) => `${(Math.abs(v) * 100).toFixed(1).replace(/\.0$/, "")}%`

function addDays(key: string, n: number): string {
  const d = parseDayKey(key)
  if (d === null) return key
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function weekdayOf(key: string): string {
  const d = parseDayKey(key)
  return d === null ? key : WEEKDAY[d.getUTCDay()]
}

function fullDate(key: string): string {
  const d = parseDayKey(key)
  return d === null ? key : `${WEEKDAY[d.getUTCDay()]}, ${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/** "2pm", "11am", "12am". */
export function clockWord(hour: number): string {
  const h = ((hour % 24) + 24) % 24
  const twelve = h % 12 === 0 ? 12 : h % 12
  return `${twelve}${h < 12 ? "am" : "pm"}`
}

/** "Clear, 71°" — the loader's phrase with the day's high in Fahrenheit. */
export function weatherWords(phrase: string | null, highC: number | null): string | null {
  if (phrase === null && highC === null) return null
  const head = phrase ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : null
  const temp = highC === null ? null : `${Math.round((highC * 9) / 5 + 32)}°`
  return [head, temp].filter(Boolean).join(", ")
}

/** Which week the page opens on: this week Monday to Wednesday, next week from Thursday. */
export function defaultWeekFor(asOf: string): PlanWeekKey {
  const d = parseDayKey(asOf)
  if (d === null) return "this"
  const dow = d.getUTCDay()
  return dow >= 1 && dow <= 3 ? "this" : "next"
}

/** One store's day, in words. */
export function staffWord(d: PlanStoreDayInput | undefined): { tone: PlanTone; text: string } {
  if (d === undefined || d.forecast === null) return { tone: "wait", text: "No forecast" }
  switch (d.status) {
    case "short":
      return { tone: "bad", text: `Short ${hrs(Math.abs(d.gap ?? 0))} h` }
    case "unscheduled":
      return { tone: "warn", text: "No schedule" }
    case "unknown":
      return { tone: "wait", text: "Hours not checked" }
    default:
      return { tone: "good", text: "Covered" }
  }
}

const shortOf = (d: PlanStoreDayInput | undefined) =>
  d !== undefined && d.forecast !== null && d.status === "short" ? Math.abs(d.gap ?? 0) : 0

/** Order-by and run-out days for a shelf row, counted from today. */
function orderDays(r: PlanRunOutInput, asOf: string): { orderBy: string; out: string } | null {
  const cover = r.forecastCoverDays ?? r.flatCoverDays
  if (cover === null) return null
  return {
    orderBy: addDays(asOf, Math.max(0, Math.floor(cover - r.reorderLineDays))),
    out: addDays(asOf, Math.max(0, Math.floor(cover))),
  }
}

const needsOrder = (r: PlanRunOutInput) => r.tagTone === "bad" || /^order/i.test(r.tag)

function toneOf(t: string): PlanTone {
  return t === "bad" || t === "warn" || t === "good" ? t : "wait"
}

function listWords(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

function partOfDay(hour: number): string {
  if (hour < 11) return "morning"
  if (hour < 15) return "midday"
  if (hour < 17) return "afternoon"
  return "evening"
}

/** Hours 0 and 1 close the trading day that opened the morning before. */
const clockOrder = (hour: number) => (hour <= 1 ? hour + 24 : hour)

export function buildWeekPlan(input: WeekPlanInput): WeekPlan {
  const asOfDate = parseDayKey(input.asOf)
  const thisKeys = asOfDate === null ? [] : weekDayKeys(asOfDate)
  const nextKeys = thisKeys.length === 0 ? [] : weekDayKeys(parseDayKey(addDays(thisKeys[0], 7))!)
  const scoped = input.stores.filter((s) => input.storeId === null || s.id === input.storeId)
  const scopeName =
    input.storeId === null
      ? "All stores"
      : (input.stores.find((s) => s.id === input.storeId)?.name ?? "This store")
  const salesByDay = new Map(input.sales.map((d) => [d.key, d]))

  const href = (storeId: string | null, week?: PlanWeekKey) => {
    const q = new URLSearchParams()
    if (storeId) q.set("store", storeId)
    if (week) q.set("week", week)
    const s = q.toString()
    return s ? `${input.basePath}?${s}` : input.basePath
  }

  // The shelf, scoped. Rows name a store only when more than one is in view.
  const shelfRows = input.runOut ?? []
  const storeOfRow = (r: PlanRunOutInput) => r.store ?? (input.storeId ? scopeName : null)
  const orderTodos: PlanTodo[] = shelfRows.filter(needsOrder).map((r) => {
    const days = orderDays(r, input.asOf)
    const store = storeOfRow(r)
    const by = days ? (days.orderBy <= input.asOf ? "today" : `by ${weekdayOf(days.orderBy)}`) : null
    return {
      key: `order-${r.key}`,
      kind: "Order",
      what: `Order ${r.name}${store ? ` · ${store}` : ""}`,
      why: `Runs out ${r.outLabel}${by ? `. Order ${by}` : ""}${r.qty ? ` · bring in ${r.qty}` : ""}`,
      due: days?.orderBy ?? null,
      action: { label: "Order", href: r.href },
      bad: r.tagTone === "bad",
    }
  })
  orderTodos.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"))

  const callTodos: PlanTodo[] = input.calls.map((c) => ({
    key: `call-${c.key}`,
    kind: "Calls",
    what: c.title,
    why: c.why,
    due: null,
    action: c.href && c.act ? { label: c.act, href: c.href } : null,
    bad: false,
  }))

  const buildWeek = (key: PlanWeekKey, keys: string[]): PlanWeek => {
    const name = key === "this" ? "This week" : "Next week"
    const label = keys.length > 0 ? weekLabel(parseDayKey(keys[0])!) : ""
    const storeDay = (s: PlanStoreInput, k: string) => s.days.find((d) => d.key === k)
    // Days whose hours can still change: today and after.
    const aheadKeys = keys.filter((k) => k >= input.asOf)
    // Orders belong to the week they are due in. This week also keeps the
    // undated and the overdue ones; next week only shows its own.
    const lastKey = keys[keys.length - 1] ?? ""
    const weekOrders = orderTodos.filter((t) =>
      key === "this" ? t.due === null || t.due <= lastKey : t.due !== null && keys.includes(t.due),
    )

    /* ── To-dos for this week's window ── */
    const scheduleTodos: PlanTodo[] = []
    for (const s of scoped) {
      const unposted = aheadKeys.filter((k) => {
        const d = storeDay(s, k)
        return d !== undefined && d.forecast !== null && d.status === "unscheduled"
      })
      if (unposted.length > 0) {
        scheduleTodos.push({
          key: `post-${key}-${s.id}`,
          kind: "Schedule",
          what: `Post ${s.name}'s schedule in Harri`,
          why:
            unposted.length === aheadKeys.length
              ? `No shifts are posted for ${key === "this" ? "the rest of this week" : "next week"}, so its hours can't be checked`
              : `No shifts are posted for ${listWords(unposted.map(weekdayOf))}, so those days can't be checked`,
          due: unposted[0],
          action: { label: "See labor", href: "/dashboard/labor" },
          bad: false,
        })
      }
      for (const k of aheadKeys) {
        const d = storeDay(s, k)
        const short = shortOf(d)
        if (short <= 0 || d === undefined) continue
        scheduleTodos.push({
          key: `short-${s.id}-${k}`,
          kind: "Schedule",
          what: `Add ${hoursWord(short)} ${weekdayOf(k)} · ${s.name}`,
          why: d.worst
            ? `Short between ${clockWord(d.worst.startHour)} and ${clockWord(d.worst.endHour)}. ${hrs(d.scheduled)} h posted, the forecast needs about ${hrs(d.needed ?? 0)} h`
            : `${hrs(d.scheduled)} h posted, the forecast needs about ${hrs(d.needed ?? 0)} h`,
          due: k,
          action: { label: "See labor", href: "/dashboard/labor" },
          bad: true,
        })
      }
    }
    scheduleTodos.sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""))
    const todos = [...weekOrders, ...scheduleTodos, ...callTodos]

    /* ── Days ── */
    const days: PlanDay[] = keys.map((k) => {
      const s = salesByDay.get(k)
      const sold = k < input.asOf
      const kind: PlanDay["kind"] =
        s === undefined || (sold ? s.actual === null && s.forecast === null : s.forecast === null)
          ? "none"
          : sold
            ? "sold"
            : k === input.asOf
              ? "today"
              : "forecast"
      const amount = s === undefined ? null : sold ? s.actual : s.forecast
      const storeDays = scoped.map((st) => ({ st, d: storeDay(st, k) }))
      const withFc = storeDays.filter((x) => x.d !== undefined && x.d.forecast !== null)

      // Staffing for the day across the scope, in words.
      let staffing: { tone: PlanTone; text: string }
      if (sold) {
        staffing =
          s?.actual != null ? { tone: "good", text: "Sold" } : { tone: "wait", text: "Not counted yet" }
      } else if (withFc.length === 0) {
        staffing = { tone: "wait", text: "No forecast" }
      } else {
        const short = withFc.reduce((a, x) => a + shortOf(x.d), 0)
        const unposted = withFc.filter((x) => x.d!.status === "unscheduled").length
        const checked = withFc.filter((x) => x.d!.status !== "unscheduled" && x.d!.status !== "unknown").length
        if (short > 0) staffing = { tone: "bad", text: `Short ${hrs(short)} h` }
        else if (checked === 0 && unposted > 0) staffing = { tone: "warn", text: "No schedule" }
        else if (checked === 0) staffing = { tone: "wait", text: "Hours not checked" }
        else if (unposted > 0) staffing = { tone: "warn", text: `${unposted} with no schedule` }
        else staffing = { tone: "good", text: "Covered" }
      }

      // Why the number.
      let why: PlanDayDetail["why"] = null
      let whyNote: string
      if (sold) {
        if (s?.actual == null) {
          whyNote = "The day has closed, but its sales have not been counted yet."
        } else if (s.forecast === null) {
          whyNote = `Sold ${money(s.actual)}. No forecast was made for this day.`
        } else {
          why = [
            { label: "Forecast was", value: money(s.forecast) },
            { label: "Sold", value: money(s.actual) },
          ]
          const gap = s.actual - s.forecast
          const inside = s.p10 !== null && s.p90 !== null && s.actual >= s.p10 && s.actual <= s.p90
          whyNote =
            Math.round(gap) === 0
              ? "It landed on the forecast."
              : `It came in ${money(Math.abs(gap))} ${gap > 0 ? "over" : "under"} the forecast${
                  s.p10 !== null && s.p90 !== null ? (inside ? ", inside the likely range" : ", outside the likely range") : ""
                }.`
        }
      } else if (s?.forecast == null) {
        whyNote = "No forecast has been made for this day yet."
      } else if (s.partialWhy) {
        whyNote = "The forecast wrote its reasons for only some stores this day. Pick one store to see them."
      } else if (s.attribution) {
        const a = s.attribution
        const rows = [{ label: "An average day", value: money(a.base) }]
        for (const g of a.groups) {
          rows.push({ label: g.label, value: `${g.value >= 0 ? "+" : "−"}${money(Math.abs(g.value))}` })
        }
        const rest = s.forecast - a.base - a.groups.reduce((t, g) => t + g.value, 0)
        if (Math.abs(rest) > Math.abs(s.forecast) * WHY_REST_LIMIT) {
          // The reasons cover only part of the number: in an all-stores view
          // one store wrote its reasons and another did not. A big "other"
          // row would be a reason nobody gave, so show none.
          whyNote =
            input.storeId === null
              ? "The forecast wrote its reasons for only part of this day. Pick one store to see them."
              : "The forecast was adjusted after the model wrote its reasons, so they no longer add up to it and are not shown."
        } else {
          if (Math.abs(rest) >= 1) {
            rows.push({ label: "Other adjustments", value: `${rest >= 0 ? "+" : "−"}${money(Math.abs(rest))}` })
          }
          rows.push({ label: "Forecast", value: money(s.forecast) })
          why = rows
          whyNote = "What moved the forecast for this day, as the model wrote it."
        }
      } else {
        whyNote = "The forecast has not written its reasons for this day yet."
      }
      const range =
        !sold && s?.forecast != null && s.p10 !== null && s.p90 !== null
          ? `Likely between ${money(s.p10)} and ${money(s.p90)}`
          : null

      // People by hour, for the scoped stores that posted a schedule.
      let hours: PlanHourBar[] | null = null
      const hoursNotes: PlanDayDetail["hoursNotes"] = []
      if (!sold) {
        const counted = withFc.filter(
          (x) => x.d!.status !== "unscheduled" && x.d!.status !== "unknown" && x.d!.hourly.some((h) => h.needed !== null),
        )
        if (counted.length > 0) {
          // Each store's shortfall is its own: one store's spare cook does
          // not cover another store's rush, so deficits add, surpluses don't.
          const byHour = new Map<number, { staffed: number; short: number }>()
          for (const { d } of counted) {
            for (const h of d!.hourly) {
              // An hour the forecast did not cover is left out, not drawn as
              // "nothing needed".
              if (h.needed === null) continue
              const cur = byHour.get(h.hour) ?? { staffed: 0, short: 0 }
              cur.staffed += h.staffed
              const gap = h.needed - h.staffed
              if (gap > 0.25) cur.short += gap
              byHour.set(h.hour, cur)
            }
          }
          hours = [...byHour.entries()].sort((x, y) => clockOrder(x[0]) - clockOrder(y[0])).map(([hour, v]) => ({
            hour,
            label: clockWord(hour),
            staffed: Math.round(v.staffed * 10) / 10,
            short: Math.round(v.short * 10) / 10,
          }))
        }
        for (const { st, d } of storeDays) {
          if (st.failed) {
            hoursNotes.push({ tone: "wait", text: `${st.name} didn't load.` })
          } else if (d === undefined || d.forecast === null) {
            hoursNotes.push({ tone: "wait", text: `${st.name} has no forecast for this day.` })
          } else if (d.status === "unscheduled") {
            hoursNotes.push({ tone: "warn", text: `${st.name} has no schedule in Harri, so it is not counted.` })
          } else if (d.status === "unknown") {
            hoursNotes.push({ tone: "wait", text: `${st.name}'s hours can't be checked yet: too little history.` })
          } else if (d.status === "short") {
            hoursNotes.push({
              tone: "bad",
              text: `${st.name} is ${hoursWord(shortOf(d))} short${
                d.worst ? `, mostly ${clockWord(d.worst.startHour)} to ${clockWord(d.worst.endHour)}` : ""
              }.`,
            })
          } else {
            hoursNotes.push({ tone: "good", text: `${st.name} is covered.` })
          }
        }
      }

      const detailStores = storeDays.map(({ st, d }) => ({
        id: st.id,
        name: st.name,
        amount: d === undefined ? money(null) : money(sold ? d.actual : d.forecast),
        status: sold ? null : st.failed ? { tone: "wait" as const, text: "Didn't load" } : staffWord(d),
      }))

      return {
        key: k,
        dow: weekdayOf(k).slice(0, 3),
        date: String(parseDayKey(k)?.getUTCDate() ?? ""),
        full: fullDate(k),
        weekday: weekdayOf(k),
        kind,
        amount,
        short: moneyCompact(amount),
        p10: sold ? null : (s?.p10 ?? null),
        p90: sold ? null : (s?.p90 ?? null),
        weather: s ? weatherWords(s.weatherPhrase, s.weatherHighC) : null,
        event: s?.event ?? null,
        staffing,
        ordersDue: weekOrders.filter((t) => t.due === k).length,
        detail: { why, whyNote, range, hours, hoursNotes, stores: detailStores },
      }
    })

    /* ── The week's figures ── */
    const withAmount = days.filter((d) => d.amount !== null)
    const total = withAmount.length === 0 ? null : withAmount.reduce((a, d) => a + d.amount!, 0)
    const soldPart = days.filter((d) => d.kind === "sold").reduce((a, d) => a + (d.amount ?? 0), 0)
    const soldDays = days.filter((d) => d.kind === "sold").length
    const fcPart = (total ?? 0) - soldPart
    const pendingSold = keys.filter((k) => k < input.asOf && salesByDay.get(k)?.actual == null).length
    const noForecast = scoped.filter(
      (s) => !s.failed && aheadKeys.length > 0 && aheadKeys.every((k) => (storeDay(s, k)?.forecast ?? null) === null),
    )
    // A store forecast for some of the days ahead but not all of them: its
    // other days are in the total, these are not.
    const fcGap = (s: PlanStoreInput) => aheadKeys.filter((k) => (storeDay(s, k)?.forecast ?? null) === null)
    const partFc = scoped.filter((s) => !s.failed && !noForecast.includes(s) && fcGap(s).length > 0)
    const partDays = aheadKeys.filter((k) => partFc.some((s) => fcGap(s).includes(k)))
    // Like for like or not at all: a closed day not counted yet, or a store
    // or a day left out of the total, would make the change compare different weeks.
    const change =
      total !== null &&
      input.lastWeek !== null &&
      input.lastWeek > 0 &&
      pendingSold === 0 &&
      noForecast.length === 0 &&
      partFc.length === 0
        ? (total - input.lastWeek) / input.lastWeek
        : null

    const sales: PlanFigure = {
      value: total === null ? null : money(total),
      vs:
        change === null
          ? null
          : {
              change: Math.abs(change) < 0.0005 ? "level" : `${change > 0 ? "▲" : "▼"} ${pctWords(change)}`,
              tone: Math.abs(change) < 0.0005 ? "flat" : change > 0 ? "up" : "down",
              against: `vs ${money(input.lastWeek)} sold last week`,
            },
      sub:
        total === null
          ? ""
          : soldDays > 0 && fcPart > 0
            ? `${money(soldPart)} sold so far, ${money(fcPart)} forecast for the rest`
            : soldDays > 0
              ? "All of it sold"
              : "All of it forecast",
      missing:
        total === null
          ? "no forecast yet"
          : [
              pendingSold > 0 ? `${count(pendingSold)} closed ${pendingSold === 1 ? "day" : "days"} not counted yet` : null,
              noForecast.length > 0 ? `${listWords(noForecast.map((s) => s.name))} not forecast yet` : null,
              partFc.length > 0
                ? `${listWords(partFc.map((s) => s.name))} not forecast for ${listWords(partDays.map(weekdayOf))} yet`
                : null,
              input.lastWeek === null ? "last week not counted yet" : null,
            ]
              .filter(Boolean)
              .join(" · ") || undefined,
    }

    // Hours over the days still ahead, for the stores that posted a schedule.
    let sched = 0
    let need = 0
    let short = 0
    const unpostedStores = new Set<string>()
    const shortByStore = new Map<string, { h: number; worstDay: string; worstH: number; hour: number | null }>()
    for (const s of scoped) {
      for (const k of aheadKeys) {
        const d = storeDay(s, k)
        if (d === undefined || d.forecast === null) continue
        if (d.status === "unscheduled") {
          unpostedStores.add(s.name)
          continue
        }
        if (d.status === "unknown" || d.needed === null) continue
        sched += d.scheduled
        need += d.needed
        const sh = shortOf(d)
        if (sh > 0) {
          short += sh
          const cur = shortByStore.get(s.name) ?? { h: 0, worstDay: k, worstH: 0, hour: null }
          cur.h += sh
          if (sh > cur.worstH) {
            cur.worstH = sh
            cur.worstDay = k
            cur.hour = d.worst?.startHour ?? null
          }
          shortByStore.set(s.name, cur)
        }
      }
    }
    const checkedAny = need > 0
    const hoursFig: PlanFigure = checkedAny
      ? {
          value: `${hrs(sched)} h`,
          vs:
            short > 0
              ? { change: `${hrs(short)} h short`, tone: "down", against: "on the days that are short" }
              : { change: "covers the forecast", tone: "up", against: "" },
          sub: `The forecast needs about ${hrs(need)} h${key === "this" ? " for the rest of the week" : ""}`,
          missing: unpostedStores.size > 0 ? `${listWords([...unpostedStores])} has no schedule, not counted` : undefined,
        }
      : {
          value: null,
          vs: null,
          sub: aheadKeys.length === 0 ? "The week is over" : "",
          missing: unpostedStores.size > 0 ? "No schedule posted in Harri" : "Hours can't be checked yet",
        }

    const firstDue = todos.filter((t) => t.due !== null).sort((a, b) => a.due!.localeCompare(b.due!))[0]
    const todo: PlanFigure = {
      value: `${count(todos.length)} ${todos.length === 1 ? "thing" : "things"}`,
      vs: null,
      sub: firstDue
        ? `First one due ${firstDue.due! <= input.asOf ? "today" : weekdayOf(firstDue.due!)}`
        : todos.length > 0
          ? "Nothing with a deadline"
          : "Nothing waiting",
    }

    /* ── The sentence ── */
    const sentence: PlanWeek["sentence"] = []
    const say = (text: string, strong = false) => sentence.push({ text, strong })
    if (total === null) {
      say(`No forecast has been made for ${key === "this" ? "this" : "next"} week yet. `)
    } else if (key === "this" && soldDays > 0 && fcPart > 0) {
      say("This week is on track for about ")
      say(money(total), true)
      say(`: ${money(soldPart)} sold so far and ${money(fcPart)} forecast for the rest. `)
    } else {
      say(`${key === "this" ? "This" : "Next"} week should sell about `)
      say(money(total), true)
      if (change !== null) {
        say(
          Math.abs(change) < 0.0005
            ? `, level with the ${money(input.lastWeek)} sold last week. `
            : `, ${change > 0 ? "up" : "down"} ${pctWords(change)} on the ${money(input.lastWeek)} sold last week. `,
        )
      } else say(". ")
    }
    if (noForecast.length > 0 && total !== null) {
      say(
        `${listWords(noForecast.map((s) => s.name))} ${noForecast.length === 1 ? "has" : "have"} no forecast yet, so ${
          noForecast.length === 1 ? "it is" : "they are"
        } not in the total. `,
      )
    }
    const biggest = withAmount.reduce<PlanDay | null>((a, d) => (a === null || d.amount! > a.amount! ? d : a), null)
    if (biggest && withAmount.length > 1) {
      say(biggest.weekday, true)
      say(` ${biggest.kind === "sold" ? "was" : "is"} the biggest day. `)
    }
    if (shortByStore.size > 0) {
      const [store, v] = [...shortByStore.entries()].sort((a, b) => b[1].h - a[1].h)[0]
      say(`${store} is `)
      say(`${hoursWord(v.h)} short`, true)
      say(`, most of it ${weekdayOf(v.worstDay)}${v.hour !== null ? ` ${partOfDay(v.hour)}` : ""}. `)
    } else if (checkedAny && aheadKeys.length > 0) {
      say("The schedule covers the forecast. ")
    }
    if (unpostedStores.size > 0) {
      const names = [...unpostedStores]
      say(`${listWords(names)} ${names.length === 1 ? "has" : "have"} `)
      say("no schedule in Harri", true)
      say(", so those hours can't be checked. ")
    }
    const firstOrder = weekOrders.find((t) => t.bad) ?? null
    if (firstOrder && key === "this") {
      const row = shelfRows.find((r) => `order-${r.key}` === firstOrder.key)!
      const store = storeOfRow(row)
      say(`${row.name}${store ? ` at ${store}` : ""} runs out ${row.outLabel}`, true)
      say(
        firstOrder.due
          ? ` unless you order ${firstOrder.due <= input.asOf ? "today" : `by ${weekdayOf(firstOrder.due)}`}.`
          : ".",
      )
    }
    if (sentence.length > 0) sentence[sentence.length - 1].text = sentence[sentence.length - 1].text.trimEnd()

    /* ── Store cards ── */
    const stores: PlanStoreCard[] = input.stores.map((s) => {
      const tot = keys.reduce<number | null>((a, k) => {
        const d = storeDay(s, k)
        const v = d === undefined ? null : k < input.asOf ? d.actual : d.forecast
        return v === null ? a : (a ?? 0) + v
      }, null)
      const ahead = aheadKeys.map((k) => storeDay(s, k)).filter((d) => d !== undefined && d.forecast !== null)
      const posted = ahead.filter((d) => d!.status !== "unscheduled" && d!.status !== "unknown" && d!.needed !== null)
      const sh = ahead.reduce((a, d) => a + shortOf(d), 0)
      const unposted = ahead.some((d) => d!.status === "unscheduled")
      // A closed day with no row at all is as uncounted as one not reconciled yet.
      const pending = keys.some((k) => k < input.asOf && (storeDay(s, k)?.actual ?? null) === null)
      // Every day ahead forecast, or no comparison: a missing day is not a slow one.
      const gaps = aheadKeys.some((k) => (storeDay(s, k)?.forecast ?? null) === null)
      const c =
        tot !== null && s.lastWeek !== null && s.lastWeek > 0 && !pending && !gaps
          ? (tot - s.lastWeek) / s.lastWeek
          : null
      const orders = weekOrders.filter((t) => {
        const row = shelfRows.find((r) => `order-${r.key}` === t.key)
        return row ? storeOfRow(row) === s.name : false
      }).length
      const status: PlanStoreCard["status"] = s.failed
        ? { tone: "wait", label: "Didn't load" }
        : ahead.length === 0 && aheadKeys.length > 0
          ? { tone: "wait", label: "No forecast yet" }
          : sh > 0
            ? { tone: "bad", label: `Short ${hrs(sh)} h` }
            : unposted
              ? { tone: "warn", label: "No schedule" }
              : posted.length === 0
                ? { tone: "wait", label: aheadKeys.length === 0 ? "Week done" : "Hours not checked" }
                : { tone: "good", label: "Hours covered" }
      const figures = [
        {
          label: key === "this" ? "Sales this week" : "Expected sales",
          value: tot === null ? "no forecast yet" : money(tot),
        },
        {
          label: "Vs last week",
          value: c === null ? "not counted" : `${c >= 0 ? "▲" : "▼"} ${pctWords(c)}`,
        },
      ]
      if (posted.length > 0) {
        figures.push({
          label: "Hours",
          value: `${hrs(posted.reduce((a, d) => a + d!.scheduled, 0))} of ${hrs(posted.reduce((a, d) => a + (d!.needed ?? 0), 0))} h`,
        })
      }
      return {
        id: s.id,
        name: s.name,
        href: href(s.id, key),
        status,
        figures,
        note:
          orders > 0
            ? `${count(orders)} to order${input.storeId === s.id ? "" : " · tap to see this store"}`
            : input.storeId === s.id
              ? "Showing this store"
              : "Tap to see this store",
      }
    })

    const defaultDay =
      key === "this" ? (keys.includes(input.asOf) ? input.asOf : (keys[keys.length - 1] ?? null)) : (keys[0] ?? null)

    return { key, name, label, sentence, sales, hours: hoursFig, todo, days, todos, stores, defaultDay }
  }

  const shelf = shelfRows.map((r) => {
    const store = storeOfRow(r)
    return {
      key: r.key,
      what: `${r.name}${store ? ` · ${store}` : ""}`,
      why: `Runs out ${r.outLabel}${needsOrder(r) && r.qty ? ` · bring in ${r.qty}` : ""}`,
      tone: toneOf(r.tagTone),
      tag: r.tag,
    }
  })

  const { inside, sample } = input.accuracy
  const accuracy: WeekPlan["accuracy"] =
    inside !== null && sample > 0
      ? {
          tone: inside / sample >= 0.7 ? "good" : "warn",
          text: `Forecast in its likely range on ${count(inside)} of the last ${count(sample)} days`,
        }
      : { tone: "wait", text: "Forecast accuracy not measured yet" }

  return {
    defaultWeek: defaultWeekFor(input.asOf),
    weeks: { this: buildWeek("this", thisKeys), next: buildWeek("next", nextKeys) },
    scope: { id: input.storeId, name: scopeName },
    scopes: [
      { key: "all", label: "All stores", href: href(null) },
      ...input.stores.map((s) => ({ key: s.id, label: s.name, href: href(s.id) })),
    ],
    shelf,
    shelfNote: input.runOut === null ? input.runOutNote : shelf.length === 0 ? "Nothing on the shelf runs short this week" : null,
    accuracy,
  }
}

/** `?week=this|next` off the URL; anything else is no pick. */
export function weekParam(params: URLSearchParams): PlanWeekKey | null {
  const w = params.get("week")
  return w === "this" || w === "next" ? w : null
}
