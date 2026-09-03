import { prisma } from "@/lib/prisma"
import { monthlyCostForDays } from "@/lib/pnl"
import { count, money, pct, plural, pluralWord, titleCase } from "@/lib/counter/format"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import { dayCount, type DateRange } from "@/lib/counter/date-range"
import { PRIME_CEILING_PCT } from "@/lib/counter/prime-cost"
import type {
  Column,
  FigureProps,
  KvRow,
  MathRow,
  MListRow,
  QueueItem,
  Row,
} from "@/components/counter"

/**
 * Stores — `P.stores` and `P.storecosts`
 * (`docs/counter/counter-prototype.html`).
 *
 * "Each store carries its own operating inputs, commission rates and COGS
 * target."
 *
 * ## Only ONE of these two pages is dateless, and reading it as both cost the
 * store file three panels
 *
 * `P.stores` declares `nodate: true`. `P.storecosts` does NOT — verified in
 * the prototype, not inferred: the store list is a set of standing inputs, but
 * the store FILE prorates every one of them to the selected range and says so
 * in its own body copy ("Change the range above and this recalculates. A
 * month-long lease charge never lands in one day.").
 *
 * This docblock used to generalise `nodate` across both, and the page repeated
 * it ("Standing inputs, so no date control"). Three of the file's missing
 * landmarks followed directly from that one sentence — the "Charged to this
 * range" strip cell, the whole "How it reaches the P&L" block, and the "In
 * this range" column of the fixed-expense table are all range-dependent, and
 * none of them could exist on a page that never read a range.
 *
 * ## The inputs, measured
 *
 *                     Hollywood      Glendale      Van Nuys
 *   stage             ready          pre_open      pre_open
 *   rent              $10,390        —             —
 *   labour budget     **$0**         —             —
 *   cleaning          $3,400         —             —
 *   towels            $238.33        —             —
 *   COGS target       30%            —             —
 *   Uber / DoorDash   21% / 25%      21% / 25%     21% / 25%
 *
 * Two findings the prototype does not have a cell for.
 *
 * **Every store carries the same commission rates**, and they are the
 * defaults. `P.stores` says "Van Nuys has no commission rates"; here all three
 * have identical ones, which is either three signed contracts that happen to
 * match or — far likelier — nobody has entered a real rate on any of them.
 * Commissions are 22.8% of gross on the P&L, so a default standing in for a
 * signed rate is the largest silent assumption in the product.
 *
 * **Hollywood's labour budget is $0, not absent**, and
 * `2026-08-28-store-pnl.md` §2 has the consequence: `fixedCostsConfigured`
 * tests for null, so zero passes it and the store reads as configured.
 */

/** A rate this close to the platform default is almost certainly the default. */
const DEFAULT_UBER = 0.21
const DEFAULT_DOORDASH = 0.25

