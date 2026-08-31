import { prisma } from "@/lib/prisma"
import { count, money, pct } from "@/lib/counter/format"
import { isNonIngredientRow } from "@/lib/invoice-charges"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import type { FigureProps, Row } from "@/components/counter"

/**
 * Ingredient audit — `P.moningredients`
 * (`docs/counter/counter-prototype.html`).
 *
 * ## Nothing has ever been auto-matched
 *
 * The prototype's strip reads "Auto-matched, 30d — 218, 94.5% held" and
 * "Reverted by hand — 12, 5.5% of auto-matches". `IngredientMatchDecision`
 * holds 21 SHADOW rows, 16 SUGGESTED, **0 APPLIED and 0 undone**. The feature
 * shipped behind `INGREDIENT_AUTO_MATCH` in shadow mode and stayed there, so
 * a held rate and a revert rate cannot be computed — there is nothing applied
 * to hold or revert. The page says that instead of dividing by zero and
 * printing a percentage.
 *
 * ## The catalogue thinks a fuel surcharge is an ingredient
 *
 * Two of the 76 canonicals are freight charges. 154 invoice lines of fuel
 * surcharge, in seven spellings, are matched to one of them as though it were
 * food — $1,389. Neither is in a recipe, so plate cost is unaffected; every
 * by-ingredient spend figure counts it. The second was created by the LLM
 * rung at 0.84 off a Sysco row printed `Miscellaneous Charge`.
 *
 * Those names are already declared non-goods in `@/lib/invoice-charges` —
 * `isNonIngredientRow`, written for the invoice reconciliation check. The
 * matcher does not consult it, and this page uses it to count the damage.
 *
 * ## Coverage runs the other way from the prototype
 *
 * It claims 128 unmatched SKUs and $4,120 uncosted. Measured: 24 unmatched
 * lines and $825, which is 98.6% of lines matched. Nineteen of the 24 are one
 * can liner under one SKU spelled eleven ways; the other five are charge rows
 * the ladder correctly declined, so the honest unmatched count is 19.
 *
 * What the matcher is FOR is the figure worth leading with: it holds 21
 * spellings of one potato roll together across $41,038 of purchases, and a
 * GROUP BY on the printed name would report twenty-one products.
 *
 * See `docs/counter/measurements/2026-08-29-monitoring-ingredient-audit.md`.
 */

/** Rows each table prints. */
const TABLE_ROWS = 10

interface DecisionRow {
  at: Date
  layer: string
  status: string
  confidence: number
  vendorName: string
  productName: string
  canonical: string
  lines: number
  undone: boolean
}

interface CanonicalRow {
  name: string
  skus: number
  recipes: number
  spellings: number
  lines: number
  spend: number
  charge: boolean
}

interface UnmatchedRow {
  vendor: string
  sku: string | null
  productName: string
  spend: number
  charge: boolean
}

interface SourceRow {
  source: string
  lines: number
  spend: number
}

interface IngredientAuditData {
  decisions: DecisionRow[]
  decisionCounts: Record<string, number>
  undoneCount: number
  canonicals: CanonicalRow[]
  canonicalTotal: number
  noRecipe: number
  chargeCanonicals: CanonicalRow[]
  unmatched: UnmatchedRow[]
  sources: SourceRow[]
}

/* ── Load ─────────────────────────────────────────────────────────────── */

