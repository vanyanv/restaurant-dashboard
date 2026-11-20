import { money, pct, plural, points } from "@/lib/counter/format"
import { hoursText, readSchedule } from "@/lib/counter/schedule-hold"
import { timeRecordsHeadline, type MissedPunches } from "@/lib/counter/time-records"

/**
 * Labor "made plain" (owner's go on the mock, 2026-11-18:
 * https://claude.ai/artifact/Sr98ngzuijqUUhPbJNJAv4), for the group page and
 * one store's page.
 *
 * Nothing here is computed afresh. The share of sales, cost, hours, schedule
 * and missing store-days are `LaborWeek`'s, the same figures the strip and
 * the verdict print; the leak and the missed punches are the leak ledger's;
 * last week is the trend's own week, read only when the range is exactly one
 * Monday-to-Sunday week.
 *
 * ## What makes a share provisional
 *
 * The owner's rule is "only real, verifiable numbers". Three things make the
 * labor share not yet one, and each is said in words, never hidden behind a
 * confident headline:
 *
 * - missed clock-ins / clock-outs Harri flagged: those shifts carry the wrong
 *   hours until a manager fixes them, so they LEAD the page;
 * - days Harri has not finalised (today and yesterday; Harri settles a day
 *   about two days later), named;
 * - a store whose labor reads under 10% of its sales: "Labor looks
 *   incomplete for <store>". A restaurant does not run on 2% labor.
 *
 * The schedule is read only over store-days that have hours worked (see
 * `readSchedule`), and days still waiting on Harri are counted on their own,
 * so a sync that has not landed is never praised as "under the schedule".
 */

export type LaborPlainTone = "good" | "warn" | "bad"

