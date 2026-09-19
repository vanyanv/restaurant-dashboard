// scripts/audit-gross-sales-composition.ts
//
// What is actually inside `fpGrossSales` and `tpGrossSales`?
//
// The 2026-09-19 calculation audit closed 39 findings and left two questions
// open, because neither is answerable by reading the code: whether Otter's
// gross sales figure is tax-inclusive, and whether a marketplace service
// charge is money the restaurant receives. Both move the denominator of
// every cost percentage in the product — food cost, labour cost, prime cost
// and margin are all `something / Total Sales`.
//
// The audit assumed they needed a month of Otter statements read beside the
// P&L. They do not. Otter already sends us gross AND net AND each component
// in between, and this script asks which arithmetic reconciles them. It is
// read-only and takes about a second.
//
// ─── What the code currently assumes ─────────────────────────────────────
//
// Two modules take a position, and neither cites evidence:
//
//   `salesRowValues` in src/lib/pnl.ts builds Total Sales from the per-channel
//   GROSS figures, then posts tax as a NEGATIVE line (4100) and service
//   charges as a POSITIVE one (4040). Subtracting tax from gross is only
//   correct if gross already contains it. Adding service charges to gross is
//   only correct if gross does NOT already contain them.
//
//   `computeDeposit` in src/lib/deposit.ts starts from NET, then ADDS
//   `taxCollected` back. That is only correct if net excludes tax. It also
//   adds `serviceCharges` into the expected bank deposit, which is only
//   correct if that money reaches the restaurant rather than the marketplace.
//
// Those two are mutually consistent — gross inclusive, net exclusive — but
// consistency is not correctness, and a shared wrong assumption is exactly
// what a green test suite cannot see. Hence: measure it.
//
// ─── What this measures ──────────────────────────────────────────────────
//
// For every store-day Otter has sent, the script evaluates each candidate
// identity and reports the residual as a share of gross. The identity that
// reconciles to ~0 across thousands of rows is the true one; the others will
// sit at roughly the size of whatever term they got wrong.
//
// It also computes the implied tax rate under each hypothesis. That is an
// external anchor: the statutory rate in the stores' jurisdiction is a known
// number, so whichever hypothesis produces it is the right one, independent
// of any assumption about how Otter defines "net".
//
// Usage:
//   npx tsx scripts/audit-gross-sales-composition.ts
//   npx tsx scripts/audit-gross-sales-composition.ts --days=180
//   npx tsx scripts/audit-gross-sales-composition.ts --tax-rate=0.095
//   npx tsx scripts/audit-gross-sales-composition.ts --out=docs/audits/gross-composition.md

import fs from "node:fs"
import path from "node:path"

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
loadEnvLocal()

/* ── CLI ──────────────────────────────────────────────────────────────── */

