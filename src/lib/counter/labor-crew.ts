import type { StaffingCurve } from "@/lib/counter/staffing-curve"
import { MISSED_CLOCK_IN_CODES, MISSED_CLOCK_OUT_CODES } from "@/lib/counter/time-records"

/**
 * The Labor page's second set of tabs: Hours of the day, People, Time clock.
 * Pure builders, no database: the rows arrive from `labor-crew-load.ts` and
 * the staffing curve, and every word and bar length the three tabs draw is
 * decided here, once, for the desk and the phone.
 *
 * What Harri does and does not send decides what these tabs may say:
 *
 * - hours per person are the PUBLISHED SCHEDULE. Harri sends hours worked per
 *   day and per role, never per person, so no row here says "worked";
 * - a missed punch is "flagged". Harri does not say when one is fixed;
 * - dollars for early and late minutes belong to the leak ledger
 *   (`labor-leaks.ts`), which costs them at the page's own blended rate. This
 *   file counts punches and never prices one.
 *
 * Types-only imports from the database-reading modules: the client view
 * imports this file's types.
 */

/* ── The rows ─────────────────────────────────────────────────────────── */

export interface CrewShiftRow {
  storeId: string
  /** `null` on an unfilled slot. Loaded without them; kept nullable for the type's honesty. */
  userId: number | null
  minutes: number
  /** The Monday of the week the shift was published under, `YYYY-MM-DD`. */
  weekStart: string
}

export interface CrewAlertRow {
  storeId: string
  userId: number
  alertCode: string
}

export interface CrewNameRow {
  userId: number
  firstName: string | null
  lastName: string | null
}

/** One person's whole published week, every store on the account, whatever the range. */
export interface CrewWeekRow {
  userId: number
  weekStart: string
  minutes: number
}

export interface LaborCrew {
  stores: Array<{ id: string; name: string }>
  /** The shifts inside the range, at the stores the page is looking at. */
  shifts: CrewShiftRow[]
  /**
   * The whole weeks those shifts belong to, summed per person across every
   * store on the account. The past-40 flag reads these and not `shifts`: a
   * range that cuts a week, or one store of two, would hide a 45-hour week.
   */
  weeks: CrewWeekRow[]
  alerts: CrewAlertRow[]
  names: CrewNameRow[]
}

/** The codes a person is counted under. Anything else Harri sends is not shown per person. */
const MISSED_IN = MISSED_CLOCK_IN_CODES
const MISSED = new Set<string>([...MISSED_CLOCK_IN_CODES, ...MISSED_CLOCK_OUT_CODES])
const LATE_IN = new Set(["LATE_CLOCK_IN"])

