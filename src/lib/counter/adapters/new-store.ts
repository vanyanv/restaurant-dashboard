import { prisma } from "@/lib/prisma"
import { count, money, pct } from "@/lib/counter/format"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import type { QueueItem, Row } from "@/components/counter"

/**
 * New store — `P.newstore` (`docs/counter/counter-prototype.html`).
 *
 * ## The form has four fields and the action reads three
 *
 * `P.newstore` shows Store name, Address, Phone and **Lifecycle**
 * ("Pre-open · skip forecasting"). `createStoreSchema` accepts `name`,
 * `address` and `phone`. There is no lifecycle in it, so
 * `Store.lifecycleStage` takes its schema default — `pre_open` — on every
 * store ever created.
 *
 * That default is the right one. The control is still wrong: a select that
 * looks like a choice and is not read is worse than a sentence saying the
 * store starts pre-open, so the page says the sentence.
 *
 * ## Its three "what this switches on" notes check out
 *
 * Address does drive weather — all three stores are geocoded and
 * `StoreWeatherSignal` holds 21,216 rows — though the events half is dead
 * upstream, which the model health page reports. `lifecycleStage` is a real
 * stored column, read by `@/lib/store-lifecycle`, which is what stops a
 * pre-open store rendering as healthy. And rent and commissions do decide
 * whether the P&L is true.
 *
 * ## So the checklist is measured, not mocked
 *
 * The prototype's "before opening" table is six invented rows with invented
 * states. Every one is measurable on the stores that exist, and two of them
 * are opening, so the page shows the account's real readiness. A fictional
 * checklist on a create form teaches nothing; this one names the store.
 *
 * See `docs/counter/measurements/2026-08-29-new-store.md`.
 */

/** Both platforms' published default rates — a store on these has not been confirmed. */
const DEFAULT_UBER = 0.21
const DEFAULT_DOORDASH = 0.25

interface StoreReadiness {
  id: string
  name: string
  stage: string | null
  rent: number | null
  labor: number | null
  cogsTarget: number | null
  ratesConfirmed: boolean
  geocoded: boolean
  otterLinked: boolean
  harriLinked: boolean
}

interface NewStoreData {
  stores: StoreReadiness[]
  weatherRows: number
}

/* ── Load ─────────────────────────────────────────────────────────────── */

export interface NewStoreInput {
  accountId: string
}

async function loadNewStore(input: NewStoreInput): Promise<NewStoreData> {
  const [stores, otter, harri, weatherRows] = await Promise.all([
    prisma.store.findMany({
      where: { accountId: input.accountId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        lifecycleStage: true,
        fixedMonthlyRent: true,
        fixedMonthlyLabor: true,
        targetCogsPct: true,
        uberCommissionRate: true,
        doordashCommissionRate: true,
        latitude: true,
      },
    }),
    prisma.otterStore.findMany({ select: { storeId: true } }),
    prisma.harriBrand.findMany({ select: { storeId: true } }),
    prisma.storeWeatherSignal.count(),
  ])

  const otterIds = new Set(otter.map((o) => o.storeId))
  const harriIds = new Set(harri.map((h) => h.storeId))

  return {
    stores: stores.map((s) => ({
      id: s.id,
      name: s.name.replace(/^Chris N Eddys?\s*[-–]\s*/i, ""),
      stage: s.lifecycleStage,
      rent: s.fixedMonthlyRent,
      labor: s.fixedMonthlyLabor,
      cogsTarget: s.targetCogsPct,
      ratesConfirmed:
        s.uberCommissionRate !== DEFAULT_UBER ||
        s.doordashCommissionRate !== DEFAULT_DOORDASH,
      geocoded: s.latitude !== null,
      otterLinked: otterIds.has(s.id),
      harriLinked: harriIds.has(s.id),
    })),
    weatherRows,
  }
}

/* ── Shaping ──────────────────────────────────────────────────────────── */

export interface NewStoreForm {
  /** Stated rather than offered — the create action does not read a stage. */
  lifecycleNote: string
  meta: string
}

function formOf(d: NewStoreData): NewStoreForm {
  const preOpen = d.stores.filter((s) => s.stage === "pre_open").length

  return {
    meta: "three fields, all the action reads",
    lifecycleNote:
      `The prototype has a fourth field here — a lifecycle select, "Pre-open · skip ` +
      `forecasting". The create action does not read one, so every store starts pre-open ` +
      `and the nightly model skips it until the stage is moved on. That is the right ` +
      `default and it is not a choice made here; ${count(preOpen)} of ` +
      `${count(d.stores.length)} stores on this account are sitting at it now. A select ` +
      `that looks like a choice and is not read is worse than this sentence.`,
  }
}

export interface NewStoreSwitches {
  items: QueueItem[]
  meta: string
}