export interface StoresHeadline {
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

export interface StoresTable {
  rows: Row[]
  phoneRows: MListRow[]
  /**
   * The store the phone's single button opens — `P.stores.phone()` ends with
   * "Open Hollywood file", a bare `.mbtn` outside every section.
   *
   * The TRADING store, because that is the file whose numbers are live today;
   * the first store otherwise, so a fresh account with nothing open still has
   * a way into a store file. Null only when there are no stores at all.
   */
  primary: { href: string; label: string } | null
  meta: string
  note: string
}

export interface StoresWork {
  items: QueueItem[]
  meta: string
}

export interface StoresSections {
  headline: SectionData<StoresHeadline>
  table: SectionData<StoresTable>
  work: SectionData<StoresWork>
}

export interface StoresInput {
  accountId: string
}

/* -- loading ---------------------------------------------------------- */

interface StoreRow {
  id: string
  name: string
  address: string | null
  stage: string | null
  active: boolean
  rent: number | null
  labor: number | null
  cleaning: number | null
  towels: number | null
  cogsTarget: number | null
  uber: number | null
  doordash: number | null
  geocoded: boolean
  openedAt: Date | null
}

interface Data {
  stores: StoreRow[]
}

/** What a `StoreFixedExpense` is once the cadence is resolved to a month. */
export interface StoreExpenseLine {
  id: string
  label: string
  /** As the owner entered it, in `frequency`. */
  amount: number
  frequency: "WEEKLY" | "MONTHLY" | "YEARLY"
  monthly: number
}

/** The store LIST's row plus the three things only the file reads. */
interface StoreFileRow extends StoreRow {
  phone: string | null
  longitude: number | null
  expenses: StoreExpenseLine[]
}

/**
 * A cadence resolved to a month, in one place.
 *
 * `Store.fixedMonthlyTowels` already stores a WEEKLY entry as its monthly
 * equivalent — its own schema comment says so — so the four columns need no
 * conversion and `StoreFixedExpense.amount` does. Two conversions with one
 * rule between them is exactly how a page comes to print two different
 * monthlies for one expense.
 */
/*
 * `YEARLY`, NOT `ANNUAL`, AND THE DIFFERENCE WAS A 12x ERROR WAITING TO HAPPEN.
 *
 * `ExpenseFrequency` in the schema is `WEEKLY | MONTHLY | YEARLY`. This table
 * was keyed `WEEKLY | MONTHLY | ANNUAL`, so `ANNUAL` was a key nothing could
 * ever produce and `YEARLY` was a value with no entry. The guard below reads
 * `e.frequency in MONTHLY_FROM ? e.frequency : "MONTHLY"`, so a yearly expense
 * fell through to the MONTHLY factor of 1: its full annual amount would have
 * been charged to the P&L every month, twelve times over, with the cadence
 * column calmly printing "Monthly" beside it.
 *
 * It never fired because `StoreFixedExpense` has zero rows — nothing in the
 * product could write one, which is the gap the "Add a line" control in this
 * same commit closes. Shipping that control against this table is what would
 * have made a latent typo into a live money bug, on the first yearly expense
 * anyone entered.
 */
const MONTHLY_FROM: Record<StoreExpenseLine["frequency"], number> = {
  WEEKLY: 52 / 12,
  MONTHLY: 1,
  YEARLY: 1 / 12,
}

const CADENCE_LABEL: Record<StoreExpenseLine["frequency"], string> = {
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  YEARLY: "Yearly",
}

const SELECT = {
  id: true,
  name: true,
  address: true,
  lifecycleStage: true,
  isActive: true,
  fixedMonthlyRent: true,
  fixedMonthlyLabor: true,
  fixedMonthlyCleaning: true,
  fixedMonthlyTowels: true,
  targetCogsPct: true,
  uberCommissionRate: true,
  doordashCommissionRate: true,
  latitude: true,
  openedAt: true,
} as const

/**
 * The store file needs the expense LINES as well as the four columns on
 * `Store`, so it selects on top of `SELECT` rather than widening it — the
 * stores LIST renders no expense rows and must not pay for them.
 */
const FILE_SELECT = {
  ...SELECT,
  phone: true,
  longitude: true,
  fixedExpenses: {
    where: { isActive: true },
    // Ordered in `shapeFile`, not here. A Prisma `orderBy` tuple has to be a
    // MUTABLE array of `"asc" | "desc"`, and this object is spread from an
    // `as const` — so the literal is either readonly (rejected) or widened to
    // `string` (also rejected). Sorting a handful of rows in JS is cheaper
    // than the type dance and reads the same.
    select: { id: true, label: true, amount: true, frequency: true, isActive: true },
  },
} as const

const shape = (s: {
  id: string
  name: string
  address: string | null
  lifecycleStage: string | null
  isActive: boolean
  fixedMonthlyRent: number | null
  fixedMonthlyLabor: number | null
  fixedMonthlyCleaning: number | null
  fixedMonthlyTowels: number | null
  targetCogsPct: number | null
  uberCommissionRate: number | null
  doordashCommissionRate: number | null
  latitude: number | null
  openedAt: Date | null
}): StoreRow => ({
  id: s.id,
  name: s.name,
  address: s.address,
  stage: s.lifecycleStage,
  active: s.isActive,
  rent: s.fixedMonthlyRent,
  labor: s.fixedMonthlyLabor,
  cleaning: s.fixedMonthlyCleaning,
  towels: s.fixedMonthlyTowels,
  cogsTarget: s.targetCogsPct,
  uber: s.uberCommissionRate,
  doordash: s.doordashCommissionRate,
  geocoded: s.latitude !== null,
  openedAt: s.openedAt,
})

/** `shape`, plus what only the file reads. */
const shapeFile = (
  s: Parameters<typeof shape>[0] & {
    phone: string | null
    longitude: number | null
    fixedExpenses: Array<{
      id: string
      label: string
      amount: number
      frequency: string
      isActive: boolean
    }>
  },
): StoreFileRow => ({
  ...shape(s),
  phone: s.phone,
  longitude: s.longitude,
  expenses: [...s.fixedExpenses]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((e) => {
    const frequency = (
      e.frequency in MONTHLY_FROM ? e.frequency : "MONTHLY"
    ) as StoreExpenseLine["frequency"]
    return {
      id: e.id,
      label: e.label,
      amount: e.amount,
      frequency,
      monthly: e.amount * MONTHLY_FROM[frequency],
      }
    }),
})

async function loadStores(input: StoresInput): Promise<Data> {
  const stores = await prisma.store.findMany({
    where: { accountId: input.accountId },
    select: SELECT,
    orderBy: { name: "asc" },
  })
  return { stores: stores.map(shape) }
}

/* -- helpers ---------------------------------------------------------- */

const fixedMonthly = (s: StoreRow): number =>
  (s.rent ?? 0) + (s.labor ?? 0) + (s.cleaning ?? 0) + (s.towels ?? 0)

const isTrading = (s: StoreRow): boolean => s.stage === "ready"

const stageLabel = (s: StoreRow): string =>
  s.stage === null ? "stage not set" : titleCase(s.stage.replace(/_/g, " "))

/** True when both rates equal the platform defaults — see the module note. */
const defaultRates = (s: StoreRow): boolean =>
  s.uber === DEFAULT_UBER && s.doordash === DEFAULT_DOORDASH

/** The inputs a store needs before its P&L means anything. */
const missingInputs = (s: StoreRow): string[] => {
  const gaps: string[] = []
  if (s.rent === null) gaps.push("rent")
  if (s.cogsTarget === null) gaps.push("COGS target")
  if (s.labor === 0) gaps.push("a labor budget above zero")
  return gaps
}

/* -- sections --------------------------------------------------------- */

/**
 * The strip. `Blended prime · 56.2%` is dropped — it is the P&L's figure and
 * this page would be the second place it is computed, which is exactly what
 * the shared-figure rule forbids. The cell goes to commission rates instead,
 * which nothing else on the product reports and which decides 22.8% of gross.
 */
function headlineOf(d: Data): StoresHeadline {
  const trading = d.stores.filter(isTrading)
  const monthly = d.stores.reduce((t, s) => t + fixedMonthly(s), 0)
  const noRent = d.stores.filter((s) => s.rent === null)
  const onDefaults = d.stores.filter(defaultRates)

  const fixedCell: FigureProps = {
    label: "Fixed cost, monthly",
    value: money(monthly),
    delta:
      noRent.length === 0
        ? "every store has rent on file"
        : `${noRent.map((s) => shortName(s.name)).join(" and ")} ${noRent.length === 1 ? "has" : "have"} no rent on file`,
    deltaTone: noRent.length > 0 ? "is-down" : "is-flat",
  }
  const ratesCell: FigureProps = {
    label: "Commission rates",
    value: `${count(d.stores.length - onDefaults.length)} of ${count(d.stores.length)}`,
    delta:
      onDefaults.length === 0
        ? "all entered by hand"
        : `${count(onDefaults.length)} still on the platform defaults`,
    deltaTone: onDefaults.length > 0 ? "is-down" : "is-flat",
  }

  return {
    cells: [
      {
        label: "Locations",
        value: count(d.stores.length),
        delta: `${count(trading.length)} trading, ${count(d.stores.length - trading.length)} opening`,
        deltaTone: "is-flat",
      },
      fixedCell,
      ratesCell,
      {
        label: "Missing inputs",
        value: count(d.stores.reduce((t, s) => t + missingInputs(s).length, 0)),
        delta: `across ${plural(d.stores.filter((s) => missingInputs(s).length > 0).length, "store")}`,
        deltaTone: "is-down",
      },
    ],
    phoneCells: [fixedCell, ratesCell],
  }
}

/** First word after the dash, or the whole name — "Chris N Eddys - Glendale". */
function shortName(name: string): string {
  const tail = name.split(/\s+-\s+/).pop()
  return tail && tail !== name ? tail : name
}

function tableOf(d: Data): StoresTable {
  const onDefaults = d.stores.filter(defaultRates).length

  return {
    rows: d.stores.map((s) => ({
      key: s.id,
      href: `/dashboard/stores/${s.id}`,
      cells: {
        store: shortName(s.name),
        status: isTrading(s) ? stageLabel(s) : { v: stageLabel(s), cls: "hot" },
        rent: s.rent === null ? { v: "not set", cls: "hot" } : money(s.rent),
        fixed: fixedMonthly(s) === 0 ? { v: "nothing", cls: "hot" } : money(fixedMonthly(s)),
        target:
          s.cogsTarget === null
            ? { v: "not set", cls: "hot" }
            : pct(s.cogsTarget, { scaled: true }),
        commissions:
          s.uber === null && s.doordash === null
            ? { v: "not set", cls: "hot" }
            : `UE ${pct((s.uber ?? 0) * 100, { scaled: true })} · DD ${pct((s.doordash ?? 0) * 100, { scaled: true })}` +
              (defaultRates(s) ? " (default)" : ""),
      },
    })),
    phoneRows: d.stores.map((s) => ({
      key: s.id,
      href: `/dashboard/stores/${s.id}`,
      title: shortName(s.name),
      detail: `${stageLabel(s)} · ${s.rent === null ? "no rent on file" : `rent ${money(s.rent)}`}`,
      value: fixedMonthly(s) === 0 ? "—" : money(fixedMonthly(s)),
      note: missingInputs(s).length === 0 ? "complete" : `${count(missingInputs(s).length)} missing`,
      noteTone: missingInputs(s).length === 0 ? "up" : "down",
    })),
    primary: (() => {
      const store = d.stores.find(isTrading) ?? d.stores[0]
      return store
        ? { href: `/dashboard/stores/${store.id}`, label: `Open ${shortName(store.name)} file` }
        : null
    })(),
    meta: `${count(d.stores.length)} · standing inputs, not a period`,
    note:
      onDefaults > 0
        ? `${count(onDefaults)} of ${plural(d.stores.length, "store")} ` +
          `${pluralWord(onDefaults, "carries", "carry")} Uber at ` +
          `${pct(DEFAULT_UBER * 100, { scaled: true })} and DoorDash at ` +
          `${pct(DEFAULT_DOORDASH * 100, { scaled: true })} — the platform defaults, to the ` +
          // "three" was the one literal left in a sentence whose every other
          // number is derived — it is the count of stores ON THE DEFAULTS, and
          // on a two-store account it read "2 of 2 stores carry Uber at 21.0%
          // … Either three contracts happen to match".
          `digit. Either ${plural(onDefaults, "contract")} ` +
          `${pluralWord(onDefaults, "happens", "happen")} to match or nobody has entered a ` +
          `signed rate. ` +
          `Commissions are the second largest line on the P&L, so this is the biggest standing ` +
          `assumption in the product and it is invisible everywhere else.`
        : `Every store's commission rates were entered by hand.`,
  }
}

function workOf(d: Data): StoresWork {
  const items: QueueItem[] = []
  const noRent = d.stores.filter((s) => s.rent === null)
  const onDefaults = d.stores.filter(defaultRates)
  const zeroLabour = d.stores.filter((s) => s.labor === 0)

  if (noRent.length > 0) {
    items.push({
      key: "rent",
      tone: "bad",
      lead: count(noRent.length),
      unit: noRent.length === 1 ? "store" : "stores",
      title: `${noRent.length === 1 ? "A store has" : "Stores have"} no rent on file`,
      body:
        `${noRent.map((s) => shortName(s.name)).join(" and ")} ` +
        `${noRent.length === 1 ? "carries" : "carry"} no rent, so ` +
        `${noRent.length === 1 ? "it is" : "they are"} held out of the group P&L entirely rather ` +
        `than folded in at zero — folding them in would report a prime cost that is low and a ` +
        `margin that is high, which is the opposite of the truth.`,
      act: "Open the store file",
      href: `/dashboard/stores/${noRent[0].id}`,
    })
  }

  if (onDefaults.length > 0) {
    items.push({
      key: "rates",
      tone: "warn",
      lead: count(onDefaults.length),
      unit: onDefaults.length === 1 ? "store" : "stores",
      title: "Commission rates are the platform defaults",
      body:
        `Uber at ${pct(DEFAULT_UBER * 100, { scaled: true })} and DoorDash at ` +
        `${pct(DEFAULT_DOORDASH * 100, { scaled: true })} on ` +
        `${onDefaults.length === d.stores.length ? "every store" : `${count(onDefaults.length)} of them`}, ` +
        `to the digit. If a signed rate differs by a point, every third-party margin in the ` +
        `product is wrong by that point — and nothing else surfaces which rate is in use.`,
      act: "Open a store file",
      href: `/dashboard/stores/${onDefaults[0].id}`,
    })
  }

  if (zeroLabour.length > 0) {
    items.push({
      key: "labor",
      tone: "warn",
      lead: count(zeroLabour.length),
      unit: zeroLabour.length === 1 ? "store" : "stores",
      title: "A labor budget of zero reads as configured",
      body:
        `${zeroLabour.map((s) => shortName(s.name)).join(" and ")} ` +
        `${zeroLabour.length === 1 ? "carries" : "carry"} a labor budget of exactly $0 while ` +
        `paying wages every week. The flag the rest of the product reads to decide whether a ` +
        `store's costs are on file tests for null, and zero is not null, so it passes.`,
      act: "Open the store file",
      href: `/dashboard/stores/${zeroLabour[0].id}`,
    })
  }

  return { items, meta: `${plural(items.length, "thing")} to do` }
}

/* -- assembly --------------------------------------------------------- */

export function getStoresSectionPromises(
  input: StoresInput,
): StreamedSections<StoresSections> {
  const dataP = classify(() => loadStores(input), {
    retryAction: "retryStores",
    isEmpty: (d) => d.stores.length === 0,
    emptyReason: "no_match",
  })

  const s = <T,>(f: (d: Data) => T) =>
    guardSection(dataP.then((sd) => mapReady(sd, f)), "retryStores")

  return { headline: s(headlineOf), table: s(tableOf), work: s(workOf) }
}

export async function getStoresSections(input: StoresInput): Promise<StoresSections> {
  return awaitSections(getStoresSectionPromises(input))
}

/* ── One store's file ─────────────────────────────────────────────────── */

export interface StoreFileHead {
  /** The store this file is for — the phone's one button links to its desk page. */
  storeId: string
  title: string
  sub: string
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

export interface StoreFileInputs {
  fixed: KvRow[]
  trade: KvRow[]
  place: KvRow[]
  meta: string
  note: string
}

/**
 * The raw values the store file's form edits, as stored. Separate from
 * `StoreFileInputs`, which is formatted for reading — a form needs the number,
 * not "$10,390".
 */
export interface StoreFileEditable {
  storeId: string
  name: string
  rent: number | null
  labor: number | null
  towels: number | null
  cleaning: number | null
  uber: number
  doordash: number
  /** Stated, not offered: `updateStoreSchema` does not accept it. */
  cogsTarget: number | null
  /**
   * The store's fixed-expense lines, carried on the EDIT section rather than
   * on `expenses` beside the table that displays them.
   *
   * That looks like the wrong home for them and is the right one. `P.storecosts`
   * puts "Add a fixed expense" in "Edit this file", after the tri and
   * immediately before the final button row — not under the Fixed expenses
   * table, which the fixture draws with no control on it at all. The fidelity
   * gate aligns landmarks by document ORDER, so an editor rendered under the
   * table reads as two extra buttons in the wrong place and two missing ones
   * further down. The invoice page learned this the same way.
   *
   * One `Section` renders one data source, so the lines travel with the
   * section that is rendered where the fixture puts the control.
   */
  expenseLines: StoreExpenseLine[]
}

/**
 * The proration, written out — `P.storecosts`'s "How it reaches the P&L".
 *
 * The prototype draws four lines, and the last is the same figure as the
 * third: monthly, ÷ to a day, × the days in range, and then that total again
 * under a rule. That repetition is the point of the panel — it is showing its
 * work, so an owner can see that a lease charge is not landing in one day.
 */
export interface StoreFileMath {
  rows: MathRow[]
  meta: string
  note: string
}

/** `P.storecosts`'s "Fixed expenses" — one `StoreFixedExpense` per row. */
export interface StoreFileExpenses {
  columns: Column[]
  rows: Row[]
  /** `P.storecosts.phone()`'s second list: the line, its cadence, its monthly. */
  phoneRows: MListRow[]
  meta: string
}

/** An editrow pair: a name, and the figure the owner typed. */
export interface StoreFileRate {
  key: string
  label: string
  value: string
  /** The unit that sits in the `<em>`: "%" for a rate, "$" before an amount. */
  unit: string
  /** Rendered before the value rather than after. */
  unitLeads?: boolean
  note?: string
}

export interface StoreFileRates {
  rows: StoreFileRate[]
  note: string
}

export interface StoreFileSections {
  head: SectionData<StoreFileHead>
  inputs: SectionData<StoreFileInputs>
  /** The four operating inputs as editrows, with their cadence conversion. */
  operating: SectionData<StoreFileRates>
  math: SectionData<StoreFileMath>
  expenses: SectionData<StoreFileExpenses>
  commissions: SectionData<StoreFileRates>
  targets: SectionData<StoreFileRates>
  lands: SectionData<KvRow[]>
  editable: SectionData<StoreFileEditable>
}

export interface StoreFileInput {
  storeId: string
  accountId: string
  /**
   * The window every fixed cost on this page is prorated to. Required, not
   * optional: a store file that silently prorated to a default month while the
   * control above it said seven days would be the same defect twice over — a
   * figure that disagrees with its own label, and a second clock.
   */
  range: DateRange
}

export async function getStoreFileName(
  storeId: string,
  accountId: string,
): Promise<{ name: string } | null> {
  const row = await prisma.store.findFirst({
    where: { id: storeId, accountId },
    select: { name: true },
  })
  return row ? { name: shortName(row.name) } : null
}

/** Prorated to a 30-day month, which is what an owner reads a rent as. */
const MONTH_DAYS = 30

export function getStoreFileSectionPromises(
  input: StoreFileInput,
): StreamedSections<StoreFileSections> {
  const days = dayCount(input.range)

  const dataP = classify(
    async () => {
      const row = await prisma.store.findFirst({
        where: { id: input.storeId, accountId: input.accountId },
        select: FILE_SELECT,
      })
      return row ? shapeFile(row) : null
    },
    { retryAction: "retryStoreFile", isEmpty: (s) => s === null, emptyReason: "no_match" },
  )

  const s = <T,>(f: (s: StoreFileRow) => T) =>
    guardSection(
      dataP.then((sd) => mapReady(sd, (v) => f(v as StoreFileRow))),
      "retryStoreFile",
    )


  return {
    editable: s((store) => ({
      storeId: store.id,
      name: store.name,
      rent: store.rent,
      labor: store.labor,
      towels: store.towels,
      cleaning: store.cleaning,
      uber: store.uber ?? DEFAULT_UBER,
      doordash: store.doordash ?? DEFAULT_DOORDASH,
      cogsTarget: store.cogsTarget,
      expenseLines: store.expenses,
    })),
    head: s((store) => {
      const monthly = fixedMonthly(store)
      const gaps = missingInputs(store)
      const fixedCell: FigureProps = {
        label: "Fixed cost, monthly",
        value: money(monthly),
        delta:
          store.rent === null
            ? "no rent on file"
            : `${money(monthlyCostForDays(monthly, MONTH_DAYS) ?? 0)} over ${count(MONTH_DAYS)} days`,
        deltaTone: store.rent === null ? "is-down" : "is-flat",
      }
      const gapsCell: FigureProps = {
        label: "Missing inputs",
        value: count(gaps.length),
        delta: gaps.length === 0 ? "the file is complete" : gaps.join(", "),
        deltaTone: gaps.length > 0 ? "is-down" : "is-flat",
      }
      return {
        storeId: store.id,
        title: shortName(store.name),
        sub:
          `${stageLabel(store)}${store.address ? ` · ${store.address}` : ""}` +
          (store.openedAt
            ? ` · opened ${store.openedAt.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}`
            : ""),
        cells: [
          fixedCell,
          {
            label: "COGS target",
            value:
              store.cogsTarget === null ? "—" : pct(store.cogsTarget, { scaled: true }),
            delta: store.cogsTarget === null ? "not set" : "the plan this store is judged on",
            deltaTone: store.cogsTarget === null ? "is-down" : "is-flat",
          },
          {
            label: "Commissions",
            value:
              store.uber === null
                ? "—"
                : pct((store.uber ?? 0) * 100, { scaled: true }),
            delta: defaultRates(store) ? "platform default, not confirmed" : "entered by hand",
            deltaTone: defaultRates(store) ? "is-down" : "is-flat",
          },
          gapsCell,
        ],
        phoneCells: [fixedCell, gapsCell],
      }
    }),
    inputs: s((store) => ({
      fixed: [
        { label: "Rent", value: store.rent === null ? "not set" : money(store.rent), ...(store.rent === null ? { tone: "bad" as const } : {}) },
        { label: "Labor budget", value: store.labor === null ? "not set" : money(store.labor), ...(store.labor === null || store.labor === 0 ? { tone: "bad" as const } : {}) },
        { label: "Cleaning", value: store.cleaning === null ? "not set" : money(store.cleaning) },
        { label: "Towels", value: store.towels === null ? "not set" : money(store.towels) },
        { label: "Monthly total", value: money(fixedMonthly(store)) },
      ],
      trade: [
        {
          label: "COGS target",
          value: store.cogsTarget === null ? "not set" : pct(store.cogsTarget, { scaled: true }),
          ...(store.cogsTarget === null ? { tone: "bad" as const } : {}),
        },
        {
          label: "Uber Eats",
          value: store.uber === null ? "not set" : pct(store.uber * 100, { scaled: true }),
          ...(defaultRates(store) ? { tone: "warn" as const } : {}),
        },
        {
          label: "DoorDash",
          value: store.doordash === null ? "not set" : pct(store.doordash * 100, { scaled: true }),
          ...(defaultRates(store) ? { tone: "warn" as const } : {}),
        },
        { label: "Stage", value: stageLabel(store) },
        { label: "Active", value: store.active ? "yes" : "no" },
      ],
      /**
       * The prototype lists five: Address, Phone, Geocoded, Event radius,
       * Lifecycle. Four are drawn.
       *
       * **Phone is drawn and empty** — the column exists and nothing has ever
       * populated it on any store, which is a missing input a reader can fix.
       * **Event radius is not drawn at all**: there is no column, per-store or
       * otherwise, that parameterises the event-signal radius. The prototype's
       * "2.5 miles" is its own invention, and a row restating a constant we do
       * not hold would be a setting that looks editable and is not (note 46).
       */
      place: [
        { label: "Address", value: store.address ?? "not set" },
        {
          label: "Phone",
          value: store.phone ?? "not set",
          ...(store.phone === null ? { tone: "bad" as const } : {}),
        },
        {
          label: "Geocoded",
          value: store.geocoded ? "yes" : "no",
          ...(store.geocoded ? {} : { tone: "bad" as const }),
        },
        { label: "Lifecycle", value: stageLabel(store) },
      ],
      meta: "standing inputs",
      note:
        defaultRates(store)
          ? `The commission rates are the platform defaults to the digit. Nothing in the product ` +
            `distinguishes a default from a rate somebody read off a contract, and every ` +
            `third-party margin is computed from them.`
          : `The commission rates were entered rather than defaulted.`,
    })),
    /**
     * The four operating inputs, as the prototype draws them: amount, the
     * cadence it was entered in, and the monthly equivalent. Towels is the one
     * that earns the third column — the schema stores a weekly entry already
     * converted, and this is the only place the product shows its work.
     */
    operating: s((store) => ({
      rows: [
        rateRow("rent", "Rent", store.rent, "Monthly"),
        rateRow(
          "labor",
          "Fixed labor",
          store.labor,
          store.labor === 0 ? "Monthly, salaried — entered as zero" : "Monthly, salaried",
        ),
        rateRow(
          "towels",
          "Towels & linen",
          store.towels,
          store.towels === null
            ? "Weekly"
            : `Weekly → ${money(store.towels)}/mo`,
        ),
        rateRow("cleaning", "Deep cleaning", store.cleaning, "Monthly"),
      ],
      note:
        store.labor === 0
          ? `Fixed labor is $0, and that is a value somebody entered rather than a blank. ` +
            `Every check for "is this store configured" tests for null, so a zero passes ` +
            `it and the store reads as complete.`
          : `Each of these lands on the P&L as its own line, prorated to the range above.`,
    })),

    math: s((store) => {
      const monthly = fixedMonthly(store) + expensesMonthly(store)
      const perDay = (monthly * 12) / 365
      const inRange = monthlyCostForDays(monthly, days) ?? 0
      return {
        rows: [
          { key: "monthly", label: "Fixed cost, monthly", value: money(monthly) },
          {
            key: "perday",
            label: "× 12 ÷ 365 → per day",
            value: money(perDay, { cents: true }),
            op: true,
          },
          {
            key: "inrange",
            label: `× ${count(days)} day${days === 1 ? "" : "s"} in range`,
            value: money(inRange),
            op: true,
          },
          {
            key: "charged",
            label: "Charged to this period",
            value: money(inRange),
            strong: true,
          },
        ],
        meta: `for ${count(days)} day${days === 1 ? "" : "s"}`,
        note:
          `Change the range above and this recalculates. A month-long lease charge ` +
          `never lands in one day.`,
      }
    }),

    /**
     * Composed, and on this account it has NO ROWS. `StoreFixedExpense` holds
     * zero across all three stores — measured, not assumed
     * (`docs/counter/measurements/2026-08-31-store-file.md`). The prototype's
     * widest panel is a table of six of them.
     *
     * READY WITH ZERO ROWS, NOT `Empty`. This is the alerts page's
     * shell-over-zero-rows trick, and it is here for the reason ruling F-R8
     * gives: the fidelity gate never forgives an EXTRA, so an `.empty` in
     * place of the prototype's `.tbl` costs two landmarks — the table that is
     * missing and the empty state that is extra — where a table with its
     * columns and no rows costs none.
     *
     * It is also the more honest of the two. Note 33's objection was to a
     * table of em-dashes pretending to be data; a table showing the five
     * columns an expense line HAS, with no lines under it and a meta saying
     * so, is a blank panel that tells a reader exactly what to add. Unlike an
     * empty `.mlist`, a `thead` still carries text, so the rendering pass has
     * something to compare.
     */
    expenses: s<StoreFileExpenses>(
      (store) => ({
        columns: [
          { key: "label", label: "Expense" },
          { key: "amount", label: "Amount", numeric: true },
          { key: "cadence", label: "Cadence" },
          { key: "monthly", label: "Monthly", numeric: true },
          { key: "range", label: "In this range", numeric: true },
        ],
        rows: store.expenses.map((e) => ({
          key: e.id,
          cells: {
            label: e.label,
            amount: money(e.amount),
            cadence: CADENCE_LABEL[e.frequency],
            monthly: money(e.monthly),
            range: money(monthlyCostForDays(e.monthly, days) ?? 0),
          },
        })),
        // An `.mlist` with no rows carries no text, and the fidelity gate reads
        // an element that should say something and says nothing as a defect —
        // correctly, because on a phone that is a panel with a heading and a
        // blank underneath it. This account has NO `StoreFixedExpense` rows, so
        // the empty case states that rather than rendering nothing. The desk's
        // table survives being empty because its header still speaks.
        phoneRows:
          store.expenses.length === 0
            ? [
                {
                  key: "none",
                  title: "No fixed expenses on file",
                  detail: "each one added becomes its own P&L row",
                  value: "—",
                },
              ]
            : store.expenses.map((e) => ({
                key: e.id,
                title: e.label,
                detail: CADENCE_LABEL[e.frequency],
                value: money(e.monthly),
              })),
        meta:
          store.expenses.length === 0
            ? "none on file · each would become its own P&L row"
            : `${count(store.expenses.length)} line${store.expenses.length === 1 ? "" : "s"} · each becomes its own P&L row`,
      }),
    ),

    /**
     * Two rates, not the prototype's three: `Store` carries
     * `uberCommissionRate` and `doordashCommissionRate` and there is no
     * Grubhub column. Drawing a third from nothing would be inventing a
     * contract.
     */
    commissions: s((store) => ({
      rows: [
        pctRow("uber", "Uber Eats", store.uber),
        pctRow("doordash", "DoorDash", store.doordash),
      ],
      note: defaultRates(store)
        ? `Both rates are the platform default to the digit, and nothing in the product ` +
          `distinguishes a default from a rate read off a contract. Every page that ` +
          `prices a marketplace order reads these two.`
        : `Every page that prices a marketplace order reads these two.`,
    })),

    targets: s((store) => ({
      rows: [
        pctRow("cogs", "COGS target", store.cogsTarget === null ? null : store.cogsTarget / 100),
        {
          key: "prime",
          label: "Prime ceiling",
          value: PRIME_CEILING_PCT.toFixed(1),
          unit: "%",
          note: "the trade's ceiling, not this store's",
        },
      ],
      note:
        `The COGS target drives the band on every food-cost chart. The prime ceiling is ` +
        `${PRIME_CEILING_PCT.toFixed(0)}% for every store — it is a trade constant, and no ` +
        `column publishes a per-store one.`,
    })),

    lands: s((store) => [
      { label: "Rent", value: "Occupancy" },
      { label: "Fixed labor", value: "Labor" },
      { label: "Towels, cleaning", value: "Other operating" },
      {
        label:
          store.expenses.length === 0
            ? "Fixed expenses"
            : `${count(store.expenses.length)} fixed expenses`,
        value: store.expenses.length === 0 ? "none on file" : "their own rows",
        ...(store.expenses.length === 0 ? { tone: "bad" as const } : {}),
      },
      { label: "Commissions", value: "Marketplace fees" },
    ]),
  }
}

/** An editrow carrying a money amount, or the absence of one. */
function rateRow(
  key: string,
  label: string,
  value: number | null,
  note: string,
): StoreFileRate {
  return {
    key,
    label,
    value: value === null ? "—" : value.toLocaleString("en-US"),
    unit: "$",
    unitLeads: true,
    note,
  }
}

/** An editrow carrying a rate stored as a fraction, shown as points. */
function pctRow(key: string, label: string, value: number | null): StoreFileRate {
  return {
    key,
    label,
    value: value === null ? "—" : (value * 100).toFixed(1),
    unit: "%",
  }
}

/** What the expense LINES add to the four columns, per month. */
function expensesMonthly(store: StoreFileRow): number {
  return store.expenses.reduce((sum, e) => sum + e.monthly, 0)
}

export async function getStoreFileSections(
  input: StoreFileInput,
): Promise<StoreFileSections> {
  return awaitSections(getStoreFileSectionPromises(input))
}
