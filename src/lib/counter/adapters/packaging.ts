import { getPackagingCostData } from "@/lib/packaging-costs"
import { count, money, pct, plural, titleCase, unitCost } from "@/lib/counter/format"
import { rangeLabel, toQueryBounds, type DateRange } from "@/lib/counter/date-range"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import type { FigureProps, MListRow, QueueItem, Row } from "@/components/counter"
import type { PackagingCostData } from "@/types/packaging"

/**
 * Packaging — `P.packaging` (`docs/counter/counter-prototype.html`).
 *
 * "The cost that rides along with every third-party order."
 *
 * ## Nothing here is computed twice
 *
 * `getPackagingCostData` already models this: it packs each order's basket
 * into containers, prices them from invoice lines, and reports both the
 * inferred usage and the purchased units beside it. This adapter shapes that
 * output and adds no arithmetic of its own — the packing model is the thing
 * that would be wrong to reimplement, and its `validation` rows are the whole
 * point of the page.
 *
 * ## What the validation rows say
 *
 * Over 90 days, on this account:
 *
 *   container       inferred   purchased   utilisation
 *   medium 6x6        21,716       3,000       723.9%
 *   9x6               16,641      16,800        99.1%
 *   1-compartment      2,712      10,600        25.6%
 *
 * **The model claims 21,716 medium 6x6 containers were used and 3,000 were
 * bought.** That is not a variance, it is impossible: you cannot pack seven
 * times more containers than exist. And 1-compartment runs the other way —
 * 10,600 bought against 2,712 used.
 *
 * Two errors that offset are one error. The likeliest reading is that the
 * packer assigns baskets to `medium 6x6` that actually leave in
 * `1-compartment` trays, and the 9x6 row at 99.1% is what a container the
 * model gets right looks like. The page states that as a reading rather than a
 * conclusion, because the alternative — that the purchase record is missing
 * eighteen thousand containers — is also consistent with these numbers and
 * only a stockroom can tell them apart.
 */

/** Utilisation outside this band is the model and the invoices disagreeing. */
const UTILISATION_BAND = 15
/** Rows on the phone's list. */
const PHONE_ROWS = 4

