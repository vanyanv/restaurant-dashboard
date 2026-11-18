import { count, money } from "@/lib/counter/format"

/**
 * The Decisions page "made plain" (owner's go on the mock, 2026-11-18:
 * https://claude.ai/artifact/Sr98ngzuijqUUhPbJNJAv4): one sentence on the
 * week ahead, the expected sales with last week beside them, what runs out
 * before the next delivery, and the first few calls with one button each.
 *
 * It forecasts nothing of its own. The week's total, the change on last week,
 * the accuracy and the labor gap are the figures the page's strip already
 * prints; the run-out rows are the shelf's; the calls are the queue's.
 */

export type DecisionsPlainTone = "good" | "warn" | "bad"

export interface DecisionsPlainRunOut {
  key: string
  name: string
  store: string | null
  /** "Thu 11/20 lunch" */
  when: string
  /** "2 cases", or empty when there is no order quantity. */
  qty: string
  href: string
}

export interface DecisionsPlainCall {
  key: string
  title: string
  why: string
  /** "$420/wk" */
  worth: string
  /** "decays daily", "by Fri", ... */
  when: string
  action: { label: string; href: string } | null
}

export interface DecisionsPlain {
  sentence: string
  /** Null when no forecast has been made for the week. */
  total: number | null
  /** "▲ 6.1% on last week" / "no comparison set": the strip's own words. */
  vs: string
  vsTone: "up" | "down" | "flat"
  sub: string
  statuses: Array<{ tone: DecisionsPlainTone; text: string }>
  runOut: DecisionsPlainRunOut[]
  calls: DecisionsPlainCall[]
}

export interface DecisionsPlainInput {
  total: number | null
  /** Fraction against last week, or null with nothing to compare. */
  vsPrior: number | null
  /** The strip's words for that change. */
  vsText: string
  accuracy: { inside: number | null; sample: number }
  /** Scheduled − needed hours across the week; negative is short. Null when not computed. */
  laborGapHours: number | null
  laborShort: boolean
  /** The shelf's rows and its own "before delivery" count, or null when it could not be read. */
  runOut: {
    hot: number
    rows: ReadonlyArray<{
      key: string
      name: string
      store: string | null
      outLabel: string
      qty: string
      href: string
      tagTone: string
    }>
  } | null
  /** Why the shelf could not be read, in words, when `runOut` is null. */
  runOutNote: string | null
  calls: ReadonlyArray<{
    key: string
    title: string
    why: string
    lead: string
    unit?: string
    note: string
    act?: string
    href?: string
  }>
}

/** Run-out rows listed in the answer. The shelf below lists them all. */
export const RUN_OUT_SHOWN = 4

const pctWords = (v: number) => `${(Math.abs(v) * 100).toFixed(1).replace(/\.0$/, "")}%`

export function buildDecisionsPlain(input: DecisionsPlainInput): DecisionsPlain {
  // Past the reorder line, the shelf's own "before delivery" rows; its count is the shelf's too.
  const hot = (input.runOut?.rows ?? []).filter((r) => r.tagTone === "bad")
  const hotCount = input.runOut?.hot ?? 0
  const runOut = hot.slice(0, RUN_OUT_SHOWN).map((r) => ({
    key: r.key,
    name: r.name,
    store: r.store,
    when: r.outLabel,
    qty: r.qty,
    href: r.href,
  }))

  const calls = input.calls.map((c) => ({
    key: c.key,
    title: c.title,
    why: firstSentence(c.why),
    worth: `${c.lead}${c.unit ?? ""}`,
    when: c.note,
    action: c.href && c.act ? { label: c.act, href: c.href } : null,
  }))

  const parts: string[] = []
  if (input.total === null) {
    parts.push("No forecast has been made for this week yet.")
  } else {
    const change =
      input.vsPrior === null
        ? ""
        : Math.abs(input.vsPrior) < 0.0005
          ? ", level with last week"
          : `, ${input.vsPrior > 0 ? "up" : "down"} ${pctWords(input.vsPrior)} on last week`
    parts.push(`This week should sell about ${money(input.total)}${change}.`)
  }
  const first = runOut[0]
  if (first) {
    const where = first.store ? ` at ${first.store}` : ""
    parts.push(`${first.name}${where} runs out ${first.when}${first.qty ? ` unless you bring in ${first.qty}` : ""}.`)
  }
  if (calls.length > 0) parts.push(`The first call: ${lowerFirst(calls[0].title)}.`)
  else parts.push("No calls are waiting this week.")

  const statuses: DecisionsPlain["statuses"] = []
  if (hotCount > 0) statuses.push({ tone: "bad", text: `${count(hotCount)} running out before delivery` })
  if (input.laborShort && input.laborGapHours !== null && input.laborGapHours !== 0) {
    const h = Math.abs(input.laborGapHours)
    const n = Number.isInteger(h) ? count(h) : h.toFixed(1)
    statuses.push({ tone: "warn", text: `Schedule short ${n} ${h === 1 ? "hour" : "hours"}` })
  }
  const { inside, sample } = input.accuracy
  if (inside !== null && sample > 0) {
    statuses.push({
      tone: inside / sample >= 0.7 ? "good" : "warn",
      text: `Forecast in range on ${count(inside)} of ${count(sample)} days`,
    })
  } else {
    statuses.push({ tone: "warn", text: "Forecast accuracy not measured yet" })
  }
  if (input.runOut === null && input.runOutNote) statuses.push({ tone: "warn", text: input.runOutNote })

  return {
    sentence: parts.join(" "),
    total: input.total,
    vs: input.vsText,
    vsTone: input.vsPrior === null || Math.abs(input.vsPrior) < 0.0005 ? "flat" : input.vsPrior > 0 ? "up" : "down",
    sub:
      inside !== null && sample > 0
        ? `Recent forecasts landed in range on ${count(inside)} of ${count(sample)} days`
        : "Accuracy shows once a few forecast days have closed",
    statuses,
    runOut,
    calls,
  }
}

/** The claim, without the evidence that follows it. */
function firstSentence(body: string): string {
  const stop = body.indexOf(". ")
  return stop === -1 ? body : body.slice(0, stop + 1)
}

/** "Reprice the burger" inside a sentence; a leading acronym stays as it is. */
function lowerFirst(s: string): string {
  if (s.length < 2 || s[1] === s[1].toUpperCase()) return s
  return s[0].toLowerCase() + s.slice(1)
}
