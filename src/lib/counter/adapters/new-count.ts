import { prisma } from "@/lib/prisma"
import { count } from "@/lib/counter/format"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import type { MListRow, Row } from "@/components/counter"

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

export interface NewCountGroups {
  groups: CountGroup[]
  /** `P.countnew.phone()`'s "Areas" list: one line per category, on or off. */
  phoneRows: MListRow[]
  meta: string
  note: string
}

function groupsOf(d: NewCountData): NewCountGroups {
  return {
    groups: d.groups,
    // Every category is ON by default — a first count counts everything, and
    // the phone has no toggle, so this list reports the sheet rather than
    // offering a choice the desk makes.
    phoneRows: d.groups.map((g) => ({
      key: g.category,
      title: g.category,
      detail: `${count(g.lines)} line${g.lines === 1 ? "" : "s"} · ${count(g.inRecipe)} in a recipe`,
      value: "On",
      note: g.everCounted === 0 ? "never counted" : `${count(g.everCounted)} counted before`,
      noteTone: (g.everCounted === 0 ? "down" : "up") as "up" | "down",
    })),
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

/**
 * What the button will actually do — `P.countnew` has no table for this and
 * needs none.
 *
 * This was a "Counts already open" TABLE, four columns over the one or two
 * sessions this account has left open. The design's page is three panels and
 * none of them is that. What the table was really for is the sentence under
 * the button: pressing it on a store with an open count RESUMES a session from
 * May rather than starting a fresh one, which is right behaviour and invisible
 * behaviour. A sentence says it where the button is; a table said it three
 * panels earlier.
 *
 * It also absorbed the one clause of the deleted verdict that nothing else on
 * the page says — how many counts have ever been started against how many
 * finished. The verdict's other two clauses were already the sheet's note and
 * this one, which is why `NewCountHeadline` is gone rather than moved.
 */
export interface NewCountOpen {
  /** True when the button will continue an existing count rather than open one. */
  resumes: boolean
  note: string
}

function openOf(d: NewCountData): NewCountOpen {
  const oldest = [...d.open].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())[0]

  return {
    resumes: d.targetOpen !== null,
    note:
      (d.completedCounts === 0
        ? `${count(d.startedCounts)} counts have been started here and none finished. `
        : `${count(d.completedCounts)} of ${count(d.startedCounts)} counts have been finished. `) +
      (d.open.length === 0
        ? `No count is open, so this opens a new session. `
        : d.targetOpen
          ? `This RESUMES ${d.targetOpen.storeName}'s count, opened ` +
            `${daysAgo(d.targetOpen.startedAt)} with ${
              d.targetOpen.lines === 0
                ? "nothing entered"
                : `${count(d.targetOpen.lines)} lines entered`
            } — startOrResumeStockCount returns the existing session rather than creating a ` +
            `second. That is right behaviour, and invisible, which is why it is said here ` +
            `rather than left to be discovered. `
          : `${count(d.open.length)} count${d.open.length === 1 ? " is" : "s are"} open on ` +
            `other stores, the oldest ${daysAgo(oldest.startedAt)}. This opens a new one on ` +
            `the store you are looking at. `) +
      `There is no send-to-phone and no print: neither exists behind the prototype's other ` +
      `two buttons, and a button that does nothing is worse than one that is absent.`,
  }
}

export interface NewCountSections {
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