/** Scheduled hours in one week past which a person is flagged. */
export const OVERTIME_WEEK_HOURS = 40
/** How many people the tab lists before it says how many more there are. */
export const PEOPLE_SHOWN = 40

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const hoursWord = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)} h`

/** "Maria G." The crew list's first name and the last name's first letter. */
export function crewName(n: CrewNameRow | undefined): string | null {
  const first = n?.firstName?.trim()
  if (!first) return null
  const last = n?.lastName?.trim()
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first
}

function weekLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number)
  if (!y || !m || !d) return key
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(y, m - 1, d))
}

/* ── People ───────────────────────────────────────────────────────────── */

export interface LaborPersonRow {
  key: string
  name: string
  /** The store or stores the person is scheduled or flagged at. */
  store: string
  /** "32.5 h", or "none" for someone flagged but not on the schedule. */
  hours: string
  shifts: string
  /** "2 missed punches · 1 late clock-in", or "". */
  records: string
  /** "46 h the week of Nov 9", or `null`. */
  over: string | null
  /** 0 to 100, the person's scheduled hours against the longest in the list. */
  fill: number
}

export interface LaborPeopleView {
  sentence: string
  rows: LaborPersonRow[]
  note: string
}

export function buildLaborPeople(crew: LaborCrew): LaborPeopleView | null {
  const storeName = new Map(crew.stores.map((s) => [s.id, s.name]))
  // One person can be in the crew list at two stores: keep a row that has a name.
  const nameOf = new Map<number, CrewNameRow>()
  for (const n of crew.names) {
    if (crewName(nameOf.get(n.userId)) === null) nameOf.set(n.userId, n)
  }

  interface Acc {
    minutes: number
    shifts: number
    weeks: Map<string, number>
    stores: Set<string>
    missed: number
    late: number
  }
  const people = new Map<number, Acc>()
  const acc = (id: number): Acc => {
    let a = people.get(id)
    if (!a) {
      a = { minutes: 0, shifts: 0, weeks: new Map(), stores: new Set(), missed: 0, late: 0 }
      people.set(id, a)
    }
    return a
  }

  for (const s of crew.shifts) {
    if (s.userId === null) continue
    const a = acc(s.userId)
    a.minutes += s.minutes
    a.shifts += 1
    a.stores.add(s.storeId)
  }
  for (const w of crew.weeks) {
    const a = people.get(w.userId)
    if (a) a.weeks.set(w.weekStart, (a.weeks.get(w.weekStart) ?? 0) + w.minutes)
  }
  for (const r of crew.alerts) {
    const missed = MISSED.has(r.alertCode)
    const late = LATE_IN.has(r.alertCode)
    if (!missed && !late) continue
    const a = acc(r.userId)
    if (missed) a.missed += 1
    else a.late += 1
    a.stores.add(r.storeId)
  }
  if (people.size === 0) return null

  const all = [...people.entries()].map(([id, a]) => {
    let overKey: string | null = null
    let overMin = OVERTIME_WEEK_HOURS * 60
    for (const [wk, min] of a.weeks) {
      if (min > overMin) {
        overMin = min
        overKey = wk
      }
    }
    return { id, a, overKey, overMin }
  })
  // Whoever needs a look first: past 40 hours, then missed punches, then the longest week.
  all.sort(
    (x, y) =>
      Number(y.overKey !== null) - Number(x.overKey !== null) ||
      y.a.missed - x.a.missed ||
      y.a.minutes - x.a.minutes ||
      x.id - y.id,
  )

  const top = all.reduce((m, p) => Math.max(m, p.a.minutes), 0)
  const rows: LaborPersonRow[] = all.slice(0, PEOPLE_SHOWN).map(({ id, a, overKey, overMin }) => {
    const records = [
      a.missed > 0 ? plural(a.missed, "missed punch", "missed punches") : "",
      a.late > 0 ? plural(a.late, "late clock-in", "late clock-ins") : "",
    ].filter(Boolean)
    return {
      key: String(id),
      name: crewName(nameOf.get(id)) ?? "Not in the crew list",
      store: [...a.stores].map((s) => storeName.get(s) ?? "").filter(Boolean).sort().join(", "),
      hours: a.minutes > 0 ? hoursWord(Math.round(a.minutes / 6) / 10) : "none",
      shifts: a.shifts > 0 ? plural(a.shifts, "shift", "shifts") : "not on the schedule",
      records: records.join(" · "),
      // Rounded up, so a week a few minutes past 40 never reads "40 h".
      over: overKey ? `${hoursWord(Math.ceil(overMin / 6) / 10)} the week of ${weekLabel(overKey)}` : null,
      fill: top > 0 ? Math.round((a.minutes / top) * 100) : 0,
    }
  })

  const scheduled = all.filter((p) => p.a.minutes > 0)
  const totalHours = Math.round(scheduled.reduce((n, p) => n + p.a.minutes, 0) / 60)
  const over = all.filter((p) => p.overKey !== null).length
  const missed = all.filter((p) => p.a.missed > 0).length
  const unnamed = all.filter((p) => crewName(nameOf.get(p.id)) === null).length

  const sentence = [
    scheduled.length > 0
      ? `${plural(scheduled.length, "person is", "people are")} on the published schedule for ${totalHours.toLocaleString("en-US")} ${totalHours === 1 ? "hour" : "hours"}.`
      : "Nobody is on a published schedule for these days.",
    over > 0
      ? `${plural(over, "person is", "people are")} scheduled past ${OVERTIME_WEEK_HOURS} hours in one week, counting every store.`
      : scheduled.length > 0
        ? `Nobody is scheduled past ${OVERTIME_WEEK_HOURS} hours in one week, counting every store.`
        : "",
    missed > 0 ? `${plural(missed, "person has", "people have")} a missed punch flagged.` : "",
  ]
    .filter(Boolean)
    .join(" ")

  const note = [
    "Hours are the published schedule for these days: Harri sends hours worked by day and by role, not by person.",
    `The ${OVERTIME_WEEK_HOURS}-hour check looks at each person's whole week, Monday to Sunday, at every store.`,
    "A missed punch is one Harri flagged; it does not say when one is fixed.",
    all.length > rows.length ? `Showing ${rows.length} of ${all.length} people.` : "",
    unnamed > 0
      ? `${plural(unnamed, "person is", "people are")} not in the crew list yet. Sync the crew from Harri to name them.`
      : "",
  ]
    .filter(Boolean)
    .join(" ")

  return { sentence, rows, note }
}

/* ── Time clock ───────────────────────────────────────────────────────── */