function arg(name: string): string | null {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

const DAYS = Number(arg("days") ?? 365)
/**
 * The statutory combined sales tax rate to compare the implied rate against.
 * Los Angeles County is 9.5% as of 2026. Override for another jurisdiction;
 * this is a reference point for the reader, never an input to the verdict.
 */
const STATUTORY_TAX_RATE = Number(arg("tax-rate") ?? 0.095)
const OUT = arg("out")

/**
 * A row reconciles if its residual is within this share of its own gross.
 * Otter rounds to cents and we are summing six columns, so exact zero is not
 * the bar; a tenth of a percent is far tighter than the ~9.5% and ~3% terms
 * the hypotheses differ by, so nothing here turns on the exact value.
 */
export const TOLERANCE = 0.001

/* ── Candidate identities ─────────────────────────────────────────────── */

export type Row = {
  gross: number
  net: number
  discounts: number
  tax: number
  serviceCharges: number
  fees: number
}

/**
 * Each hypothesis says what `net` should equal, given `gross`.
 *
 * Otter's discount and fee columns arrive SIGNED NEGATIVE — `salesRowValues`
 * documents this for discounts ("do not negate") and `computeDeposit` for
 * fees ("Signed deduction ... Expected <= 0"). So every term is added, and a
 * hypothesis that wants to remove something adds a negative.
 */
export const HYPOTHESES: Array<{
  key: string
  claim: string
  predictNet: (r: Row) => number
}> = [
  {
    key: "gross-excl-tax",
    claim: "gross excludes tax; net is gross less discounts",
    predictNet: (r) => r.gross + r.discounts,
  },
  {
    key: "gross-incl-tax",
    claim: "gross INCLUDES tax; net is gross less discounts and less tax",
    predictNet: (r) => r.gross + r.discounts - r.tax,
  },
  {
    key: "gross-incl-tax-and-service",
    claim: "gross includes tax AND service charges; net strips both",
    predictNet: (r) => r.gross + r.discounts - r.tax - r.serviceCharges,
  },
  {
    key: "gross-incl-tax-net-of-fees",
    claim: "gross includes tax; net is also net of the marketplace's fees",
    predictNet: (r) => r.gross + r.discounts - r.tax + r.fees,
  },
]

/* ── Scoring ──────────────────────────────────────────────────────────── */

export type Score = {
  key: string
  claim: string
  rows: number
  /** Share of rows reconciling within TOLERANCE of their own gross. */
  hitRate: number
  /** Mean |residual| as a share of gross — the size of what it got wrong. */
  meanAbsResidualPct: number
  /** Signed mean residual, which names the direction of the error. */
  meanSignedResidualPct: number
}

export function score(rows: Row[], h: (typeof HYPOTHESES)[number]): Score {
  let hits = 0
  let absSum = 0
  let signedSum = 0
  let counted = 0

  for (const r of rows) {
    // A day with no takings cannot discriminate between hypotheses that
    // differ only by a share of takings, and dividing by it would produce
    // Infinity. Guard on `<= 0` rather than `=== 0`: a fully refunded day
    // reports a negative gross, and a negative denominator silently inverts
    // the residual's sign instead of throwing.
    if (r.gross <= 0) continue
    const residual = r.net - h.predictNet(r)
    const pct = residual / r.gross
    if (Math.abs(pct) <= TOLERANCE) hits += 1
    absSum += Math.abs(pct)
    signedSum += pct
    counted += 1
  }

  return {
    key: h.key,
    claim: h.claim,
    rows: counted,
    hitRate: counted === 0 ? 0 : hits / counted,
    meanAbsResidualPct: counted === 0 ? 0 : absSum / counted,
    meanSignedResidualPct: counted === 0 ? 0 : signedSum / counted,
  }
}

/**
 * The sales tax rate each reading of `gross` implies, to compare against the
 * statutory one.
 *
 * Tax is charged on what was actually sold, which is the subtotal after
 * discounts — never on the tax itself. So the base is `gross` with whatever
 * that reading says is in it taken back out:
 *
 *   gross tax-INCLUSIVE → base = gross + discounts − tax
 *   gross tax-EXCLUSIVE → base = gross + discounts
 *
 * The discount term is why this is not simply `tax / gross`. An earlier
 * version divided by gross and by `gross − tax`, and on a fixture whose gross
 * was known to EXCLUDE tax it reported 9.57% for the inclusive reading and
 * 8.73% for the exclusive one — both within a point of the statutory 9.5%,
 * the wrong one closer, and the verdict came out "neither". Discounts shrink
 * the taxable base without shrinking gross, so a ratio taken over gross is
 * biased low by however much was discounted, and the bias is large enough to
 * outvote the thing being measured.
 *
 * Returns null for a reading whose base is not positive, rather than a rate
 * derived from a negative denominator: the ratio stays finite and merely
 * changes sign, which would read as a plausible answer.
 */
export function impliedTaxRates(rows: Row[]): {
  inclusive: number | null
  exclusive: number | null
} {
  let tax = 0
  let baseInclusive = 0
  let baseExclusive = 0

  for (const r of rows) {
    if (r.gross <= 0) continue
    tax += r.tax
    baseInclusive += r.gross + r.discounts - r.tax
    baseExclusive += r.gross + r.discounts
  }

  return {
    inclusive: baseInclusive > 0 ? tax / baseInclusive : null,
    exclusive: baseExclusive > 0 ? tax / baseExclusive : null,
  }
}

/**
 * Which reading of `gross` the implied rates favour, or null for neither.
 *
 * Deliberately NOT "within a point of statutory": both readings can sit inside
 * any fixed window at once. On a fixture whose gross was known to exclude tax,
 * the two implied rates came out 9.50% and 10.50% against a statutory 9.50%,
 * and a one-point window called that a tie — the right answer was sitting
 * exactly on the number. So the test is comparative: one reading must be close
 * to statutory AND clearly closer than the other.
 *
 * Returns null when neither qualifies, which is a real outcome and not a
 * fallback — non-taxable sales or the wrong jurisdiction's rate both land
 * here, and both mean the reader should look rather than be told.
 */
export function taxRateVerdict(
  rates: { inclusive: number | null; exclusive: number | null },
  statutory: number,
  /** How near the winner must sit, and how far it must beat the loser by. */
  opts: { tolerance?: number; margin?: number } = {},
): "inclusive" | "exclusive" | null {
  const tolerance = opts.tolerance ?? 0.005
  const margin = opts.margin ?? 0.005

  const gap = (v: number | null) => (v == null ? null : Math.abs(v - statutory))
  const gi = gap(rates.inclusive)
  const ge = gap(rates.exclusive)

  if (gi == null && ge == null) return null
  if (ge == null) return gi != null && gi <= tolerance ? "inclusive" : null
  if (gi == null) return ge <= tolerance ? "exclusive" : null

  if (gi <= tolerance && ge - gi >= margin) return "inclusive"
  if (ge <= tolerance && gi - ge >= margin) return "exclusive"
  return null
}

/* ── Reporting ────────────────────────────────────────────────────────── */

const pct = (n: number) => `${(n * 100).toFixed(2)}%`
const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function section(title: string, rows: Row[], out: string[]): void {
  out.push(`## ${title}`, "")

  const usable = rows.filter((r) => r.gross > 0)
  if (usable.length === 0) {
    out.push(`No rows with positive gross sales. Nothing to test.`, "")
    return
  }

  const grossTotal = usable.reduce((s, r) => s + r.gross, 0)
  const taxTotal = usable.reduce((s, r) => s + r.tax, 0)
  const svcTotal = usable.reduce((s, r) => s + r.serviceCharges, 0)

  out.push(
    `${usable.length.toLocaleString()} store-days with takings. ` +
      `Gross ${money(grossTotal)}, tax collected ${money(taxTotal)}, ` +
      `service charges ${money(svcTotal)}.`,
    "",
  )

  // ── Which identity reconciles ──
  const scores = HYPOTHESES.map((h) => score(usable, h)).sort(
    (a, b) => b.hitRate - a.hitRate || a.meanAbsResidualPct - b.meanAbsResidualPct,
  )

  out.push("| identity | reconciles | mean error | direction |", "| --- | --- | --- | --- |")
  for (const s of scores) {
    out.push(
      `| ${s.claim} | ${pct(s.hitRate)} | ${pct(s.meanAbsResidualPct)} | ` +
        `${s.meanSignedResidualPct >= 0 ? "+" : ""}${pct(s.meanSignedResidualPct)} |`,
    )
  }
  out.push("")

  const best = scores[0]
  const runnerUp = scores[1]
  const decisive = best.hitRate >= 0.9 && (!runnerUp || runnerUp.hitRate < 0.5)

  out.push(
    decisive
      ? `**${best.claim}** — reconciles on ${pct(best.hitRate)} of store-days.`
      : `**Inconclusive.** The best identity reconciles on only ${pct(best.hitRate)} ` +
          `of store-days, so none of the four describes what Otter is sending. ` +
          `Read the per-term totals below before trusting any of them.`,
    "",
  )

  // ── The external anchor: what tax rate does each hypothesis imply? ──
  //
  // Independent of the reconciliation above, because it appeals to a number
  // from outside the data: the statutory rate. Each reading of `gross` implies
  // a different taxable base, and only the true one divides into the tax at
  // the rate the law actually charges.
  const rates = impliedTaxRates(usable)
  const impliedIfInclusive = rates.inclusive
  const impliedIfExclusive = rates.exclusive

  out.push(
    "### Implied tax rate",
    "",
    `Statutory rate for comparison: ${pct(STATUTORY_TAX_RATE)}.`,
    "",
    "| if gross is… | implied rate |",
    "| --- | --- |",
    `| tax-INCLUSIVE — base is gross + discounts − tax | ${impliedIfInclusive == null ? "n/a" : pct(impliedIfInclusive)} |`,
    `| tax-EXCLUSIVE — base is gross + discounts | ${impliedIfExclusive == null ? "n/a" : pct(impliedIfExclusive)} |`,
    "",
  )

  const verdict = taxRateVerdict(rates, STATUTORY_TAX_RATE)
  out.push(
    verdict === "inclusive"
      ? "Gross is **tax-inclusive**: only that reading produces the statutory rate."
      : verdict === "exclusive"
        ? "Gross is **tax-exclusive**: only that reading produces the statutory rate."
        : "Neither reading clearly produces the statutory rate. Either the rate " +
          "passed in is wrong for these stores, or some of this gross is not " +
          "taxable — check before drawing a conclusion from the table above.",
    "",
  )
}

/* ── Main ─────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  // The shared client rather than a fresh one: it already strips `sslmode`
  // and decides TLS by host, so this runs against Neon and against a local
  // Postgres without the script knowing the difference. Imported late so
  // `loadEnvLocal` has populated DATABASE_URL first.
  const { prisma } = await import("@/lib/prisma")

  try {
    const since = new Date()
    since.setUTCDate(since.getUTCDate() - DAYS)

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
      },
    })

    const out: string[] = []
    out.push(
      `# What is inside Otter's gross sales`,
      "",
      `Generated ${new Date().toISOString().slice(0, 10)} over the last ${DAYS} days ` +
        `(${rows.length.toLocaleString()} OtterDailySummary rows).`,
      "",
      `Every figure below comes from columns Otter already sends and we already ` +
        `store. No statement was read; nothing was assumed.`,
      "",
    )

    // A row carries either first-party or third-party financials, not both,
    // so each side is tested over the rows that actually populate it. A null
    // gross means the row is not of that kind; a null component on a row that
    // IS of that kind means Otter sent nothing for it, and zero is the right
    // reading of "no discounts were given", unlike a null gross.
    const fp: Row[] = rows
      .filter((r) => r.fpGrossSales != null)
      .map((r) => ({
        gross: r.fpGrossSales as number,
        net: r.fpNetSales ?? 0,
        discounts: r.fpDiscounts ?? 0,
        tax: r.fpTaxCollected ?? 0,
        serviceCharges: r.fpServiceCharges ?? 0,
        fees: r.fpFees ?? 0,
      }))

    const tp: Row[] = rows
      .filter((r) => r.tpGrossSales != null)
      .map((r) => ({
        gross: r.tpGrossSales as number,
        net: r.tpNetSales ?? 0,
        discounts: r.tpDiscounts ?? 0,
        tax: r.tpTaxCollected ?? 0,
        serviceCharges: r.tpServiceCharges ?? 0,
        fees: r.tpFees ?? 0,
      }))

    section("First party — the counter and the website", fp, out)
    section("Third party — Uber, DoorDash and the rest", tp, out)

    /* ── What it means for the P&L ── */
    out.push(
      "## What this changes",
      "",
      "Two lines in `salesRowValues` (src/lib/pnl.ts) depend on the answer:",
      "",
      "- **4100 Tax** is posted as a negative against the per-channel GROSS " +
        "figures. If gross turns out to be tax-EXCLUSIVE, that line is " +
        "subtracting tax that was never added, and Total Sales — the " +
        "denominator of food cost, labour cost, prime cost and margin — is " +
        "understated by the whole tax take.",
      "- **4040 Service charge** is added on top of gross. If gross already " +
        "contains service charges, that line double-counts them.",
      "",
      "`computeDeposit` (src/lib/deposit.ts) takes the matching positions from " +
        "the other end: it adds `taxCollected` back to NET, and it counts " +
        "`serviceCharges` as money reaching the bank. The first is consistent " +
        "with a tax-inclusive gross and a tax-exclusive net. The second is a " +
        "separate claim about who keeps the service charge, which the " +
        "reconciliation above can only answer for whether it sits inside gross " +
        "— whether it is PAID OUT to the restaurant is a contract question, and " +
        "the place it shows up is a payout statement or the bank.",
      "",
    )

    const text = out.join("\n")
    if (OUT) {
      fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true })
      fs.writeFileSync(path.resolve(OUT), text)
      console.log(`Wrote ${OUT}`)
    } else {
      console.log(text)
    }
  } finally {
    await prisma.$disconnect()
  }
}

// Only when run as a script. Importing this module (the test below does, to
// drive `score` over synthetic rows) must not open a database connection.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
