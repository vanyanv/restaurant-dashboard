// scripts/audit-gross-sales-composition.ts
//
// What is actually inside `fpGrossSales` and `tpGrossSales`?
//
// The 2026-09-19 calculation audit closed 39 findings and left two questions
// open, because neither is answerable by reading the code: whether Otter's
// gross sales figure is tax-inclusive, and whether a marketplace service
// charge sits inside it. Both move the denominator of every cost percentage
// in the product — food cost, labour cost, prime cost and margin are all
// `something / Total Sales`.
//
// The audit assumed they needed a month of Otter statements read beside the
// P&L. They do not. Otter already sends gross AND net AND the components in
// between, and this asks which arithmetic reconciles them. Read-only.
//
// ─── What the code currently assumes ─────────────────────────────────────
//
//   `salesRowValues` in src/lib/pnl.ts builds Total Sales from the per-channel
//   GROSS figures, then posts tax as a NEGATIVE line (4100) and service
//   charges as a POSITIVE one (4040). Subtracting tax from gross is only
//   correct if gross already carries it. Adding service charges is only
//   correct if gross does not.
//
//   `computeDeposit` in src/lib/deposit.ts starts from NET and ADDS
//   `taxCollected` back, which is only correct if net excludes tax.
//
// Those are mutually consistent — gross carries tax, net does not — but
// consistency is not correctness, and a shared wrong assumption is exactly
// what a green test suite cannot see.
//
// ─── How it measures ─────────────────────────────────────────────────────
//
// Every store-day slice has a quantity this calls the LEFTOVER:
//
//     leftover = gross − net
//
// the part of gross that net does not account for. Under any reading of the
// columns that leftover is a sum of components gross carries and net does
// not, each independently in or out: the discount (is gross the list price or
// the discounted one?), sales tax, service charges, the marketplace's fees,
// and refunds. Five yes/no questions, enumerated as 32 compositions and
// scored against every slice.
//
// Four things that sound like details and are not:
//
//   **A term is decided only where it is material.** If a store took no
//   service charges on 80% of its days, those days predict the same leftover
//   either way and would pad both answers toward agreement — which reads as
//   "inconclusive" about a question the other 20% answer cleanly. Each term
//   gets its own verdict over its own discriminating rows.
//
//   **A null is not a zero.** A slice whose `netSales` Otter never sent
//   cannot be reconciled and is dropped; one whose `taxCollected` is null
//   cannot speak to the tax question though it may speak to the others.
//   Reading either as 0 manufactures a clean leftover out of a missing
//   column — the exact failure the audit this serves was about.
//
//   **Platforms are not pooled.** `OtterDailySummary` is unique on
//   (storeId, date, platform, paymentMethod), and Uber and DoorDash need not
//   define "gross sales" the same way. Pooling them turns two clean opposite
//   answers into one muddy 50%, and hides the finding that would matter most:
//   that `salesRowValues` sums them as though they agreed.
//
//   **The signs are measured, not asserted.** Otter's discount, fee and
//   refund columns arrive signed negative; `src/lib/deposit.ts` carries a
//   `signDrift` guard precisely because that can break. A script whose job is
//   to establish composition facts from data has no business asserting them,
//   so it prints what it found.
//
// ─── On the implied tax rate ─────────────────────────────────────────────
//
// There is a second, tempting method: each reading of gross implies a
// different taxable base, and only the true one divides into the tax at the
// statutory rate. It is reported below, and it is NOT a verdict, because it
// cannot be one. "Gross excludes tax and 90% of sales were taxable" and
// "gross includes tax and all of them were" imply the same pair of rates —
// they are observationally identical to this method. And the bias is one
// way: under-reported or partly exempt tax can only ever move the answer
// toward INCLUSIVE, which is what the P&L already assumes. California
// exempts cold food sold to go, so that is not a hypothetical.
//
// So the reconciliation above is the verdict, because it uses `net` — a
// column the rate method never touches. The rate is corroboration, and it is
// labelled as corroboration.
//
// Usage:
//   npm run audit:sales-composition
//   npm run audit:sales-composition -- --days=180
//   npm run audit:sales-composition -- --tax-rate=0.095
//   npm run audit:sales-composition -- --out=docs/audits/gross-composition.md

