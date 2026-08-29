import { prisma } from "@/lib/prisma"
import { count } from "@/lib/counter/format"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import type { FigureProps, Row } from "@/components/counter"

/**
 * Start a count — `P.newcount` (`docs/counter/counter-prototype.html`).
 *
 * ## The wizard's first panel has no data behind it
 *
 * `P.newcount` opens with four toggles — Walk-in, Dry store, Line, Freezer —
 * and a warning that leaving the freezer out lets its on-hand drift. There is
 * no storage area anywhere in this schema: every column in the database
 * matching `%area%`, `%zone%`, `%storage%`, `%location%` or `%shelf%` comes
 * back as one row, and it is `User.timezone`.
 *
 * The only grouping an ingredient carries is `CanonicalIngredient.category`,
 * and it is a supplier taxonomy — Paper/Supplies 26, Dry Goods 17, Beverages
 * 12 — not a walk route. A sheet grouped by it would send someone to the
 * walk-in four times. The page groups by it anyway, because it is what
 * exists, and names it for what it is rather than dressing it as a room.
 *
 * ## And nothing has ever been counted
 *
 * The prototype's sub-header reads "Weekly count · 34 lines · typically 18
 * minutes". Four counts have ever been started and **none completed**: two
 * abandoned with zero lines, two still open — one since 8 May with nothing
 * entered. The most recent activity of any kind is 12 May. 10 of the 76
 * canonicals have ever appeared on a count line.
 *
 * So there is no typical duration, no weekly cadence, and no last-counted
 * date for 66 of the 76 rows a sheet would list. What there IS, and what the
 * page leads with, is that pressing the button on Hollywood **resumes** the
 * count abandoned in May rather than starting a new one — which
 * `startOrResumeStockCount` does silently, and which a reader should know
 * before pressing rather than after.
 *
 * See `docs/counter/measurements/2026-08-29-start-a-count.md`.
 */

/** Rows the sheet preview prints. */
const SHEET_ROWS = 14

export interface CountGroup {
  category: string
  lines: number
  inRecipe: number
  everCounted: number
}

interface SheetLine {
  id: string
  name: string
  category: string
  unit: string | null
  lastCountedAt: Date | null
}

interface OpenCount {
  id: string
  storeId: string
  storeName: string
  startedAt: Date
  lines: number
  status: string
}

interface NewCountData {
  /** The open count on the store the button will act on, if there is one. */
  targetOpen: OpenCount | null
  targetStoreName: string | null
  groups: CountGroup[]
  sheet: SheetLine[]
  totalLines: number
  everCounted: number
  open: OpenCount[]
  lastActivity: Date | null
  completedCounts: number
  startedCounts: number
}

/* ── Load ─────────────────────────────────────────────────────────────── */

const UNCATEGORIZED = "Uncategorized"

export interface NewCountInput {
  /** Narrows the open-count list. `null` shows every store. */
  storeId: string | null
  /**
   * The store the page's button will act on. The verdict must name THIS store
   * — naming the oldest open count instead described a store the button would
   * not touch.
   */
  targetStoreId: string | null
}

