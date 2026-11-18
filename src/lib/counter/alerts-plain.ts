import { alertGroupWords, countByTarget } from "@/lib/counter/alert-groups"
import { count } from "@/lib/counter/format"

/**
 * The Alerts page "made plain" (owner's go on the mock, 2026-11-18:
 * https://claude.ai/artifact/Sr98ngzuijqUUhPbJNJAv4): one sentence, status in
 * words, the serious ones listed first with one button each, and the rest
 * folded into a few groups that open the page where that kind of alert is
 * dealt with.
 *
 * Reads the open alerts only, whatever the segment or filters below say: the
 * answer is "what is open", and the filtered list stays folded underneath.
 */

export type AlertsPlainTone = "good" | "warn" | "bad"

export interface AlertsPlainSerious {
  key: string
  /** `Alert.id`: the row the list opens with `?alert=`. */
  id: string
  what: string
  why: string | null
  href: string
}

export interface AlertsPlainGroup {
  key: string
  what: string
  why: string | null
  action: { label: string; href: string }
}

export interface AlertsPlain {
  sentence: string
  statuses: Array<{ tone: AlertsPlainTone; text: string }>
  serious: AlertsPlainSerious[]
  /** Serious conditions not listed, past the first few. */
  seriousMore: number
  groups: AlertsPlainGroup[]
  open: number
}

export interface AlertsPlainInput {
  /** Open alerts as loaded (the inbox loads at most 100, most serious first). */
  openRows: ReadonlyArray<{ target: string; severity: string }>
  /** The serious open alerts, folded the way the list folds repeats. */
  serious: ReadonlyArray<{ id: string; title: string; body: string | null; run: string | null }>
  /** Every open alert and every serious one, counted by the database. */
  counts: { open: number; critical: number }
  /** Closed alerts among those loaded: a floor, so it is worded "recently", never as a total. */
  closed: number
}

/** Serious conditions listed before "and N more". */
export const SERIOUS_SHOWN = 5

export function buildAlertsPlain(input: AlertsPlainInput): AlertsPlain {
  const { open, critical } = input.counts
  const rest = Math.max(0, open - critical)

  const serious = input.serious.slice(0, SERIOUS_SHOWN).map((s) => ({
    key: s.id,
    id: s.id,
    what: s.title,
    why: [s.run, s.body].filter(Boolean).join(" · ") || null,
    href: `/dashboard/alerts?alert=${encodeURIComponent(s.id)}`,
  }))

  const others = input.openRows.filter((a) => a.severity !== "CRITICAL")
  const partial = open > input.openRows.length
  const note = partial
    ? `Counted from the ${count(input.openRows.length)} most serious of ${count(open)} open alerts.`
    : null
  const groups = countByTarget(others).map(([target, n]) => {
    const g = alertGroupWords(target)
    return { key: target, what: `${count(n)} ${n === 1 ? g.one : g.many}`, why: note, action: g.fix }
  })

  const parts: string[] = []
  if (open === 0) {
    parts.push("Nothing is open. Every alert has been dealt with.")
  } else {
    parts.push(`${count(open)} ${open === 1 ? "alert is" : "alerts are"} open.`)
    if (critical > 0) {
      parts.push(critical === 1 ? "One looks serious and is listed first." : `${count(critical)} look serious and are listed first.`)
    } else {
      parts.push(open === 1 ? "It is not serious." : "None of them look serious.")
    }
    const top = countByTarget(others)[0]
    if (top && rest > 1) {
      const what = groups[0].what
      parts.push(top[1] * 2 > others.length ? `Most of the rest are ${what}.` : `The biggest group is ${what}.`)
    }
  }

  const statuses: AlertsPlain["statuses"] = []
  if (critical > 0) statuses.push({ tone: "bad", text: `${count(critical)} serious` })
  if (rest > 0) statuses.push({ tone: "warn", text: `${count(rest)} to glance at` })
  if (input.closed > 0) statuses.push({ tone: "good", text: `${count(input.closed)} closed recently` })
  if (open === 0) statuses.push({ tone: "good", text: "Nothing open" })

  return {
    sentence: parts.join(" "),
    statuses,
    serious,
    seriousMore: Math.max(0, input.serious.length - SERIOUS_SHOWN),
    groups,
    open,
  }
}