import fs from "node:fs"
import path from "node:path"

/* ── Tuning ───────────────────────────────────────────────────────────── */

/**
 * How close a prediction must come, as a share of the slice's own gross.
 *
 * It doubles as the materiality floor: a term worth less than this much of a
 * day's gross cannot be told apart from absent, so that day does not vote on
 * that term.
 */
export const TOLERANCE = 0.001

/**
 * The floor under that, in dollars.
 *
 * A CASH slice of $20 would otherwise get a two-cent budget while four
 * independently cent-rounded columns drift further than that between them,
 * and small slices would vote against the truth for no reason. The terms
 * being tested are 3–10% of gross, so a nickel costs no discriminating power.
 */
export const ABSOLUTE_TOLERANCE = 0.05

/* ── The model ────────────────────────────────────────────────────────── */

/**
 * One store-day slice — one store, one date, one platform, one payment
 * method, which is the grain `OtterDailySummary` is unique on.
 *
 * Every component is nullable because Otter genuinely omits columns and a
 * missing column is not a zero one. `gross` and `net` are not: a row that
 * cannot supply both is dropped before it gets here, as there is nothing to
 * reconcile without them.
 */
export type Row = {
  platform: string
  gross: number
  net: number
  discounts: number | null
  tax: number | null
  serviceCharges: number | null
  fees: number | null
  refunds: number | null
}

/** The five components gross may or may not carry. */
export const TERMS = ["discounts", "tax", "serviceCharges", "fees", "refunds"] as const
export type Term = (typeof TERMS)[number]

export const TERM_LABEL: Record<Term, string> = {
  discounts: "the discount (gross is the list price)",
  tax: "sales tax",
  serviceCharges: "service charges",
  fees: "the marketplace's fees",
  refunds: "refunds and adjustments",
}

/** What gross carries: one independent yes/no per term. */
export type Composition = Record<Term, boolean>

/** All 32, since the five questions are independent of each other. */
export function allCompositions(): Composition[] {
  let out: Composition[] = [{} as Composition]
  for (const t of TERMS) {
    const next: Composition[] = []
    for (const c of out) {
      next.push({ ...c, [t]: false }, { ...c, [t]: true })
    }
    out = next
  }
  return out
}

/** The part of gross that net does not account for. */
export function leftover(r: Row): number {
  return r.gross - r.net
}

/**
 * What a term adds to the leftover when gross carries it, or null when Otter
 * sent no reading for it.
 *
 * Discounts, fees and refunds arrive as signed deductions, so a gross that
 * still carries them is LARGER than a net that has had them taken out —
 * hence the negation, which puts every term on the same footing as a
 * positive contribution to the leftover. Whether those columns really do
 * arrive negative is measured and printed rather than assumed; see
 * `signProfile`.
 */
export function termAmount(r: Row, t: Term): number | null {
  switch (t) {
    case "tax":
      return r.tax
    case "serviceCharges":
      return r.serviceCharges
    case "discounts":
      return r.discounts == null ? null : -r.discounts
    case "fees":
      return r.fees == null ? null : -r.fees
    case "refunds":
      return r.refunds == null ? null : -r.refunds
  }
}

/** The leftover a composition predicts, or null if a term it needs is absent. */
export function predictLeftover(r: Row, c: Composition): number | null {
  let sum = 0
  for (const t of TERMS) {
    if (!c[t]) continue
    const v = termAmount(r, t)
    if (v == null) return null
    sum += v
  }
  return sum
}

/** The dollar budget a slice gets before it counts as not reconciling. */
export function toleranceFor(r: Row): number {
  return Math.max(TOLERANCE * r.gross, ABSOLUTE_TOLERANCE)
}

/**
 * Whether this slice can tell the two answers for a term apart.
 *
 * A day that took no service charges predicts the same leftover either way,
 * so counting it as agreement for both would drown the signal from the days
 * that did.
 */
export function isMaterial(r: Row, t: Term): boolean {
  if (r.gross <= 0) return false
  const v = termAmount(r, t)
  if (v == null) return false
  return Math.abs(v) > toleranceFor(r)
}

