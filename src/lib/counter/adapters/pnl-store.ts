import { prisma } from "@/lib/prisma"
import { count, money } from "@/lib/counter/format"
import { rangeLabel, type DateRange } from "@/lib/counter/date-range"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import { monthlyCostForDays } from "@/lib/pnl"
import type { PnlSectionsInput } from "@/lib/counter/adapters/pnl"
import type { MoneyLine, Row } from "@/components/counter"

/**
 * One store's P&L — `P.pnlstore` (`docs/counter/counter-prototype.html`).
 *
 * "The same statement for one store, with the fixed costs that store actually
 * carries and the two that carry none."
 *
 * Measured before it was written:
 * `docs/counter/measurements/2026-08-28-store-pnl.md`.
 *
 * ## This is NOT a route, and that was decided before this file existed
 *
 * `P.pnlstore` is a separate page in the prototype. It is not one here, and
 * undoing that would be a regression dressed up as a rebuild:
 * `src/app/dashboard/pnl/[storeId]/page.tsx` is a deliberate redirect shim
 * onto `/dashboard/pnl?store=<id>`, and its own comment argues the case — a
 * store is a PARAM on one P&L, `?store=` is what `writeCounterParams` writes,
 * and the rail's store switcher is what selects it.
 *
 * So the prototype's per-store CONTENT lands on the group page, shown only
 * when a store is selected. The strip, the cascade, the eight weeks and the
 * statement are already correct for one store — `getPnlSectionPromises` takes
 * a `storeId` and always has. What was missing is the part that is about a
 * STORE rather than a period, which is what this file adds: two sections, and
 * nothing else. One statement, one function, two selections of it.
 *
 * ## What this page is actually for
 *
 * Fixed cost. Hollywood carries **$14,028.33 a month** — rent $10,390,
 * cleaning $3,400, towels $238.33 — and a labour budget of **$0**. The other
 * two stores carry nothing and have no rent on file.
 *
 * `StoreFixedExpense`, the model built to hold custom fixed costs with a
 * label, a cadence and a GL code, holds **0 rows for every store**. It has
 * never been used, so the table below reads the four hard-coded `Store`
 * columns and says which they are.
 *
 * ## Only ONE section, not the prototype's two
 *
 * `P.pnlstore` also carries "The other two", naming the stores excluded from
 * the statement and why. The P&L page's `byStore` section already says that,
 * with the same reasoning and a link to fill the missing file in — so adding
 * it here would be the same fact told twice on one page, which is exactly what
 * the one-figure-one-function rule exists to stop. The fixed-cost table is the
 * part that has no other home.
 */

/** The four fixed-cost columns, in the order an owner reads them. */
const FIXED_FIELDS = [
  { key: "rent", label: "Rent", lands: "Occupancy" },
  { key: "labor", label: "Labour budget", lands: "Labor" },
  { key: "cleaning", label: "Cleaning", lands: "Other operating" },
  { key: "towels", label: "Towels", lands: "Other operating" },
] as const

export interface StoreFixed {
  rows: Row[]
  money: MoneyLine[]
  meta: string
  lead: string
  note: string
}

export interface StoreFixedSections {
  fixed: SectionData<StoreFixed>
}

export interface PnlStoreInput extends PnlSectionsInput {
  /** Required here — these sections are about one store. */
  storeId: string
}

/* -- loading ---------------------------------------------------------- */

interface StoreRow {
  id: string
  name: string
  stage: string | null
  rent: number | null
  labor: number | null
  cleaning: number | null
  towels: number | null
  customExpenses: number
}

interface Loaded {
  store: StoreRow
  days: number
  rangeLabel: string
}

async function loadStoreFixed(input: PnlStoreInput): Promise<Loaded | null> {
  const { storeId, accountId, range } = input

  const stores = await prisma.store.findMany({
    where: { accountId },
    select: {
      id: true,
      name: true,
      lifecycleStage: true,
      fixedMonthlyRent: true,
      fixedMonthlyLabor: true,
      fixedMonthlyCleaning: true,
      fixedMonthlyTowels: true,
      _count: { select: { fixedExpenses: true } },
    },
    orderBy: { name: "asc" },
  })

  const shape = (s: (typeof stores)[number]): StoreRow => ({
    id: s.id,
    name: s.name,
    stage: s.lifecycleStage ?? null,
    rent: s.fixedMonthlyRent,
    labor: s.fixedMonthlyLabor,
    cleaning: s.fixedMonthlyCleaning,
    towels: s.fixedMonthlyTowels,
    customExpenses: s._count.fixedExpenses,
  })

  const mine = stores.find((s) => s.id === storeId)
  if (!mine) return null

  const days =
    Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000) + 1

  return {
    store: shape(mine),
    days: Math.max(1, days),
    rangeLabel: rangeLabel(range, "custom"),
  }
}

/* -- helpers ---------------------------------------------------------- */

const valueOf = (s: StoreRow, key: (typeof FIXED_FIELDS)[number]["key"]): number | null =>
  key === "rent" ? s.rent : key === "labor" ? s.labor : key === "cleaning" ? s.cleaning : s.towels

/** First letter up. These notes start with a field name, which is lower case. */
const sentenceCase = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1)

const monthlyTotal = (s: StoreRow): number =>
  FIXED_FIELDS.reduce((t, f) => t + (valueOf(s, f.key) ?? 0), 0)