function switchesOf(d: NewStoreData): NewStoreSwitches {
  const geocoded = d.stores.filter((s) => s.geocoded).length
  const noRent = d.stores.filter((s) => s.rent === null)

  return {
    meta: "so nothing is optional by accident",
    items: [
      {
        key: "address",
        tone: "warn",
        lead: "A",
        title: "The address turns on weather, once somebody geocodes it",
        body:
          `Coordinates are what let the nightly model use temperature, and ` +
          `${count(geocoded)} of ${count(d.stores.length)} stores have them — ` +
          `${count(d.weatherRows)} weather rows are written against those. Creating a store ` +
          `does NOT geocode it: that is scripts/geocode-stores.ts, run by hand, on no ` +
          `schedule. So a new store's address sits inert until someone runs it. The events ` +
          `half of the signal is dead for a separate reason — the provider has failed every ` +
          `run since 10 August — which the model health page reports.`,
      },
      {
        key: "lifecycle",
        tone: "warn",
        lead: "B",
        title: "The stage decides what the model does",
        body:
          `Pre-open skips training entirely, warming up borrows a trading store's shape, and ` +
          `trading runs a native model. It is a stored column and every surface reads it ` +
          `through one helper, so a store that has never served a customer cannot render as ` +
          `healthy. It cannot be set here; it is set on the store file once the store opens.`,
      },
      {
        key: "money",
        tone: "bad",
        lead: "C",
        title: "Rent and commissions decide whether the P&L is true",
        body:
          noRent.length === 0
            ? `Every store carries a rent, so no P&L on this account is flattered by a missing ` +
              `fixed cost.`
            : `${noRent.map((s) => s.name).join(" and ")} ` +
              `${noRent.length === 1 ? "has" : "have"} no rent recorded. While they are not ` +
              `trading that is correct; the day one opens it reads more profitable than it is, ` +
              `and the error compounds every day after. Both live on the store file.`,
      },
    ],
  }
}

export interface NewStoreChecklist {
  rows: Row[]
  meta: string
  note: string
}

function checklistOf(d: NewStoreData): NewStoreChecklist {
  const rows: Row[] = d.stores.map((s) => ({
    key: s.id,
    href: `/dashboard/stores/${s.id}`,
    ariaLabel: `Open ${s.name}'s store file`,
    cells: {
      store: s.name,
      stage: s.stage === "ready" ? "Trading" : { v: "Pre-open", cls: "hot" },
      rent: s.rent === null ? { v: "not set", cls: "hot" } : money(s.rent),
      labor:
        s.labor === null
          ? { v: "not set", cls: "hot" }
          : s.labor === 0
            ? { v: "zero", cls: "hot" }
            : money(s.labor),
      cogs:
        s.cogsTarget === null ? { v: "not set", cls: "hot" } : pct(s.cogsTarget, { scaled: true }),
      rates: s.ratesConfirmed ? "confirmed" : { v: "defaults", cls: "hot" },
      otter: s.otterLinked ? "linked" : { v: "none", cls: "hot" },
      harri: s.harriLinked ? "linked" : { v: "none", cls: "hot" },
    },
  }))

  const zeroLabor = d.stores.filter((s) => s.labor === 0)

  return {
    rows,
    meta: `${count(d.stores.length)} stores · measured, not a template`,
    note:
      `The prototype puts a checklist of six invented rows here. These are the stores that ` +
      `exist, and two of them are opening, so this is the same list with real answers. ` +
      (zeroLabor.length > 0
        ? `${zeroLabor.map((s) => s.name).join(" and ")} reads zero fixed labour rather than ` +
          `unset — someone saved a zero, which the P&L takes at its word. `
        : "") +
      `A store on default commission rates is not necessarily wrong; nothing in the product ` +
      `distinguishes a default from a rate somebody read off a contract, which is why they ` +
      `are marked rather than flagged.`,
  }
}

export interface NewStoreSections {
  form: SectionData<NewStoreForm>
  switches: SectionData<NewStoreSwitches>
  checklist: SectionData<NewStoreChecklist>
}

export function getNewStoreSectionPromises(
  input: NewStoreInput,
): StreamedSections<NewStoreSections> {
  const dataP = classify(() => loadNewStore(input), {
    retryAction: "retryNewStore",
    isEmpty: () => false,
    emptyReason: "no_match",
  })
  const s = <T,>(f: (d: NewStoreData) => T) =>
    guardSection(dataP.then((sd) => mapReady(sd, f)), "retryNewStore")
  return {
    form: s(formOf),
    switches: s(switchesOf),
    checklist: s(checklistOf),
  }
}

export async function getNewStoreSections(
  input: NewStoreInput,
): Promise<NewStoreSections> {
  return awaitSections(getNewStoreSectionPromises(input))
}
