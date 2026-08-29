import { prisma } from "@/lib/prisma"
import { monthlyCostForDays } from "@/lib/pnl"
import { count, money, pct, titleCase } from "@/lib/counter/format"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import type { FigureProps, KvRow, MListRow, QueueItem, Row } from "@/components/counter"

/**
 * Stores — `P.stores` and `P.storecosts`
 * (`docs/counter/counter-prototype.html`).
 *
 * "Each store carries its own operating inputs, commission rates and COGS
 * target."
 *
 * `nodate: true` in the prototype and rightly so: a store file is a set of
 * standing inputs, not a period. Neither surface reads the date control.
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
  if (s.labor === 0) gaps.push("a labour budget above zero")
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
        delta: `across ${count(d.stores.filter((s) => missingInputs(s).length > 0).length)} stores`,
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
    meta: `${count(d.stores.length)} · standing inputs, not a period`,
    note:
      onDefaults > 0
        ? `${count(onDefaults)} of ${count(d.stores.length)} stores carry Uber at ` +
          `${pct(DEFAULT_UBER * 100, { scaled: true })} and DoorDash at ` +
          `${pct(DEFAULT_DOORDASH * 100, { scaled: true })} — the platform defaults, to the ` +
          `digit. Either three contracts happen to match or nobody has entered a signed rate. ` +
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
      key: "labour",
      tone: "warn",
      lead: count(zeroLabour.length),
      unit: zeroLabour.length === 1 ? "store" : "stores",
      title: "A labour budget of zero reads as configured",
      body:
        `${zeroLabour.map((s) => shortName(s.name)).join(" and ")} ` +
        `${zeroLabour.length === 1 ? "carries" : "carry"} a labour budget of exactly $0 while ` +
        `paying wages every week. The flag the rest of the product reads to decide whether a ` +
        `store's costs are on file tests for null, and zero is not null, so it passes.`,
      act: "Open the store file",
      href: `/dashboard/stores/${zeroLabour[0].id}`,
    })
  }

  return { items, meta: `${count(items.length)} things to do` }
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

export interface StoreFileSections {
  head: SectionData<StoreFileHead>
  inputs: SectionData<StoreFileInputs>
  work: SectionData<StoresWork>
}

export interface StoreFileInput {
  storeId: string
  accountId: string
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
  const dataP = classify(
    async () => {
      const row = await prisma.store.findFirst({
        where: { id: input.storeId, accountId: input.accountId },
        select: SELECT,
      })
      return row ? shape(row) : null
    },
    { retryAction: "retryStoreFile", isEmpty: (s) => s === null, emptyReason: "no_match" },
  )

  const s = <T,>(f: (s: StoreRow) => T) =>
    guardSection(
      dataP.then((sd) => mapReady(sd, (v) => f(v as StoreRow))),
      "retryStoreFile",
    )

  return {
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
        { label: "Labour budget", value: store.labor === null ? "not set" : money(store.labor), ...(store.labor === null || store.labor === 0 ? { tone: "bad" as const } : {}) },
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
      place: [
        { label: "Address", value: store.address ?? "not set" },
        {
          label: "Geocoded",
          value: store.geocoded ? "yes" : "no",
          ...(store.geocoded ? {} : { tone: "bad" as const }),
        },
      ],
      meta: "standing inputs",
      note:
        defaultRates(store)
          ? `The commission rates are the platform defaults to the digit. Nothing in the product ` +
            `distinguishes a default from a rate somebody read off a contract, and every ` +
            `third-party margin is computed from them.`
          : `The commission rates were entered rather than defaulted.`,
    })),
    work: guardSection(
      dataP.then((sd) => mapReady(sd, (v) => workOf({ stores: [v as StoreRow] }))),
      "retryStoreFile",
    ),
  }
}

export async function getStoreFileSections(
  input: StoreFileInput,
): Promise<StoreFileSections> {
  return awaitSections(getStoreFileSectionPromises(input))
}