export interface PackagingHeadline {
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

export interface PackagingLedger {
  rows: Row[]
  phoneRows: MListRow[]
  meta: string
  note: string
}

export interface PackagingWork {
  items: QueueItem[]
  meta: string
}

export interface PackagingSections {
  headline: SectionData<PackagingHeadline>
  ledger: SectionData<PackagingLedger>
  work: SectionData<PackagingWork>
}

export interface PackagingInput {
  storeId: string | null
  accountId: string
  range: DateRange
}

/* -- loading ---------------------------------------------------------- */

interface Data {
  d: PackagingCostData
  rangeLabel: string
}

/**
 * `getPackagingCostData` returns null when it cannot build the model at all —
 * no orders in the window, or no store to scope to. That is an EMPTY section
 * rather than a failed one, so the loader returns null and `classify` maps it
 * through `isEmpty`; a thrown error here would put a retry button under a
 * question that has an answer.
 */

async function loadPackaging(input: PackagingInput): Promise<Data | null> {
  const { accountId, storeId, range } = input
  const { startDate, endDate } = toQueryBounds(range)
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  const d = await getPackagingCostData({
    accountId,
    ...(storeId ? { storeId } : {}),
    startDate: iso(startDate),
    endDate: iso(endDate),
  })

  return d === null ? null : { d, rangeLabel: rangeLabel(range, "custom") }
}

/* -- helpers ---------------------------------------------------------- */

/** How far off 100% a utilisation is, or null when there is none. */
const offBy = (u: number | null): number | null => (u === null ? null : Math.abs(u - 100))

const disagrees = (u: number | null): boolean => {
  const off = offBy(u)
  return off !== null && off > UTILISATION_BAND
}

/* -- sections --------------------------------------------------------- */

/**
 * The strip. `Containers · 14 · 11 costed` becomes three, all costed — the
 * model groups this account's baskets into three container types and prices
 * every one of them, so the prototype's "costed" split has nothing to report.
 * The fourth cell goes to the thing that does: how many of those three the
 * invoices agree with.
 */
function headlineOf({ d, rangeLabel: label }: Data): PackagingHeadline {
  const t = d.totals
  const off = d.validation.filter((v) => disagrees(v.utilizationPct)).length

  const perOrderCell: FigureProps = {
    label: "Per order",
    value: t.costPerEligibleOrder === null ? "—" : unitCost(t.costPerEligibleOrder),
    delta: `${count(t.eligibleOrders)} orders carried packaging`,
    deltaTone: "is-flat",
  }
  const agreeCell: FigureProps = {
    label: "Invoices agree",
    value: `${count(d.validation.length - off)} of ${count(d.validation.length)}`,
    delta:
      off === 0
        ? "usage matches what was bought"
        : `${count(off)} ${off === 1 ? "container is" : "containers are"} out by more than ${count(UTILISATION_BAND)}%`,
    deltaTone: off > 0 ? "is-down" : "is-flat",
  }

  return {
    cells: [
      {
        label: "Packaging spend",
        value: money(t.packagingCogs),
        delta: label,
        deltaTone: "is-flat",
      },
      perOrderCell,
      {
        label: "Share of COGS",
        value: pct(t.packagingShareOfCogs, { scaled: true }),
        delta: `of ${money(t.totalCogs)}`,
        deltaTone: "is-flat",
      },
      agreeCell,
    ],
    phoneCells: [perOrderCell, agreeCell],
  }
}

/**
 * The container ledger, with utilisation as the column that matters.
 *
 * `Method · Purchased / Inferred` is the prototype's fifth column. Every row
 * here is BOTH: the model infers the units used and the invoices record the
 * units bought, and the interesting number is the ratio between them. So the
 * column is that ratio, and a row outside a 15-point band around 100% is
 * marked — which on this account is two of the three.
 */
function ledgerOf({ d }: Data): PackagingLedger {
  const byGroup = new Map(d.validation.map((v) => [v.group, v]))

  const rows = d.containers.map((c) => {
    const v = byGroup.get(c.group)
    return {
      key: c.group,
      cells: {
        container: titleCase(c.label),
        used: count(c.units),
        bought: v === undefined ? "—" : count(v.purchasedUnits),
        unit: c.unitCost === null ? { v: "no cost", cls: "hot" } : unitCost(c.unitCost),
        spend: money(c.lineCost),
        utilisation:
          v?.utilizationPct == null
            ? "—"
            : disagrees(v.utilizationPct)
              ? { v: pct(v.utilizationPct, { scaled: true }), cls: "hot" }
              : pct(v.utilizationPct, { scaled: true }),
      },
    }
  })

  const worst = [...d.validation]
    .filter((v) => v.utilizationPct !== null)
    .sort((a, b) => (offBy(b.utilizationPct) ?? 0) - (offBy(a.utilizationPct) ?? 0))[0]

  return {
    rows,
    phoneRows: d.containers.slice(0, PHONE_ROWS).map((c) => {
      const v = byGroup.get(c.group)
      return {
        key: c.group,
        title: titleCase(c.label),
        detail: `${count(c.units)} used · ${v ? `${count(v.purchasedUnits)} bought` : "none bought"}`,
        value: money(c.lineCost),
        note: v?.utilizationPct == null ? "—" : pct(v.utilizationPct, { scaled: true }),
        noteTone: v && disagrees(v.utilizationPct) ? "down" : "up",
      }
    }),
    meta: `${count(d.containers.length)} containers · ${count(d.totals.packagingUnits)} units`,
    note:
      `Used is what the packing model says each order needed; bought is what the invoices ` +
      `record. Utilisation is the first over the second, so 100% means the two agree. ` +
      (worst && disagrees(worst.utilizationPct)
        ? `${titleCase(worst.label)} reads ${pct(worst.utilizationPct ?? 0, { scaled: true })} — ` +
          `${count(worst.inferredUnits)} used against ${count(worst.purchasedUnits)} bought, which ` +
          `is not a variance but an impossibility, and it is the model or the purchase record ` +
          `rather than the kitchen.`
        : `Every container is inside the band.`) +
      // What "Which orders carry it" was for. `P.packaging` has no such table —
      // it draws a chart in that slot — and the table's whole payload is this
      // sentence: which orders are in the per-order denominator and which are
      // not. The per-mode order counts it also printed belong to Orders.
      ` A dine-in order leaves no container behind, so it is excluded from the ` +
      `per-order figure rather than diluting it — ${count(d.totals.excludedOrders)} of ` +
      `${count(d.totals.totalOrders)} orders in this range, worth ` +
      `${money(d.totals.avoidedDineInCost)} of packaging not bought, which is small here only ` +
      `because almost nothing is eaten in.`,
  }
}

/** Which orders carry packaging at all. */
function workOf({ d, rangeLabel: label }: Data): PackagingWork {
  const items: QueueItem[] = []

  const off = [...d.validation]
    .filter((v) => disagrees(v.utilizationPct))
    .sort((a, b) => (offBy(b.utilizationPct) ?? 0) - (offBy(a.utilizationPct) ?? 0))

  if (off.length > 0) {
    const over = off.filter((v) => (v.utilizationPct ?? 0) > 100)
    const under = off.filter((v) => (v.utilizationPct ?? 0) < 100)
    items.push({
      key: "utilisation",
      tone: "bad",
      lead: count(off.length),
      unit: off.length === 1 ? "container" : "containers",
      title: "The model and the invoices disagree",
      body:
        off
          .map(
            (v) =>
              `${titleCase(v.label)} ${pct(v.utilizationPct ?? 0, { scaled: true })} ` +
              `(${count(v.inferredUnits)} used, ${count(v.purchasedUnits)} bought)`,
          )
          .join("; ") +
        `. ` +
        (over.length > 0 && under.length > 0
          ? `One runs over and another under, which is what a packing model assigning baskets to ` +
            `the wrong container looks like — the units have to come from somewhere. The ` +
            `alternative is that the purchase record is missing them, and only a stockroom ` +
            `separates the two.`
          : `Either the packer is choosing the wrong container or the invoices are incomplete.`),
      act: "Open the invoices",
      href: "/dashboard/invoices",
    })
  }

  const biggest = [...d.containers].sort((a, b) => b.lineCost - a.lineCost)[0]
  if (biggest && d.totals.packagingCogs > 0) {
    items.push({
      key: "concentration",
      tone: "warn",
      lead: pct((biggest.lineCost / d.totals.packagingCogs) * 100, { scaled: true }),
      unit: "of it",
      title: `${titleCase(biggest.label)} is most of the packaging bill`,
      body:
        `${money(biggest.lineCost)} of ${money(d.totals.packagingCogs)} over ${label}, on ` +
        `${count(biggest.units)} units at ${biggest.unitCost === null ? "an unknown price" : unitCost(biggest.unitCost)} each. ` +
        `A cent off that unit is ${money(biggest.units * 0.01)} over the same range, which is the ` +
        `only lever on this page big enough to be worth a call.`,
      act: "Compare vendors",
      href: "/dashboard/operations/vendors",
    })
  }

  return { items, meta: `${plural(items.length, "thing")} to do` }
}

/* -- assembly --------------------------------------------------------- */

export function getPackagingSectionPromises(
  input: PackagingInput,
): StreamedSections<PackagingSections> {
  const dataP = classify(() => loadPackaging(input), {
    retryAction: "retryPackaging",
    isEmpty: (d) => d === null || d.d.containers.length === 0,
    emptyReason: "no_match",
  })

  const s = <T,>(f: (d: Data) => T) =>
    guardSection(
      dataP.then((sd) => mapReady(sd, (d) => f(d as Data))),
      "retryPackaging",
    )

  return {
    headline: s(headlineOf),
    ledger: s(ledgerOf),
    work: s(workOf),
  }
}

export async function getPackagingSections(input: PackagingInput): Promise<PackagingSections> {
  return awaitSections(getPackagingSectionPromises(input))
}