export interface LaborPlainInput {
  /** Over total sales, already in percent (0..100); null with no sales. */
  laborPct: number | null
  cost: number
  hours: number
  /** Published hours, or null when no schedule was published. */
  scheduledHours: number | null
  /** Worked against published over store-days that carry both (`LaborWeek.compare`). */
  compare?: { actualHours: number; scheduledHours: number } | null
  /** Labels of days with a schedule and no hours from Harri yet. */
  awaitingDays?: string[]
  /** Labels of days Harri has not finalised yet. */
  provisionalDays?: string[]
  /** Missed punches in the range, off the leak ledger; null when the ledger did not load. */
  missed?: MissedPunches | null
  /** Stores whose labor reads under 10% of sales (`incompleteLaborStores`). */
  incomplete?: Array<{ name: string; laborPct: number | null }>
  /** How many stores the page covers. When every one is incomplete, the share is not shown. */
  storeCount?: number
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

/** "Mon Nov 17", "Mon Nov 17 and Tue Nov 18", "Mon Nov 17, Tue Nov 18 and 3 more". */
export function listDays(labels: string[], shown = 3): string {
  if (labels.length <= 1) return labels.join("")
  if (labels.length <= shown) return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`
  return `${labels.slice(0, shown - 1).join(", ")} and ${labels.length - (shown - 1)} more`
}

/** "Glendale", "Glendale and Van Nuys". */
function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("")
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

export function buildLaborPlain(o: LaborPlainInput): LaborPlain {
  const parts: string[] = []
  const statuses: LaborPlain["statuses"] = []
  const missing = o.missingStoreDays > 0
  const awaitingDays = o.awaitingDays ?? []
  const provisionalDays = o.provisionalDays ?? []
  const incomplete = o.incomplete ?? []
  const fixHeadline = o.missed ? timeRecordsHeadline(o.missed) : null
  // Every store the page covers reads incomplete: the share itself is not a reading.
  const allIncomplete = incomplete.length > 0 && incomplete.length >= (o.storeCount ?? 1)
  const provisional = fixHeadline !== null || provisionalDays.length > 0 || incomplete.length > 0

  // Open time records LEAD: until they are fixed, the hours under every figure below are wrong.
  if (fixHeadline !== null) {
    parts.push(`${fixHeadline}. Until they are fixed in Harri, the hours and labor cost for those shifts are wrong.`)
    statuses.push({ tone: "warn", text: fixHeadline })
  }

  // No share because the days that sold have no labor reading: the cost and
  // hours here are not a reading, so neither they nor the schedule are said.
  const noReading = o.laborPct === null && missing
  if (noReading) {
    parts.push("No labor is on file for the days that sold, so there is no labor share yet.")
  } else if (o.laborPct === null) {
    parts.push(`Labor cost ${money(o.cost)} for ${h(o.hours)}, with no sales in this range to set it against.`)
  } else if (allIncomplete) {
    parts.push(
      `Labor looks incomplete for ${listNames(incomplete.map((s) => s.name))}: only ` +
        `${pct(o.laborPct, { scaled: true })} of sales is on file as labor (${money(o.cost)} for ${h(o.hours)}), ` +
        "which usually means hours or wages are missing from Harri.",
    )
  } else {
    // The share is taken on the sales of the days that HAVE labor (rated
    // sales), so a missing day shortens the cost, not the share.
    parts.push(
      `Labor was ${pct(o.laborPct, { scaled: true })} of sales${missing ? " on the days with hours" : ""}` +
        `${provisional ? " so far" : ""}, ${money(o.cost)} for ${h(o.hours)}.`,
    )
  }
  for (const s of incomplete) {
    statuses.push({ tone: "warn", text: `Labor looks incomplete for ${s.name}` })
  }
  if (incomplete.length > 0 && !allIncomplete) {
    parts.push(
      `Labor looks incomplete for ${listNames(incomplete.map((s) => s.name))} ` +
        `(under 10% of sales), so the share above reads low.`,
    )
  }

  const sched = readSchedule(o.compare === undefined ? fallbackCompare(o) : o.compare, o.scheduledHours)
  // The comparison covers fewer hours published than the range has in all.
  const partial = (published: number) =>
    o.scheduledHours !== null && Math.abs(published - o.scheduledHours) >= 0.05
  if (noReading) {
    // Nothing worked to read against a schedule.
  } else if (sched.kind === "none") {
    parts.push("No schedule was published, so the hours are not read against a plan.")
    statuses.push({ tone: "warn", text: "No schedule published" })
  } else if (sched.kind === "waiting") {
    parts.push("No day with a published schedule has hours from Harri yet, so the hours are not read against it.")
  } else if (sched.kind === "held") {
    parts.push(`The schedule held${partial(sched.published) ? " on the days with hours" : ""}: ${h(sched.published)} published.`)
    statuses.push({ tone: "good", text: "Schedule held" })
  } else {
    const word = sched.kind
    parts.push(
      `${partial(sched.published) ? "On the days with hours, that is" : "That is"} ` +
        `${h(Math.abs(sched.gap))} ${word} the ${h(sched.published)} published.`,
    )
    // Running under is not praise when the hours under it are not settled.
    const tone: LaborPlainTone = word === "over" || provisional ? "warn" : "good"
    statuses.push({ tone, text: `${hShort(Math.abs(sched.gap))} ${word} schedule` })
  }

  if (awaitingDays.length > 0) {
    const n = awaitingDays.length
    parts.push(
      `${plural(n, "day is", "days are")} still waiting on Harri for hours worked ` +
        `(${listDays(awaitingDays)}), so ${n === 1 ? "it is" : "they are"} left out of the schedule check.`,
    )
    statuses.push({ tone: "warn", text: `${plural(n, "day")} still waiting on Harri` })
  }

  if (provisionalDays.length > 0) {
    parts.push(
      `Harri has not finalised ${listDays(provisionalDays)} yet; it settles a day about two days later, ` +
        "so these figures can still change.",
    )
    statuses.push({ tone: "warn", text: `Provisional: ${listDays(provisionalDays)}` })
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
  if (o.prior !== null && o.prior.laborPct !== null && o.laborPct !== null && !allIncomplete) {
    const d = o.laborPct - o.prior.laborPct
    const change = points(d)
    // Labor's share going DOWN is the good direction.
    vs = { change, tone: change === "flat" ? "flat" : d < 0 ? "up" : "down", against: `vs week of ${o.prior.label}` }
  }

  const published =
    o.scheduledHours === null
      ? "no schedule"
      : sched.kind === "held" || sched.kind === "over" || sched.kind === "under"
        ? !partial(sched.published)
          ? hoursText(o.scheduledHours)
          : `${hoursText(sched.published)} on days with hours · ${hoursText(o.scheduledHours)} in all`
        : `${hoursText(o.scheduledHours)} · no hours yet to compare`

  const lines: LaborPlain["lines"] = [
    { key: "hours", label: "Hours worked", value: noReading ? "not on file" : hoursText(o.hours) },
    { key: "scheduled", label: "Hours published", value: published },
    { key: "cost", label: "Labor cost", value: noReading ? "not on file" : money(o.cost) },
    { key: "splh", label: "Sales per labor hour", value: o.splh === null ? "—" : money(o.splh, { cents: true }) },
  ]

  const bigMissing = allIncomplete
    ? `Labor looks incomplete for ${listNames(incomplete.map((s) => s.name))}`
    : missing
      ? `labor missing on ${plural(o.missingStoreDays, "store-day")}`
      : undefined

  return {
    sentence: parts.join(" "),
    big: {
      label: provisional ? "Labor, share of sales · provisional" : "Labor, share of sales",
      // A share that looks incomplete is not printed as a plain figure.
      value: o.laborPct === null || allIncomplete ? null : pct(o.laborPct, { scaled: true }),
      sub: noReading ? "" : money(o.cost),
      missing: bigMissing,
    },
    vs,
    statuses,
    lines,
  }
}

/** Callers that predate `compare` pass totals only: read them as one matched block. */
function fallbackCompare(o: LaborPlainInput): { actualHours: number; scheduledHours: number } | null {
  return o.scheduledHours === null || o.hours <= 0 ? null : { actualHours: o.hours, scheduledHours: o.scheduledHours }
}