/* ── Scoring ──────────────────────────────────────────────────────────── */

export type Score = {
  /** Slices that could be scored at all. */
  rows: number
  /** Share reconciling, or null when nothing could be scored. */
  hitRate: number | null
  /** Mean |residual| as a share of gross, or null. */
  meanAbsResidualPct: number | null
  /** Signed mean residual, which names the direction of the error, or null. */
  meanSignedResidualPct: number | null
}

const NOTHING: Score = {
  rows: 0,
  hitRate: null,
  meanAbsResidualPct: null,
  meanSignedResidualPct: null,
}

export function scoreComposition(rows: Row[], c: Composition): Score {
  let hits = 0
  let absSum = 0
  let signedSum = 0
  let counted = 0

  for (const r of rows) {
    // A day with no takings cannot discriminate between compositions that
    // differ by a share of takings, and dividing by it would produce
    // Infinity. The guard is `<= 0` rather than `=== 0`: a fully refunded day
    // reports a negative gross, and a negative denominator silently inverts
    // the residual's sign instead of throwing.
    if (r.gross <= 0) continue
    const predicted = predictLeftover(r, c)
    if (predicted == null) continue

    const residual = leftover(r) - predicted
    if (Math.abs(residual) <= toleranceFor(r)) hits += 1
    absSum += Math.abs(residual) / r.gross
    signedSum += residual / r.gross
    counted += 1
  }

  // Zero would read as a perfect fit for an empty set, which is the most
  // misleading possible default for a diagnostic.
  if (counted === 0) return NOTHING

  return {
    rows: counted,
    hitRate: hits / counted,
    meanAbsResidualPct: absSum / counted,
    meanSignedResidualPct: signedSum / counted,
  }
}

/** The composition that reconciles the most slices. */
export function bestComposition(rows: Row[]): { composition: Composition; score: Score } {
  let best: { composition: Composition; score: Score } | null = null
  for (const c of allCompositions()) {
    const score = scoreComposition(rows, c)
    if (score.hitRate == null) continue
    if (
      best == null ||
      best.score.hitRate == null ||
      score.hitRate > best.score.hitRate ||
      (score.hitRate === best.score.hitRate &&
        (score.meanAbsResidualPct ?? 1) < (best.score.meanAbsResidualPct ?? 1))
    ) {
      best = { composition: c, score }
    }
  }
  return best ?? { composition: allCompositions()[0], score: NOTHING }
}

export type TermVerdict = {
  term: Term
  /** true = gross carries it, false = it does not, null = the data cannot say. */
  carried: boolean | null
  /** Slices on which this term was material enough to vote. */
  decidingRows: number
  /** How the winning answer scored on those slices. */
  hitRate: number | null
  /** How the opposite answer scored on the same slices. */
  flippedHitRate: number | null
}

/**
 * Decide one term on the slices that can actually speak to it.
 *
 * Takes the best overall composition and flips this one term, then compares
 * the two over the rows where the term is material. Scoring the flip over ALL
 * rows instead is what made an earlier version report "inconclusive" about a
 * cleanly answered tax question: a term that is zero on most days makes both
 * answers agree on most days, and that agreement is about nothing.
 */
export function decideTerm(rows: Row[], best: Composition, term: Term): TermVerdict {
  const deciding = rows.filter((r) => isMaterial(r, term))
  const flipped: Composition = { ...best, [term]: !best[term] }

  const here = scoreComposition(deciding, best)
  const there = scoreComposition(deciding, flipped)

  const decided =
    here.hitRate != null && there.hitRate != null && here.hitRate >= 0.9 && there.hitRate < 0.5

  return {
    term,
    carried: decided ? best[term] : null,
    decidingRows: deciding.length,
    hitRate: here.hitRate,
    flippedHitRate: there.hitRate,
  }
}

/* ── Sign profile ─────────────────────────────────────────────────────── */

export type SignProfile = {
  term: Term
  positive: number
  negative: number
  zero: number
  absent: number
}