async function loadAudit(): Promise<IngredientAuditData> {
  const [decisions, counts, undone, canonicals, unmatched, sources] = await Promise.all([
    prisma.ingredientMatchDecision.findMany({
      orderBy: { createdAt: "desc" },
      take: TABLE_ROWS,
      select: {
        createdAt: true,
        layer: true,
        status: true,
        confidence: true,
        vendorName: true,
        productName: true,
        linkedLineItemCount: true,
        undoneAt: true,
        canonicalIngredient: { select: { name: true } },
      },
    }),
    prisma.$queryRaw<Array<{ status: string; n: bigint }>>`
      SELECT status, COUNT(*) n FROM "IngredientMatchDecision" GROUP BY 1`,
    prisma.ingredientMatchDecision.count({ where: { undoneAt: { not: null } } }),
    prisma.$queryRaw<
      Array<{
        name: string
        skus: bigint
        recipes: bigint
        spellings: bigint
        lines: bigint
        spend: number | null
      }>
    >`
      SELECT c.name,
             (SELECT COUNT(*) FROM "IngredientSkuMatch" m WHERE m."canonicalIngredientId" = c.id) skus,
             (SELECT COUNT(*) FROM "RecipeIngredient" r WHERE r."canonicalIngredientId" = c.id) recipes,
             (SELECT COUNT(DISTINCT li."productName") FROM "InvoiceLineItem" li
                WHERE li."canonicalIngredientId" = c.id) spellings,
             (SELECT COUNT(*) FROM "InvoiceLineItem" li
                WHERE li."canonicalIngredientId" = c.id) lines,
             (SELECT COALESCE(SUM(li."extendedPrice"), 0) FROM "InvoiceLineItem" li
                WHERE li."canonicalIngredientId" = c.id) spend
      FROM "CanonicalIngredient" c`,
    prisma.invoiceLineItem.findMany({
      where: { canonicalIngredientId: null },
      orderBy: { extendedPrice: "desc" },
      select: {
        sku: true,
        productName: true,
        extendedPrice: true,
        invoice: { select: { vendorName: true } },
      },
    }),
    prisma.$queryRaw<Array<{ source: string; lines: bigint; spend: number | null }>>`
      SELECT COALESCE("matchSource", '(unmatched)') source,
             COUNT(*) lines,
             SUM("extendedPrice") spend
      FROM "InvoiceLineItem" GROUP BY 1 ORDER BY lines DESC`,
  ])

  const allCanonicals: CanonicalRow[] = canonicals.map((c) => ({
    name: c.name,
    skus: Number(c.skus),
    recipes: Number(c.recipes),
    spellings: Number(c.spellings),
    lines: Number(c.lines),
    spend: Number(c.spend ?? 0),
    charge: isNonIngredientRow(c.name) || /surcharge|pallet charge|sales tax/i.test(c.name),
  }))

  return {
    decisions: decisions.map((d) => ({
      at: d.createdAt,
      layer: d.layer,
      status: d.status,
      confidence: d.confidence,
      vendorName: d.vendorName,
      productName: d.productName,
      canonical: d.canonicalIngredient.name,
      lines: d.linkedLineItemCount,
      undone: d.undoneAt !== null,
    })),
    decisionCounts: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])),
    undoneCount: undone,
    canonicals: allCanonicals
      .filter((c) => !c.charge)
      .sort((a, b) => b.spellings - a.spellings)
      .slice(0, TABLE_ROWS),
    canonicalTotal: allCanonicals.length,
    noRecipe: allCanonicals.filter((c) => c.recipes === 0).length,
    chargeCanonicals: allCanonicals.filter((c) => c.charge),
    unmatched: unmatched.map((u) => ({
      vendor: u.invoice.vendorName ?? "—",
      sku: u.sku,
      productName: u.productName,
      spend: u.extendedPrice,
      charge: isNonIngredientRow(u.productName),
    })),
    sources: sources.map((s) => ({
      source: s.source,
      lines: Number(s.lines),
      spend: Number(s.spend ?? 0),
    })),
  }
}

/* ── Shaping ──────────────────────────────────────────────────────────── */

/** `auto-vector` / `suggest-llm` are internal names; the rung is what reads. */
function rungLabel(layer: string): string {
  if (layer.endsWith("exact")) return "exact alias"
  if (layer.endsWith("vector")) return "embedding"
  if (layer.endsWith("llm")) return "the model"
  return layer
}

