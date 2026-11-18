import { money, pct, plural, points } from "@/lib/counter/format"
import { hoursText, scheduleHeld } from "@/lib/counter/schedule-hold"

/**
 * Labor "made plain" (owner's go on the mock, 2026-11-18:
 * https://claude.ai/artifact/Sr98ngzuijqUUhPbJNJAv4), for the group page and
 * one store's page.
 *
 * Nothing here is computed afresh. The share of sales, cost, hours, schedule
 * and missing store-days are `LaborWeek`'s, the same figures the strip and
 * the verdict print; the leak is the leak ledger's; last week is the trend's
 * own week, read only when the range is exactly one Monday-to-Sunday week.
 */

export type LaborPlainTone = "good" | "warn" | "bad"

export interface LaborPlainInput {
  /** Over total sales, already in percent (0..100); null with no sales. */
  laborPct: number | null
  cost: number
  hours: number
  /** Published hours, or null when no schedule was published. */
  scheduledHours: number | null
  /** Store-days that sold with no labor reading. */
  missingStoreDays: number
  splh: number | null
  /** The leak ledger, or null when it did not load or carries nothing. */
  leak: { hours: number; cost: number } | null
  /** The week before, from the trend; null unless the range is one whole week. */
  prior: { label: string; laborPct: number | null } | null
}

export interface LaborPlain {
  sentence: string
  big: {
    label: string
    value: string | null
    sub: string
    missing?: string
  }
  vs: { change: string; tone: "up" | "down" | "flat"; against: string } | null
  statuses: Array<{ tone: LaborPlainTone; text: string }>
  lines: Array<{ key: string; label: string; value: string }>
}

/** "1,200 hours", "6.5 hours", "1 hour": whole hours from ten up, as people say them. */
function hrsNum(v: number): string {
  const n = Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 10) / 10
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 })
}
const h = (v: number) => `${hrsNum(v)} ${Math.abs(v) === 1 ? "hour" : "hours"}`
const hShort = (v: number) => `${hrsNum(v)} h`

export function buildLaborPlain(o: LaborPlainInput): LaborPlain {
  const parts: string[] = []
  const statuses: LaborPlain["statuses"] = []
  const missing = o.missingStoreDays > 0

  // No share because the days that sold have no labor reading: the cost and
  // hours here are not a reading, so neither they nor the schedule are said.
  const noReading = o.laborPct === null && missing
  if (noReading) {
    parts.push("No labor is on file for the days that sold, so there is no labor share yet.")
  } else if (o.laborPct === null) {
    parts.push(`Labor cost ${money(o.cost)} for ${h(o.hours)}, with no sales in this range to set it against.`)
  } else {
    // The share is taken on the sales of the days that HAVE labor (rated
    // sales), so a missing day shortens the cost, not the share.
    parts.push(
      `Labor was ${pct(o.laborPct, { scaled: true })} of sales${missing ? " on the days with hours" : ""}, ${money(o.cost)} for ${h(o.hours)}.`,
    )
  }

  if (noReading) {
    // Nothing worked to read against a schedule.
  } else if (o.scheduledHours === null) {
    parts.push("No schedule was published, so the hours are not read against a plan.")
    statuses.push({ tone: "warn", text: "No schedule published" })
  } else {
    const gap = o.hours - o.scheduledHours
    if (scheduleHeld(gap, o.scheduledHours)) {
      parts.push(`The schedule held: ${h(o.scheduledHours)} published.`)
      statuses.push({ tone: "good", text: "Schedule held" })
    } else {
      const word = gap > 0 ? "over" : "under"
      parts.push(`That is ${h(Math.abs(gap))} ${word} the ${h(o.scheduledHours)} published.`)
      statuses.push({ tone: gap > 0 ? "warn" : "good", text: `${hShort(Math.abs(gap))} ${word} schedule` })
    }
  }

  if (missing) {
    parts.push(`${plural(o.missingStoreDays, "store-day is", "store-days are")} missing labor, so the total cost is higher.`)
    statuses.push({ tone: "warn", text: `Labor missing on ${plural(o.missingStoreDays, "store-day")}` })
  }

  if (o.leak !== null && o.leak.hours > 0) {
    parts.push(`Clock-in and clock-out alerts add up to ${h(o.leak.hours)}, about ${money(o.leak.cost)}.`)
    statuses.push({ tone: "warn", text: `${hShort(o.leak.hours)} leaked at the clock` })
  }

  let vs: LaborPlain["vs"] = null
  if (o.prior !== null && o.prior.laborPct !== null && o.laborPct !== null) {
    const d = o.laborPct - o.prior.laborPct
    const change = points(d)
    // Labor's share going DOWN is the good direction.
    vs = { change, tone: change === "flat" ? "flat" : d < 0 ? "up" : "down", against: `vs week of ${o.prior.label}` }
  }

  const lines: LaborPlain["lines"] = [
    { key: "hours", label: "Hours worked", value: noReading ? "not on file" : hoursText(o.hours) },
    { key: "scheduled", label: "Hours published", value: o.scheduledHours === null ? "no schedule" : hoursText(o.scheduledHours) },
    { key: "cost", label: "Labor cost", value: noReading ? "not on file" : money(o.cost) },
    { key: "splh", label: "Sales per labor hour", value: o.splh === null ? "—" : money(o.splh, { cents: true }) },
  ]

  return {
    sentence: parts.join(" "),
    big: {
      label: "Labor, share of sales",
      value: o.laborPct === null ? null : pct(o.laborPct, { scaled: true }),
      sub: noReading ? "" : money(o.cost),
      missing: missing ? `labor missing on ${plural(o.missingStoreDays, "store-day")}` : undefined,
    },
    vs,
    statuses,
    lines,
  }
}