/** The raw column behind a term, before any negation. */
function rawColumn(r: Row, t: Term): number | null {
  switch (t) {
    case "tax":
      return r.tax
    case "serviceCharges":
      return r.serviceCharges
    case "discounts":
      return r.discounts
    case "fees":
      return r.fees
    case "refunds":
      return r.refunds
  }
}

/**
 * What sign each column actually arrives with.
 *
 * `termAmount` negates the deduction columns on the convention that Otter
 * sends them negative. If that convention ever breaks for one platform, every
 * formula here is wrong by twice the term on those rows and the only symptom
 * is a depressed hit rate with no explanation. So it is measured.
 */
export function signProfile(rows: Row[], t: Term): SignProfile {
  let positive = 0
  let negative = 0
  let zero = 0
  let absent = 0
  for (const r of rows) {
    const raw = rawColumn(r, t)
    if (raw == null) absent += 1
    else if (raw > 0) positive += 1
    else if (raw < 0) negative += 1
    else zero += 1
  }
  return { term: t, positive, negative, zero, absent }
}

/* ── The implied tax rate (corroboration only) ────────────────────────── */

/**
 * The sales tax rate each reading of `gross` implies.
 *
 * Tax is charged on what was actually sold — the subtotal after discounts,
 * never on the tax itself. So the base is gross with whatever that reading
 * says is in it taken back out. `discountsCarried` says which of those the
 * reconciliation found, since a gross that is already discounted must not
 * have the discount taken out again.
 *
 * The discount term is why this is not simply `tax / gross`. An earlier
 * version divided by gross and by `gross − tax`, and on a fixture whose gross
 * was known to EXCLUDE tax it reported 9.57% for the inclusive reading and
 * 8.73% for the exclusive one — both within a point of statutory, the wrong
 * one closer.
 *
 * Only slices carrying a tax reading count: a null tax counted as $0 of tax
 * on a real base drags the pooled rate down by exactly the share of such
 * rows, and that is enough to flip the answer.
 */
export function impliedTaxRates(
  rows: Row[],
  discountsCarried: boolean,
): { inclusive: number | null; exclusive: number | null } {
  let tax = 0
  let baseInclusive = 0
  let baseExclusive = 0

  for (const r of rows) {
    if (r.gross <= 0 || r.tax == null) continue
    if (discountsCarried && r.discounts == null) continue
    const base = r.gross + (discountsCarried ? (r.discounts as number) : 0)
    tax += r.tax
    baseInclusive += base - r.tax
    baseExclusive += base
  }

  return {
    inclusive: baseInclusive > 0 ? tax / baseInclusive : null,
    exclusive: baseExclusive > 0 ? tax / baseExclusive : null,
  }
}

/**
 * Which reading the implied rates POINT AT — never a verdict on its own.
 *
 * Two independent reasons it cannot be one:
 *
 * It is not identified. "Gross excludes tax, 90% of sales taxable" and
 * "gross includes tax, all taxable" produce the same pair of rates. Worse,
 * the error is one-directional: missing or exempt tax can only ever move
 * this toward INCLUSIVE, which is what the P&L already assumes, so a script
 * that trusted it could only rubber-stamp the thing it was built to test.
 *
 * And the thresholds have to be RELATIVE, because the separation is. When
 * gross is tax-inclusive at rate r the other reading implies r/(1+r), a gap
 * of r²/(1+r): 0.82 points at 9.5% but 0.24 at 5%. A fixed half-point margin
 * answers confidently in Los Angeles and refuses to answer in a lower-rate
 * jurisdiction on data just as exact. Nor is "within a point" enough — both
 * readings can sit inside any fixed window at once, and on one fixture both
 * did while the right answer sat exactly on the number.
 */