export interface LaborClockStore {
  key: string
  name: string
  /** "3", the missed punches flagged. */
  value: string
  detail: string
  fill: number
}

export interface LaborClockView {
  sentence: string
  stores: LaborClockStore[]
  note: string
}

export function buildLaborClock(crew: LaborCrew): LaborClockView {
  const by = new Map<string, { any: boolean; missedIn: number; missedOut: number; people: Set<number> }>()
  for (const s of crew.stores) by.set(s.id, { any: false, missedIn: 0, missedOut: 0, people: new Set() })
  for (const r of crew.alerts) {
    const b = by.get(r.storeId)
    if (!b) continue
    b.any = true
    if (!MISSED.has(r.alertCode)) continue
    if (MISSED_IN.has(r.alertCode)) b.missedIn += 1
    else b.missedOut += 1
    b.people.add(r.userId)
  }

  const counted = crew.stores.map((s) => {
    const b = by.get(s.id)!
    return { s, b, n: b.missedIn + b.missedOut }
  })
  const top = counted.reduce((m, c) => Math.max(m, c.n), 0)
  const total = counted.reduce((m, c) => m + c.n, 0)

  const stores: LaborClockStore[] = counted
    .sort((x, y) => y.n - x.n || x.s.name.localeCompare(y.s.name))
    .map(({ s, b, n }) => ({
      key: s.id,
      name: s.name,
      // A store Harri sent nothing for is not a store with a clean clock.
      value: b.any ? String(n) : "no records",
      detail: !b.any
        ? "Harri sent no time records for these days"
        : n === 0
          ? "none flagged"
          : [
              b.missedOut > 0 ? plural(b.missedOut, "missed clock-out", "missed clock-outs") : "",
              b.missedIn > 0 ? plural(b.missedIn, "missed clock-in", "missed clock-ins") : "",
              plural(b.people.size, "person", "people"),
            ]
              .filter(Boolean)
              .join(" · "),
      fill: top > 0 ? Math.round((n / top) * 100) : 0,
    }))

  const worst = stores[0]
  const silent = counted.filter((c) => !c.b.any)
  const sentence =
    silent.length === counted.length
      ? "Harri sent no time records for these days, so missed punches cannot be counted."
      : total === 0
        ? "No missed punches were flagged on these days." +
          (silent.length > 0 ? ` ${silent.map((c) => c.s.name).join(" and ")} sent no time records.` : "")
      : stores.length > 1 && worst
        ? `${plural(total, "missed punch was", "missed punches were")} flagged on these days, most at ${worst.name} (${worst.value}).`
        : `${plural(total, "missed punch was", "missed punches were")} flagged on these days.`

  return {
    sentence,
    stores,
    note:
      "Until a missed punch is fixed in Harri, that shift's hours are a guess and the labor cost for the day is off. " +
      "Harri does not tell us when one is fixed, so these are the ones it flagged.",
  }
}

/* ── Hours of the day ─────────────────────────────────────────────────── */

export interface LaborHourRow {
  key: string
  /** "11 AM" */
  title: string
  /** "4 people" */
  value: string
  /** "23 orders forecast", or "no forecast". */
  detail: string
  fill: number
  /** The hour where forecast orders most outrun the schedule. */
  tight: boolean
}

export interface LaborHoursView {
  /** "Sat, Nov 21": the day drawn, the day after the range ends. */
  day: string
  sentence: string
  rows: LaborHourRow[]
  note: string
}

function hourWord(h: number): string {
  const hr = ((h % 24) + 24) % 24
  return `${hr % 12 === 0 ? 12 : hr % 12} ${hr < 12 ? "AM" : "PM"}`
}

export function buildLaborHours(curve: StaffingCurve, day: string): LaborHoursView {
  const top = curve.hours.reduce((m, h) => Math.max(m, h.scheduled), 0)
  const anyForecast = curve.hours.some((h) => h.demand !== null)
  return {
    day,
    sentence: curve.sentence,
    rows: curve.hours.map((h) => ({
      key: String(h.hour),
      title: hourWord(h.hour),
      value: plural(h.scheduled, "person", "people"),
      detail: h.demand === null ? "no forecast" : `${Math.round(h.demand)} orders forecast`,
      fill: top > 0 ? Math.round((h.scheduled / top) * 100) : 0,
      tight: curve.tightest === h.hour,
    })),
    note:
      `The bars are people on the published schedule for ${day}, hour by hour.` +
      (anyForecast ? " Orders are the sales forecast for the same hour." : " There is no sales forecast for that day yet.") +
      " Unfilled slots on the schedule are not counted.",
  }
}