async function loadNewCount(input: NewCountInput): Promise<NewCountData> {
  const [canonicals, lastLines, counts] = await Promise.all([
    prisma.canonicalIngredient.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        category: true,
        recipeUnit: true,
        _count: { select: { recipeIngredients: true } },
      },
    }),
    prisma.$queryRaw<Array<{ canonicalIngredientId: string; lastAt: Date }>>`
      SELECT l."canonicalIngredientId", MAX(c."countedAt") "lastAt"
      FROM "StockCountLine" l JOIN "StockCount" c ON c.id = l."stockCountId"
      GROUP BY 1`,
    prisma.stockCount.findMany({
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        storeId: true,
        status: true,
        startedAt: true,
        completedAt: true,
        store: { select: { name: true } },
        _count: { select: { lines: true } },
      },
    }),
  ])

  const lastByIngredient = new Map(lastLines.map((r) => [r.canonicalIngredientId, r.lastAt]))

  const sheet: SheetLine[] = canonicals.map((c) => ({
    id: c.id,
    name: c.name,
    category: c.category?.trim() || UNCATEGORIZED,
    unit: c.recipeUnit,
    lastCountedAt: lastByIngredient.get(c.id) ?? null,
  }))

  const byCategory = new Map<string, CountGroup>()
  for (const c of canonicals) {
    const key = c.category?.trim() || UNCATEGORIZED
    const group = byCategory.get(key) ?? {
      category: key,
      lines: 0,
      inRecipe: 0,
      everCounted: 0,
    }
    group.lines++
    if (c._count.recipeIngredients > 0) group.inRecipe++
    if (lastByIngredient.has(c.id)) group.everCounted++
    byCategory.set(key, group)
  }

  const open = counts
    .filter((c) => c.status === "IN_PROGRESS")
    .filter((c) => input.storeId === null || c.storeId === input.storeId)
    .map((c) => ({
      id: c.id,
      storeId: c.storeId,
      storeName: c.store.name,
      startedAt: c.startedAt,
      lines: c._count.lines,
      status: c.status,
    }))

  const targetOpen =
    input.targetStoreId === null
      ? null
      : (open.find((c) => c.storeId === input.targetStoreId) ?? null)

  return {
    targetOpen,
    targetStoreName:
      counts.find((c) => c.storeId === input.targetStoreId)?.store.name ?? null,
    groups: [...byCategory.values()].sort((a, b) => b.lines - a.lines),
    sheet,
    totalLines: canonicals.length,
    everCounted: lastByIngredient.size,
    open,
    lastActivity: counts[0]?.startedAt ?? null,
    completedCounts: counts.filter((c) => c.completedAt !== null).length,
    startedCounts: counts.length,
  }
}

/* ── Shaping ──────────────────────────────────────────────────────────── */

function daysAgo(at: Date | null): string {
  if (!at) return "never"
  const days = Math.round((Date.now() - at.getTime()) / 86_400_000)
  if (days === 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 60) return `${count(days)} days ago`
  return `${count(Math.round(days / 30))} months ago`
}

export interface NewCountHeadline {
  verdict: string
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

function headlineOf(d: NewCountData): NewCountHeadline {
  const oldest = [...d.open].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())[0]

  const verdict =
    (d.completedCounts === 0
      ? `${count(d.startedCounts)} counts have been started and none finished. `
      : `${count(d.completedCounts)} of ${count(d.startedCounts)} counts have been finished. `) +
    (d.targetOpen
      ? `The button below resumes ${d.targetOpen.storeName}'s count, opened ` +
        `${daysAgo(d.targetOpen.startedAt)} with ${
          d.targetOpen.lines === 0
            ? "nothing entered"
            : `${count(d.targetOpen.lines)} lines entered`
        }, rather than opening a new one. `
      : oldest
        ? `${count(d.open.length)} counts are open on other stores, the oldest ` +
          `${daysAgo(oldest.startedAt)}. `
        : "") +
    `The sheet is ${count(d.totalLines)} ingredients, of which ${count(d.everCounted)} have ` +
    `ever been counted, so there is no expected quantity to check the other ` +
    `${count(d.totalLines - d.everCounted)} against.`

  const cells: FigureProps[] = [
    {
      label: "Counts finished",
      value: `${count(d.completedCounts)} of ${count(d.startedCounts)}`,
      caption: `last activity ${daysAgo(d.lastActivity)}`,
      deltaTone: "is-down",
    },
    {
      label: "On the sheet",
      value: count(d.totalLines),
      caption: `${count(d.groups.length)} categories`,
    },
    {
      label: "Ever counted",
      value: count(d.everCounted),
      caption: `${count(d.totalLines - d.everCounted)} have no expected quantity`,
      deltaTone: "is-down",
    },
    {
      label: "Counts left open",
      value: count(d.open.length),
      caption: oldest ? `oldest ${daysAgo(oldest.startedAt)}` : "none",
      deltaTone: d.open.length > 0 ? "is-down" : undefined,
    },
  ]

  return { verdict, cells, phoneCells: cells.slice(0, 2) }
}