export function taxRateVerdict(
  rates: { inclusive: number | null; exclusive: number | null },
  statutory: number,
  opts: {
    /** Winner must sit within this share of the statutory rate. */
    tolerance?: number
    /** Loser's gap must be at least this many times the winner's. */
    separation?: number
  } = {},
): "inclusive" | "exclusive" | null {
  if (!Number.isFinite(statutory) || statutory <= 0) return null

  const tolerance = (opts.tolerance ?? 0.1) * statutory
  const separation = opts.separation ?? 3

  const gap = (v: number | null) =>
    v == null || !Number.isFinite(v) ? null : Math.abs(v - statutory)
  const gi = gap(rates.inclusive)
  const ge = gap(rates.exclusive)

  if (gi == null || ge == null) return null

  // `gi < ge` as well as the ratio, so a gap of exactly zero beats a zero
  // loser gap rather than tying with it.
  if (gi <= tolerance && gi * separation <= ge && gi < ge) return "inclusive"
  if (ge <= tolerance && ge * separation <= gi && ge < gi) return "exclusive"
  return null
}

/* ── Reporting ────────────────────────────────────────────────────────── */

/** Format a ratio as a percentage, or an em dash for no reading. */
const pct = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(2)}%`)

/** Format a number of dollars. */
const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Describe a composition in words. */
export function describe(c: Composition): string {
  const carried = TERMS.filter((t) => c[t]).map((t) => TERM_LABEL[t])
  return carried.length === 0 ? "gross carries none of them" : `gross carries ${carried.join(", ")}`
}

/** Render the per-term verdict table for one group of slices. */
function termTable(rows: Row[], best: Composition, out: string[]): TermVerdict[] {
  out.push(
    "| component | inside gross? | decided on | it reconciles | the opposite |",
    "| --- | --- | --- | --- | --- |",
  )
  const verdicts = TERMS.map((t) => decideTerm(rows, best, t))
  for (const v of verdicts) {
    const answer = v.carried == null ? "cannot tell" : v.carried ? "**yes**" : "**no**"
    const where =
      v.decidingRows === 0 ? "nothing to decide on" : `${v.decidingRows.toLocaleString()} slices`
    out.push(
      `| ${TERM_LABEL[v.term]} | ${answer} | ${where} | ${pct(v.hitRate)} | ${pct(v.flippedHitRate)} |`,
    )
  }
  out.push("")
  return verdicts
}

/** Analyse one group — a platform, or a whole side of the house. */
function analyse(title: string, rows: Row[], statutory: number, out: string[], depth: number): void {
  out.push(`${"#".repeat(depth)} ${title}`, "")

  const usable = rows.filter((r) => r.gross > 0)
  if (usable.length === 0) {
    out.push("No slices with positive gross sales. Nothing to test.", "")
    return
  }

  const grossTotal = usable.reduce((s, r) => s + r.gross, 0)
  out.push(
    `${usable.length.toLocaleString()} store-day slices with takings, ` +
      `${money(grossTotal)} gross. A slice is one store, one date, one platform, ` +
      "one payment method — the grain the table is unique on, so this is not a " +
      "count of days.",
    "",
  )

  const { composition: best, score } = bestComposition(usable)
  const verdicts = termTable(usable, best, out)

  out.push(
    `Best overall reading: ${describe(best)} — reconciles ${pct(score.hitRate)} of ` +
      `the ${score.rows.toLocaleString()} slices it could score.`,
    "",
  )

  if (score.hitRate != null && score.hitRate < 0.9) {
    out.push(
      "**That is a poor fit**, so the per-term answers above are not safe to act " +
        "on: none of the 32 readings describes what Otter is sending here, and " +
        "something outside this model is moving these figures.",
      "",
    )
  }

  // ── Corroboration, explicitly not a verdict ──
  const rates = impliedTaxRates(usable, best.discounts)
  const anchor = taxRateVerdict(rates, statutory)
  const taxVerdict = verdicts.find((v) => v.term === "tax")

  out.push(
    `Implied tax rate, against a statutory ${pct(statutory)}: ` +
      `${pct(rates.inclusive)} if gross carries tax, ${pct(rates.exclusive)} if not — ` +
      `pointing at **${anchor ?? "neither"}**. This corroborates, it does not decide: ` +
      'missing or exempt tax can only ever pull it toward "carries tax", which is ' +
      "what the P&L already assumes.",
    "",
  )

  if (taxVerdict?.carried != null && anchor != null) {
    const agree =
      (taxVerdict.carried && anchor === "inclusive") ||
      (!taxVerdict.carried && anchor === "exclusive")
    out.push(
      agree
        ? "It agrees with the reconciliation above, and the two share no " +
            "arithmetic — one uses `net`, the other never touches it."
        : "**It disagrees with the reconciliation above.** The rate method is " +
            "biased toward \"carries tax\" and the reconciliation is not, so the " +
            "reconciliation is the one to believe — but not before the gap is " +
            "understood.",
      "",
    )
  }
}

/** Render the raw sign of every column, since the formulas depend on it. */
function signTable(rows: Row[], out: string[]): void {
  out.push(
    "### Column signs, as they actually arrived",
    "",
    "The formulas negate the deduction columns on the convention that Otter " +
      "sends them negative. `src/lib/deposit.ts` carries a `signDrift` guard " +
      "because that convention can break, so it is measured here rather than " +
      "assumed.",
    "",
    "| column | positive | negative | zero | absent |",
    "| --- | --- | --- | --- | --- |",
  )
  for (const t of TERMS) {
    const p = signProfile(rows, t)
    out.push(
      `| ${TERM_LABEL[t]} | ${p.positive.toLocaleString()} | ${p.negative.toLocaleString()} | ` +
        `${p.zero.toLocaleString()} | ${p.absent.toLocaleString()} |`,
    )
  }
  out.push("")
}

/* ── Main ─────────────────────────────────────────────────────────────── */

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const i = t.indexOf("=")
    if (i === -1) continue
    const k = t.slice(0, i).trim()
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[k]) process.env[k] = v
  }
}

/** Read `--name=value` off the command line, or null if it was not passed. */
function arg(name: string): string | null {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

/**
 * A numeric flag, rejected loudly rather than propagating NaN.
 *
 * `--days=abc` used to reach `setUTCDate(NaN)` and fail inside Prisma with an
 * opaque message; `--tax-rate=` used to print "NaN%" in a table without a word
 * of explanation.
 */
function numericArg(name: string, fallback: number, ok: (n: number) => boolean): number {
  const raw = arg(name)
  if (raw == null) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || !ok(n)) throw new Error(`--${name}=${raw} is not a usable value`)
  return n
}

async function main(): Promise<void> {
  loadEnvLocal()

  const days = numericArg("days", 365, (n) => n > 0 && n <= 3650)
  // Statutory combined sales tax for these stores; Los Angeles County is 9.5%
  // as of 2026. It feeds only the corroborating rate, never the verdict.
  const statutory = numericArg("tax-rate", 0.095, (n) => n > 0 && n < 1)
  const outPath = arg("out")

  // Imported after `loadEnvLocal` so DATABASE_URL is populated. The shared
  // client rather than a fresh one: it already strips `sslmode` and decides
  // TLS by host, so this runs against Neon and a local Postgres alike.
  const { prisma } = await import("@/lib/prisma")

  try {
    const since = new Date()
    since.setUTCDate(since.getUTCDate() - days)

    const rows = await prisma.otterDailySummary.findMany({
      where: { date: { gte: since } },
      select: {
        platform: true,
        fpGrossSales: true,
        fpNetSales: true,
        fpDiscounts: true,
        fpTaxCollected: true,
        fpServiceCharges: true,
        fpFees: true,
        tpGrossSales: true,
        tpNetSales: true,
        tpDiscounts: true,
        tpTaxCollected: true,
        tpServiceCharges: true,
        tpFees: true,
        tpRefundsAdjustments: true,
      },
    })

    // A row carries either first-party or third-party financials, not both.
    // A missing gross means it is not of that kind at all; a missing NET means
    // it is, but cannot be reconciled — reading that as 0 would make the
    // leftover the whole of gross and hand a false vote to whichever
    // composition sums near it. Those are dropped. Every other component stays
    // null, and a null simply keeps that slice out of that term's vote.
    const isRow = (r: Row | null): r is Row => r !== null

    const fp: Row[] = rows
      .map((r): Row | null =>
        r.fpGrossSales == null || r.fpNetSales == null
          ? null
          : {
              platform: r.platform,
              gross: r.fpGrossSales,
              net: r.fpNetSales,
              discounts: r.fpDiscounts,
              tax: r.fpTaxCollected,
              serviceCharges: r.fpServiceCharges,
              fees: r.fpFees,
              // First party has no refunds column on this model.
              refunds: null,
            },
      )
      .filter(isRow)

    const tp: Row[] = rows
      .map((r): Row | null =>
        r.tpGrossSales == null || r.tpNetSales == null
          ? null
          : {
              platform: r.platform,
              gross: r.tpGrossSales,
              net: r.tpNetSales,
              discounts: r.tpDiscounts,
              tax: r.tpTaxCollected,
              serviceCharges: r.tpServiceCharges,
              fees: r.tpFees,
              refunds: r.tpRefundsAdjustments,
            },
      )
      .filter(isRow)

    const dropped =
      rows.filter((r) => r.fpGrossSales != null && r.fpNetSales == null).length +
      rows.filter((r) => r.tpGrossSales != null && r.tpNetSales == null).length

    const doc: string[] = []
    doc.push(
      "# What is inside Otter's gross sales",
      "",
      `Generated ${new Date().toISOString().slice(0, 10)} over the last ${days} days ` +
        `(${rows.length.toLocaleString()} OtterDailySummary rows).`,
      "",
      "Every figure comes from columns Otter already sends and we already store. " +
        "No statement was read; nothing was assumed.",
      "",
    )

    if (dropped > 0) {
      doc.push(
        `${dropped.toLocaleString()} slices were dropped for having a gross figure ` +
          "but no net one, which cannot be reconciled either way.",
        "",
      )
    }

    for (const [title, side] of [
      ["First party — the counter and the website", fp],
      ["Third party — the marketplaces", tp],
    ] as Array<[string, Row[]]>) {
      doc.push(`## ${title}`, "")
      if (side.length === 0) {
        doc.push("No slices. Nothing to test.", "")
        continue
      }

      signTable(side, doc)

      // Per platform BEFORE pooling: two marketplaces need not define gross
      // the same way, and pooling two clean opposite answers yields one muddy
      // 50% that reads as "inconclusive" while hiding the finding that
      // matters most — that `salesRowValues` sums them as though they agreed.
      const platforms = [...new Set(side.map((r) => r.platform))].sort()
      for (const p of platforms) {
        analyse(
          p,
          side.filter((r) => r.platform === p),
          statutory,
          doc,
          3,
        )
      }
      if (platforms.length > 1) analyse("All platforms pooled", side, statutory, doc, 3)
    }

    doc.push(
      "## What this changes",
      "",
      "Two lines in `salesRowValues` (src/lib/pnl.ts) depend on the answer:",
      "",
      "- **4100 Tax** is posted as a negative against the per-channel GROSS " +
        "figures. If gross does NOT carry tax, that line subtracts tax that was " +
        "never added, and Total Sales — the denominator of food cost, labour " +
        "cost, prime cost and margin — is understated by the whole tax take.",
      "- **4040 Service charge** is added on top of gross. If gross already " +
        "carries service charges, that line double-counts them.",
      "",
      "If the per-platform tables above disagree with each other, that is itself " +
        "the finding: `salesRowValues` sums the marketplaces into one Total Sales " +
        "as though they shared a definition.",
      "",
      "`computeDeposit` (src/lib/deposit.ts) takes the matching positions from the " +
        "other end: it adds `taxCollected` back to NET and counts `serviceCharges` " +
        "as money reaching the bank. The first is consistent with a gross that " +
        "carries tax and a net that does not. The second is a separate claim about " +
        "WHO KEEPS the service charge, which nothing here can answer — this " +
        "measures whether the charge sits inside gross, not whether it is paid out " +
        "to the restaurant. That shows up in a payout statement or the bank.",
      "",
    )

    const text = doc.join("\n")
    if (outPath) {
      fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
      fs.writeFileSync(path.resolve(outPath), text)
      console.log(`Wrote ${outPath}`)
    } else {
      console.log(text)
    }
  } finally {
    await prisma.$disconnect()
  }
}

// Only when run as a script. Importing this module — the test suite does, to
// drive the scoring over synthetic rows — must not read .env.local, mutate
// the environment, or open a database connection.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