/* -- sections --------------------------------------------------------- */

/**
 * What this store carries, and the flag that cannot tell "on file" from
 * "trustworthy".
 *
 * `getAllStoresPnL` sets `fixedCostsConfigured` to
 * `fixedMonthlyLabor != null && fixedMonthlyRent != null`. Hollywood's labour
 * budget is **0**, not null — zero is not null, so the flag reads TRUE for a
 * store that pays real wages every week against a budget of nothing.
 *
 * The check tests PRESENCE; the name promises CONFIGURED. A $0 budget answers
 * the first and fails the second, and anything reading that flag to decide
 * whether a store's costs can be trusted is being told yes.
 *
 * This page does not quietly redefine the flag — it is shared, other surfaces
 * read it, and changing its meaning has a blast radius. It shows the four
 * inputs, marks the one that is zero, and lets a reader see the difference.
 */
function fixedOf(d: Loaded): StoreFixed {
  const s = d.store
  const monthly = monthlyTotal(s)
  // `monthlyCostForDays`, NOT a local constant. It divides by 365.25/12 and a
  // 365/12 of my own put this table's rent at $30,743 against the statement's
  // $30,722 — two figures for one thing, twenty-one dollars apart, on one
  // page. The statement is built from this helper; so is this.
  const inRange = (v: number | null) => monthlyCostForDays(v, d.days) ?? 0
  const zeroed = FIXED_FIELDS.filter((f) => valueOf(s, f.key) === 0)
  const missing = FIXED_FIELDS.filter((f) => valueOf(s, f.key) === null)

  return {
    rows: FIXED_FIELDS.map((f) => {
      const v = valueOf(s, f.key)
      return {
        key: f.key,
        cells: {
          line: f.label,
          monthly:
            v === null
              ? { v: "not on file", cls: "hot" }
              : v === 0
                ? { v: money(0), cls: "hot" }
                : money(v),
          range: v === null ? "—" : money(inRange(v)),
          lands: f.lands,
        },
      }
    }),
    money: [
      { label: `A month`, value: money(monthly) },
      {
        label: `Prorated to ${count(d.days)} ${d.days === 1 ? "day" : "days"}`,
        value: money(monthlyCostForDays(monthly, d.days) ?? 0),
        total: true,
      },
    ],
    meta: `${d.rangeLabel} · ${count(d.days)} ${d.days === 1 ? "day" : "days"}`,
    lead:
      `${s.name} carries ${money(monthly)} a month of fixed cost, prorated into this range on ` +
      `calendar days. These are four columns on the store's own row — ` +
      `${count(s.customExpenses)} custom fixed ${s.customExpenses === 1 ? "expense is" : "expenses are"} ` +
      `on file${s.customExpenses === 0 ? ", and the table built to hold them has never been used" : ""}.`,
    note:
      zeroed.length === 0 && missing.length === 0
        ? `Every fixed cost this store carries has a figure against it.`
        : (zeroed.length > 0
            ? `${sentenceCase(zeroed.map((f) => f.label.toLowerCase()).join(" and "))} ` +
              `${zeroed.length === 1 ? "is" : "are"} ZERO rather than absent, and the difference ` +
              `matters: the flag the rest of the product reads to decide whether a store's costs ` +
              `are on file tests for null, so a $0 budget passes it. This store pays wages every ` +
              `week. `
            : "") +
          (missing.length > 0
            ? `${zeroed.length > 0 ? missing.map((f) => f.label.toLowerCase()).join(", ") : sentenceCase(missing.map((f) => f.label.toLowerCase()).join(", "))} ` +
              `${missing.length === 1 ? "has" : "have"} no figure at all, so ` +
              `${missing.length === 1 ? "it contributes" : "they contribute"} nothing to the ` +
              `statement below rather than contributing an unknown.`
            : ""),
  }
}

/**
 * The store's name, for the masthead and the breadcrumb — and the 404.
 *
 * Same shape as the other detail routes: one indexed lookup rather than
 * awaiting the loader, which `no-awaited-loader` forbids outside the two order
 * routes it exempts by name.
 */
export async function getStoreName(
  storeId: string,
  accountId: string,
): Promise<{ name: string } | null> {
  const row = await prisma.store.findFirst({
    where: { id: storeId, accountId },
    select: { name: true },
  })
  return row ? { name: row.name } : null
}

/* -- assembly --------------------------------------------------------- */

/**
 * The two store-only sections, to sit under the statement the group adapter
 * already produced for this store. Deliberately NOT a whole page's worth: the
 * statement is `getPnlSectionPromises`' job and is not duplicated here.
 */
export function getStoreFixedSectionPromises(
  input: PnlStoreInput,
): StreamedSections<StoreFixedSections> {
  const dataP = classify(() => loadStoreFixed(input), {
    retryAction: "retryStoreFixed",
    isEmpty: (d) => d === null,
    emptyReason: "no_match",
  })

  const s = <T,>(f: (d: Loaded) => T) =>
    guardSection(
      dataP.then((sd) => mapReady(sd, (d) => f(d as Loaded))),
      "retryStoreFixed",
    )

  return { fixed: s(fixedOf) }
}

export async function getStoreFixedSections(
  input: PnlStoreInput,
): Promise<StoreFixedSections> {
  return awaitSections(getStoreFixedSectionPromises(input))
}