export interface AuditHeadline {
  verdict: string
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

function headlineOf(d: IngredientAuditData): AuditHeadline {
  const applied = d.decisionCounts.APPLIED ?? 0
  const shadow = d.decisionCounts.SHADOW ?? 0
  const suggested = d.decisionCounts.SUGGESTED ?? 0
  const matchedLines = d.sources
    .filter((s) => s.source !== "(unmatched)")
    .reduce((s, r) => s + r.lines, 0)
  const totalLines = d.sources.reduce((s, r) => s + r.lines, 0)
  const unmatchedSpend = d.unmatched.reduce((s, u) => s + u.spend, 0)
  const realUnmatched = d.unmatched.filter((u) => !u.charge).length
  const chargeSpend = d.chargeCanonicals.reduce((s, c) => s + c.spend, 0)
  // The most-split canonical is not the most useful example — the potato roll
  // is split 21 ways across $41,038, and the money is what makes the point.
  const worst =
    [...d.canonicals].filter((c) => c.spellings >= 10).sort((a, b) => b.spend - a.spend)[0] ??
    d.canonicals[0]

  const verdict =
    (applied === 0
      ? `No match has ever been applied automatically: ${count(shadow)} decisions were ` +
        `recorded in shadow and ${count(suggested)} groups were declined, so there is no ` +
        `held rate and no revert rate to report. `
      : `${count(applied)} matches were applied automatically and ${count(d.undoneCount)} ` +
        `were undone by hand. `) +
    `What matching does do is hold spellings together — ` +
    (worst
      ? `${count(worst.spellings)} of them for ${worst.name} across ${money(worst.spend)} of ` +
        `purchases, which a GROUP BY on the printed name would report as ` +
        `${count(worst.spellings)} products. `
      : "") +
    (chargeSpend > 0
      ? `It also matched ${money(chargeSpend)} of freight to a canonical called ` +
        `"${d.chargeCanonicals.find((c) => c.spend > 0)?.name}", which is not an ingredient.`
      : "")

  /*
   * DELTA, NOT CAPTION. `Figure` mirrors the prototype's `c[4] || r`: a
   * caption opens a `.band` and a delta fills the `.d` beside the value.
   * `P.moningredients`'s own cells are `['Matched', '1,284', 'of 1,412 SKUs',
   * '']` — four elements, so the qualifying phrase is the DELTA and there is
   * no band at all.
   *
   * Three of these four carried the phrase as a `caption` and a `deltaTone`
   * with no `delta` to tone, which renders four `.band`s the design does not
   * have and drops the tone on the floor. Same words, correct slot; the
   * fidelity gate never forgives an extra, and these were four of them.
   */
  const cells: FigureProps[] = [
    {
      label: "Applied automatically",
      value: count(applied),
      delta: applied === 0 ? `${count(shadow)} recorded in shadow, none applied` : "matches",
      deltaTone: "is-flat",
    },
    {
      label: "Lines matched",
      value: `${count(matchedLines)} of ${count(totalLines)}`,
      // The one cell with two facts to state. The share is the reading; the
      // dollars are what it costs, and they go together in the delta rather
      // than opening a band for the second half.
      delta: `${pct(totalLines === 0 ? null : matchedLines / totalLines)} · ${money(unmatchedSpend)} unmatched`,
    },
    {
      label: "Still unmatched",
      value: count(realUnmatched),
      delta: `${count(d.unmatched.length - realUnmatched)} more are charge rows, correctly declined`,
      deltaTone: "is-down",
    },
    {
      label: "Freight matched as food",
      value: money(chargeSpend),
      delta: `${count(d.chargeCanonicals.length)} canonicals that are not ingredients`,
      deltaTone: "is-down",
    },
  ]

  return { verdict, cells, phoneCells: cells.slice(0, 2) }
}

export interface AuditCharges {
  rows: Row[]
  meta: string
  note: string
}

function chargesOf(d: IngredientAuditData): AuditCharges {
  return {
    rows: d.chargeCanonicals.map((c) => ({
      key: c.name,
      cells: {
        canonical: { v: c.name, cls: "hot" },
        recipes: c.recipes === 0 ? "none" : count(c.recipes),
        lines: count(c.lines),
        spellings: count(c.spellings),
        spend: money(c.spend),
      },
    })),
    meta: `${count(d.chargeCanonicals.length)} of ${count(d.canonicalTotal)} canonicals`,
    note:
      `These are freight and tax rows that the matcher promoted into the ingredient ` +
      `catalogue. Neither is in a recipe, so no plate cost is wrong because of them — but ` +
      `every figure that reads spend by ingredient counts them, and one of them was created ` +
      `by the model rung at 0.84 confidence off a line printed "Miscellaneous Charge". The ` +
      `four names are already declared non-goods in src/lib/invoice-charges.ts for the ` +
      `invoice reconciliation check; the matcher does not consult it.`,
  }
}

export interface AuditDecisions {
  rows: Row[]
  meta: string
  note: string
}

function decisionsOf(d: IngredientAuditData): AuditDecisions {
  const byRung = new Map<string, number>()
  for (const x of d.decisions) byRung.set(rungLabel(x.layer), (byRung.get(rungLabel(x.layer)) ?? 0) + 1)

  return {
    rows: d.decisions.map((x, i) => ({
      key: `${x.at.toISOString()}-${i}`,
      cells: {
        when: x.at.toISOString().slice(0, 10),
        printed: x.productName.slice(0, 40),
        matched: x.canonical,
        confidence: x.confidence.toFixed(2),
        rung: rungLabel(x.layer),
        outcome:
          x.status === "SUGGESTED"
            ? { v: "declined", cls: "hot" }
            : x.undone
              ? { v: "undone", cls: "hot" }
              : x.status === "APPLIED"
                ? "applied"
                : { v: "shadow", cls: "hot" },
      },
    })),
    meta: `newest ${count(d.decisions.length)} of ${count(
      Object.values(d.decisionCounts).reduce((s, n) => s + n, 0),
    )}`,
    note:
      `The rung is the ladder step that made the call — exact alias, then embedding, then ` +
      `the model. "Shadow" means the decision was recorded and not applied, which is every ` +
      `decision this account has: the outcome column has no "held" in it because nothing was ` +
      `ever put into the data to hold. "Declined" is the ladder refusing a group and keeping ` +
      `its best guess for the review inbox, which is what it does with Pallet Charge.`,
  }
}

export interface AuditUnmatched {
  rows: Row[]
  meta: string
  note: string
}

function unmatchedOf(d: IngredientAuditData): AuditUnmatched {
  const skus = new Set(d.unmatched.filter((u) => !u.charge && u.sku).map((u) => u.sku))
  const charges = d.unmatched.filter((u) => u.charge).length

  return {
    rows: d.unmatched.slice(0, TABLE_ROWS + 4).map((u, i) => ({
      key: `${u.sku ?? "none"}-${i}`,
      cells: {
        vendor: u.vendor,
        sku: u.sku ?? "—",
        printed: u.productName.slice(0, 42),
        spend: money(u.spend),
        why: u.charge ? "a charge row, correctly declined" : { v: "no match", cls: "hot" },
      },
    })),
    meta: `${count(d.unmatched.length)} lines · ${count(skus.size)} distinct SKUs`,
    note:
      `${count(charges)} of these are charge rows the ladder was right to refuse, so the real ` +
      `queue is ${count(d.unmatched.length - charges)} lines across ${count(skus.size)} SKUs. ` +
      `Most of them are one can liner: the same SKU, spelled a different way on every ` +
      `delivery, which is exactly the case a SKU match is supposed to solve and does not, ` +
      `because no canonical was ever confirmed for it.`,
  }
}

export interface AuditCanonicals {
  rows: Row[]
  meta: string
  note: string
}

function canonicalsOf(d: IngredientAuditData): AuditCanonicals {
  return {
    rows: d.canonicals.map((c) => ({
      key: c.name,
      cells: {
        canonical: c.name,
        spellings: count(c.spellings),
        skus: count(c.skus),
        recipes: c.recipes === 0 ? { v: "none", cls: "hot" } : count(c.recipes),
        spend: money(c.spend),
      },
    })),
    meta: `${count(TABLE_ROWS)} most-split of ${count(d.canonicalTotal)}`,
    note:
      `Spellings is how many distinct product names one canonical is holding together. This ` +
      `is the work: a GROUP BY on what the invoice printed would report the potato roll as ` +
      `twenty-one separate products and split its purchases across all of them. ` +
      `${count(d.noRecipe)} of the ${count(d.canonicalTotal)} canonicals are in no recipe at ` +
      `all, which is the orphan figure the Ingredients page reports.`,
  }
}

export interface AuditSections {
  headline: SectionData<AuditHeadline>
  charges: SectionData<AuditCharges>
  decisions: SectionData<AuditDecisions>
  unmatched: SectionData<AuditUnmatched>
  canonicals: SectionData<AuditCanonicals>
}

export function getAuditSectionPromises(): StreamedSections<AuditSections> {
  const dataP = classify(() => loadAudit(), {
    retryAction: "retryIngredientAudit",
    isEmpty: (d) => d.canonicalTotal === 0,
    emptyReason: "no_match",
  })
  const s = <T,>(f: (d: IngredientAuditData) => T) =>
    guardSection(dataP.then((sd) => mapReady(sd, f)), "retryIngredientAudit")
  return {
    headline: s(headlineOf),
    charges: s(chargesOf),
    decisions: s(decisionsOf),
    unmatched: s(unmatchedOf),
    canonicals: s(canonicalsOf),
  }
}

export async function getAuditSections(): Promise<AuditSections> {
  return awaitSections(getAuditSectionPromises())
}