export interface NewCountGroups {
  groups: CountGroup[]
  meta: string
  note: string
}

function groupsOf(d: NewCountData): NewCountGroups {
  return {
    groups: d.groups,
    meta: `${count(d.groups.length)} categories · ${count(d.totalLines)} lines`,
    note:
      `The prototype groups this by room — walk-in, dry store, line, freezer — and no room ` +
      `exists in this data. What an ingredient carries is a supplier category, so that is ` +
      `what these are. It is not a walk route: Paper/Supplies and Dry Goods are shelves apart ` +
      `in most kitchens, and a count ordered this way will send someone back to the same ` +
      `place twice. Grouping by area needs an area on the ingredient first.`,
  }
}

export interface NewCountSheet {
  rows: Row[]
  meta: string
  note: string
}

function sheetOf(d: NewCountData): NewCountSheet {
  const ordered = [...d.sheet].sort(
    (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  )

  return {
    rows: ordered.slice(0, SHEET_ROWS).map((line, i) => ({
      key: line.id,
      cells: {
        n: count(i + 1),
        ingredient: line.name,
        category: line.category,
        unit: line.unit ?? { v: "no unit", cls: "hot" },
        last:
          line.lastCountedAt === null
            ? { v: "never", cls: "hot" }
            : daysAgo(line.lastCountedAt),
      },
    })),
    meta: `first ${count(Math.min(SHEET_ROWS, ordered.length))} of ${count(ordered.length)} · by category, then name`,
    note:
      `Ordered by category and then alphabetically, because there is no walk order to order ` +
      `by. "Never" in the last column is ${count(d.totalLines - d.everCounted)} of the ` +
      `${count(d.totalLines)} rows: for those the count has nothing to compare against, so ` +
      `the first count is a baseline rather than a check.`,
  }
}

export interface NewCountOpen {
  rows: Row[]
  /** True when the button will continue an existing count rather than open one. */
  resumes: boolean
  meta: string
  note: string
}

function openOf(d: NewCountData): NewCountOpen {
  return {
    rows: d.open.map((c) => ({
      key: c.id,
      href: `/dashboard/operations/inventory/counts/${c.id}`,
      ariaLabel: `Open the count started at ${c.storeName}`,
      cells: {
        store: c.storeName,
        started: c.startedAt.toISOString().slice(0, 10),
        age: { v: daysAgo(c.startedAt), cls: "hot" },
        lines: c.lines === 0 ? { v: "none", cls: "hot" } : count(c.lines),
      },
    })),
    resumes: d.targetOpen !== null,
    meta: d.open.length === 0 ? "none open" : `${count(d.open.length)} open`,
    note:
      d.open.length === 0
        ? `No count is open, so starting one opens a new session.`
        : `Starting a count on a store that already has one open resumes it — ` +
          `startOrResumeStockCount returns the existing session rather than creating a ` +
          `second. That is the right behaviour and it is invisible, which is why it is ` +
          `stated here: pressing the button below on one of these stores continues a count ` +
          `from May, it does not begin a fresh one.`,
  }
}

export interface NewCountSections {
  headline: SectionData<NewCountHeadline>
  groups: SectionData<NewCountGroups>
  sheet: SectionData<NewCountSheet>
  open: SectionData<NewCountOpen>
}

export function getNewCountSectionPromises(
  input: NewCountInput,
): StreamedSections<NewCountSections> {
  const dataP = classify(() => loadNewCount(input), {
    retryAction: "retryNewCount",
    isEmpty: (d) => d.totalLines === 0,
    emptyReason: "no_match",
  })
  const s = <T,>(f: (d: NewCountData) => T) =>
    guardSection(dataP.then((sd) => mapReady(sd, f)), "retryNewCount")
  return {
    headline: s(headlineOf),
    groups: s(groupsOf),
    sheet: s(sheetOf),
    open: s(openOf),
  }
}

export async function getNewCountSections(
  input: NewCountInput,
): Promise<NewCountSections> {
  return awaitSections(getNewCountSectionPromises(input))
}
