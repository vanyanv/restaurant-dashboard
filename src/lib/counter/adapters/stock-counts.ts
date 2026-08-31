import { prisma } from "@/lib/prisma"
import { count, money, titleCase, unitCost } from "@/lib/counter/format"
import { rangeLabel, type DateRange } from "@/lib/counter/date-range"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import type { FigureProps, KvRow, MListRow, QueueItem, Row } from "@/components/counter"

/**
 * Stock counts — `P.counts` and `P.countsession`
 * (`docs/counter/counter-prototype.html`).
 *
 * "Every count session, who did it, and what it found."
 *
 * ## Variance cannot be computed, and that is the page
 *
 * `P.counts` is built on variance: its strip ends in `Shrink · 1.2% · ▲ 0.3
 * pts`, its table carries `Short`, `Over` and `$ variance`, and its second
 * section is a variance-by-session chart. **None of it has a source.**
 *
 * A variance needs an EXPECTED quantity to subtract the counted one from.
 * `StockCountLine.estimatedQtyAtCount` is the column for it and it is **null
 * on all 10 lines in the account**; `IngredientModelState`, the calibration
 * table that would produce an expectation, holds **0 rows**. So there is no
 * expected figure, no short, no over, no shrink — not "zero variance", but no
 * basis on which to state one.
 *
 * What CAN be stated is what was counted and what it is worth: 9 of the 10
 * lines carry a `costPerRecipeUnit` and price out. So the page reports the
 * count, values it, and says plainly why the columns it cannot fill are
 * absent rather than showing them at zero.
 *
 * ## Four sessions, none finished, all the developer's
 *
 * The account holds 4 `StockCount` rows: two `IN_PROGRESS`, two `ABANDONED`,
 * **none ever `COMPLETED`**. All four were created on 8 and 12 May — two
 * sittings four days apart — and every one is `countedByUserId` = the
 * DEVELOPER account, not the owner. One of them is against Glendale, a store
 * that has never opened.
 *
 * Read together that is not a thin dataset, it is a feature that was tried
 * twice in May and never used since. The page says so, because a list of four
 * rows that does not say it invites a reader to think counting is happening.
 */

/** Rows on the phone's list. */
const PHONE_ROWS = 4

export interface CountsHeadline {
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

export interface CountsSessions {
  rows: Row[]
  phoneRows: MListRow[]
  meta: string
  note: string
}

/**
 * `P.counts`' "Variance by session", which is a chart there and a paragraph
 * here — see the file docblock for why there is no series to draw.
 *
 * It was a `.kv` of four absences ("Lines with an expected quantity — 0",
 * "Calibration rows — 0") until the page was measured against its design,
 * which has no `.kv` on it. Four rows that all read zero are a sentence
 * formatted as a table, and the sentence says more: it can name the column and
 * the table the zeros come from. Every figure that was in the list is still
 * here.
 */
export interface CountsVariance {
  /** Owed and named: what the section would show, and why it cannot. */
  lead: string
  /**
   * The same four absences as `rows`, as a sentence.
   *
   * `P.counts` draws a CHART here and `P.countsession` draws a `.kv`, so the
   * two pages that share this section want the same facts in different shapes.
   * The count list renders this line; the session page renders `rows`. Four
   * rows that all read zero are a sentence wearing a table's clothes on a page
   * whose design has no `.kv` at all — and the sentence can name the column
   * and the table the zeros come from, which a two-column list cannot.
   */
  absences: string
  rows: KvRow[]
  note: string
  meta: string
}

/**
 * `P.counts`'s "The count in progress" — the open session, named.
 *
 * The prototype's copy is "Marisol started at 9:04pm and is in the walk-in.
 * Two lines are short so far, worth $61.40". Ours can say who and when and how
 * far, because those are recorded; it cannot say "short so far", because short
 * is a variance and no count in this account has ever been COMPLETED to
 * measure one against.
 */
export interface CountsProgress {
  lead: string
  meta: string
  /** Where "Open the count" goes. Absent when nothing is open. */
  href: string | null
  note: string
}

export interface StockCountsSections {
  headline: SectionData<CountsHeadline>
  sessions: SectionData<CountsSessions>
  variance: SectionData<CountsVariance>
  progress: SectionData<CountsProgress>
}

/**
 * The open session. Two are IN_PROGRESS in this account; the newest is the one
 * a reader means by "the count in progress", and the other is named in the
 * note rather than hidden.
 */
function progressOf(d: Data): CountsProgress {
  // `startedAt` is nullable, and a session with no start cannot be described
  // as "opened at" anything — it is excluded rather than dated from null.
  const open = d.sessions
    .filter((x) => x.status === "IN_PROGRESS" && x.startedAt !== null)
    .sort((a, b) => (b.startedAt as Date).getTime() - (a.startedAt as Date).getTime())
  const it = open[0]

  if (it === undefined) {
    return {
      lead: "No count is open right now.",
      meta: "nothing in progress",
      href: null,
      note:
        `The last session to be opened was ${d.sessions.length === 0 ? "never" : "abandoned"}. ` +
        `Starting one is the only way anything on this page gets a reading.`,
    }
  }

  const startedAt = it.startedAt as Date
  const days = Math.floor((Date.now() - startedAt.getTime()) / 864e5)
  return {
    lead:
      `${it.by} opened this count on ${DT(startedAt)} at ${it.store} and has entered ` +
      `${count(it.lines)} line${it.lines === 1 ? "" : "s"}` +
      (it.value > 0 ? `, worth ${money(it.value)}` : "") +
      `. It has been open ${count(days)} day${days === 1 ? "" : "s"}.`,
    meta: `${count(it.lines)} line${it.lines === 1 ? "" : "s"} so far`,
    href: `/dashboard/operations/inventory/counts/${it.id}`,
    note:
      (open.length > 1
        ? `${count(open.length)} counts are open at once, which is usually one nobody closed. `
        : "") +
      `Nothing here says "short so far": short is a variance, and no count in this ` +
      `account has ever reached COMPLETED for one to be measured against.`,
  }
}

export interface StockCountsInput {
  storeId: string | null
  accountId: string
  range: DateRange
}

/* -- loading ---------------------------------------------------------- */

interface CountedLine {
  id: string
  ingredient: string
  ingredientId: string | null
  qty: number
  unit: string | null
  /** How the operator counted it — nullable, so a line can carry only the
   *  converted figure. */
  nativeQty: number | null
  nativeUnit: string | null
  unitCost: number | null
  value: number | null
  countedAt: Date
}

interface Session {
  id: string
  store: string
  status: string
  by: string
  startedAt: Date | null
  countedAt: Date | null
  completedAt: Date | null
  lines: number
  value: number
  /** Lines that could not be priced, so `value` is a floor. */
  unpriced: number
}

interface Data {
  sessions: Session[]
  /** Every line in the account, for the "what was counted" figures. */
  lines: CountedLine[]
  linesWithEstimate: number
  modelStateRows: number
  rangeLabel: string
}

async function loadCounts(input: StockCountsInput): Promise<Data> {
  const { accountId, storeId, range } = input

  const stores = await prisma.store.findMany({
    where: { accountId, ...(storeId ? { id: storeId } : {}) },
    select: { id: true },
  })
  const storeIds = stores.map((s) => s.id)

  const [counts, modelStateRows] = await Promise.all([
    storeIds.length === 0
      ? Promise.resolve([])
      : prisma.stockCount.findMany({
          where: { storeId: { in: storeIds } },
          select: {
            id: true,
            status: true,
            startedAt: true,
            countedAt: true,
            completedAt: true,
            store: { select: { name: true } },
            countedByUser: { select: { name: true, email: true } },
            lines: {
              select: {
                id: true,
                qtyInRecipeUnit: true,
                nativeQty: true,
                nativeUnit: true,
                estimatedQtyAtCount: true,
                createdAt: true,
                canonicalIngredient: {
                  select: {
                    id: true,
                    name: true,
                    recipeUnit: true,
                    costPerRecipeUnit: true,
                  },
                },
              },
              orderBy: { createdAt: "asc" },
            },
          },
          orderBy: { createdAt: "desc" },
        }),
    prisma.ingredientModelState.count(),
  ])

  const lines: CountedLine[] = []
  const sessions: Session[] = counts.map((c) => {
    let value = 0
    let unpriced = 0
    for (const l of c.lines) {
      const cost = l.canonicalIngredient?.costPerRecipeUnit ?? null
      const lineValue = cost === null ? null : l.qtyInRecipeUnit * cost
      if (lineValue === null) unpriced += 1
      else value += lineValue
      lines.push({
        id: l.id,
        ingredient: l.canonicalIngredient?.name ?? "unknown",
        ingredientId: l.canonicalIngredient?.id ?? null,
        qty: l.qtyInRecipeUnit,
        unit: l.canonicalIngredient?.recipeUnit ?? null,
        nativeQty: l.nativeQty,
        nativeUnit: l.nativeUnit,
        unitCost: cost,
        value: lineValue,
        countedAt: l.createdAt,
      })
    }
    return {
      id: c.id,
      store: c.store?.name ?? "—",
      status: c.status,
      by: c.countedByUser?.name ?? c.countedByUser?.email ?? "—",
      startedAt: c.startedAt,
      countedAt: c.countedAt,
      completedAt: c.completedAt,
      lines: c.lines.length,
      value,
      unpriced,
    }
  })

  return {
    sessions,
    lines,
    linesWithEstimate: counts.reduce(
      (t, c) => t + c.lines.filter((l) => l.estimatedQtyAtCount !== null).length,
      0,
    ),
    modelStateRows,
    rangeLabel: rangeLabel(range, "custom"),
  }
}

/* -- helpers ---------------------------------------------------------- */

const D = (d: Date | null) =>
  d === null
    ? "—"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })

const DT = (d: Date | null) =>
  d === null
    ? "—"
    : d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "UTC",
      })

const STATUS_LABEL: Record<string, string> = {
  IN_PROGRESS: "In progress",
  ABANDONED: "Abandoned",
  COMPLETED: "Closed",
}

/* -- sections --------------------------------------------------------- */

/**
 * The strip. `Median duration` and `Shrink` both go.
 *
 * Duration needs a start and an end, and **no count in this account has a
 * `completedAt`** — all four are in progress or abandoned, so every duration
 * would be open-ended. Shrink needs a variance, which §"variance" explains
 * cannot exist here.
 *
 * What replaces them is the fact those absences share: the sessions were
 * started and left.
 */
function headlineOf(d: Data): CountsHeadline {
  const completed = d.sessions.filter((s) => s.status === "COMPLETED").length
  const open = d.sessions.filter((s) => s.status === "IN_PROGRESS").length
  const counted = d.lines.length
  const value = d.lines.reduce((t, l) => t + (l.value ?? 0), 0)
  const newest = d.sessions[0]?.countedAt ?? null

  const sessionsCell: FigureProps = {
    label: "Sessions",
    value: count(d.sessions.length),
    delta:
      d.sessions.length === 0
        ? "none ever started"
        : completed === 0
          ? "none ever completed"
          : `${count(completed)} closed`,
    deltaTone: completed === 0 && d.sessions.length > 0 ? "is-down" : "is-flat",
  }
  const valueCell: FigureProps = {
    label: "Counted stock",
    value: money(value),
    delta:
      counted === 0
        ? "nothing counted"
        : `${count(counted)} ${counted === 1 ? "line" : "lines"}, all time`,
    deltaTone: counted === 0 ? "is-down" : "is-flat",
  }

  return {
    cells: [
      {
        label: "Last count",
        value: newest === null ? "—" : D(newest),
        delta:
          newest === null
            ? "never"
            : `${count(Math.floor((Date.now() - newest.getTime()) / 86_400_000))} days ago`,
        deltaTone: "is-down",
      },
      sessionsCell,
      {
        label: "Still open",
        value: count(open),
        delta: open === 0 ? "nothing in progress" : "started and left",
        deltaTone: open > 0 ? "is-down" : "is-flat",
      },
      valueCell,
    ],
    phoneCells: [sessionsCell, valueCell],
  }
}

/**
 * The sessions, without the three columns that need a variance.
 *
 * `Short`, `Over` and `$ variance` are the prototype's last three, and all
 * three subtract a counted quantity from an expected one that was never
 * recorded. They are dropped rather than printed as em-dashes on every row —
 * a column of dashes is a column that says "we tried", and this one was never
 * possible.
 *
 * `Duration` goes for the same reason as the strip cell: nothing has a
 * `completedAt` to measure to.
 */
function sessionsOf(d: Data): CountsSessions {
  const byDeveloper = d.sessions.filter((s) => /vardan|demo@/i.test(s.by)).length
  const days = [...new Set(d.sessions.map((s) => D(s.countedAt)))]

  return {
    rows: d.sessions.map((s) => ({
      key: s.id,
      href: `/dashboard/operations/inventory/counts/${s.id}`,
      cells: {
        counted: DT(s.countedAt),
        store: s.store,
        by: s.by,
        lines: s.lines === 0 ? { v: "none", cls: "hot" } : count(s.lines),
        value: s.lines === 0 ? "—" : money(s.value),
        status:
          s.status === "COMPLETED"
            ? STATUS_LABEL[s.status]
            : { v: STATUS_LABEL[s.status] ?? titleCase(s.status.toLowerCase()), cls: "hot" },
      },
    })),
    phoneRows: d.sessions.slice(0, PHONE_ROWS).map((s) => ({
      key: s.id,
      href: `/dashboard/operations/inventory/counts/${s.id}`,
      title: `${D(s.countedAt)} · ${s.store}`,
      detail: `${s.by} · ${s.lines === 0 ? "no lines" : `${count(s.lines)} lines`}`,
      value: s.lines === 0 ? "—" : money(s.value),
      note: STATUS_LABEL[s.status] ?? s.status,
      noteTone: s.status === "COMPLETED" ? "up" : "down",
    })),
    meta:
      d.sessions.length === 0
        ? "no session"
        : `${count(d.sessions.length)} · all time`,
    note:
      d.sessions.length === 0
        ? `No stock count has ever been started on this account.`
        : `No Short, Over or variance column: those subtract a counted quantity from an expected ` +
          `one, and no expected quantity was ever recorded — see below. ` +
          (byDeveloper === d.sessions.length
            ? `Every session here was run from the developer account, on ` +
              `${days.length === 1 ? "one day" : `${count(days.length)} days`} in May. ` +
              `Counting has not been used by the people who run the restaurant. `
            : "") +
          `Value is what the counted lines price out at, and it is a floor where a line has no ` +
          `cost on its ingredient.`,
  }
}

/**
 * Variance — owed, named, and explained rather than drawn.
 *
 * The prototype's second section is a variance-by-session bar chart. Drawing
 * it would mean inventing the series. This states what the section needs, what
 * is actually there, and what would make it appear.
 */
function varianceOf(d: Data): CountsVariance {
  return {
    lead:
      `A variance is a counted quantity minus an expected one. This account records the first ` +
      `and has never recorded the second, so there is no shrink figure, no short and no over — ` +
      `not zero variance, but no basis for stating one.`,
    absences:
      `${count(d.lines.length)} lines have been counted and ` +
      `${count(d.linesWithEstimate)} of them carry an expected quantity. ` +
      `IngredientModelState, the table that would produce one from the recipe walk, holds ` +
      `${count(d.modelStateRows)} rows, and ` +
      `${count(d.sessions.filter((x) => x.status === "COMPLETED").length)} of ` +
      `${count(d.sessions.length)} sessions have ever reached COMPLETED.`,
    rows: [
      { label: "Lines counted", value: count(d.lines.length) },
      {
        label: "Lines with an expected quantity",
        value: count(d.linesWithEstimate),
        ...(d.linesWithEstimate === 0 ? { tone: "bad" as const } : {}),
      },
      {
        label: "Calibration rows",
        value: count(d.modelStateRows),
        ...(d.modelStateRows === 0 ? { tone: "bad" as const } : {}),
      },
      {
        label: "Sessions ever completed",
        value: count(d.sessions.filter((x) => x.status === "COMPLETED").length),
        ...(d.sessions.every((x) => x.status !== "COMPLETED") && d.sessions.length > 0
          ? { tone: "bad" as const }
          : {}),
      },
    ],
    meta: "what it would need",
    note:
      `StockCountLine.estimatedQtyAtCount is the column an expectation goes in, and ` +
      `IngredientModelState is the table that would produce one from the recipe walk. ` +
      `Both are empty. A count that closes with an expectation attached is what turns this ` +
      `section from a list of absences into a number — and into the chart the design draws ` +
      `here.`,
  }
}

/* -- assembly --------------------------------------------------------- */

export function getStockCountsSectionPromises(
  input: StockCountsInput,
): StreamedSections<StockCountsSections> {
  const dataP = classify(() => loadCounts(input), {
    retryAction: "retryStockCounts",
    isEmpty: () => false,
    emptyReason: "no_match",
  })

  const s = <T,>(f: (d: Data) => T) =>
    guardSection(dataP.then((sd) => mapReady(sd, f)), "retryStockCounts")

  return {
    headline: s(headlineOf),
    sessions: s(sessionsOf),
    variance: s(varianceOf),
    progress: s(progressOf),
  }
}

export async function getStockCountsSections(
  input: StockCountsInput,
): Promise<StockCountsSections> {
  return awaitSections(getStockCountsSectionPromises(input))
}

/* ── One session ──────────────────────────────────────────────────────── */

/** How long a session ran, or has been running — `P.countsession`'s fifth cell. */
function durationCell(session: Session): FigureProps {
  const start = session.startedAt
  if (start === null) {
    return { label: "Duration", value: "—", delta: "no start recorded", deltaTone: "is-down" }
  }
  const end = session.completedAt
  const mins = Math.round(((end ?? new Date()).getTime() - start.getTime()) / 60000)
  if (end !== null) {
    return {
      label: "Duration",
      value: mins < 60 ? `${count(mins)} min` : `${(mins / 60).toFixed(1)} h`,
      delta: `closed ${D(end)}`,
      deltaTone: "is-flat",
    }
  }
  const days = Math.floor(mins / 1440)
  return {
    label: "Open for",
    value: days === 0 ? `${count(mins)} min` : `${count(days)} days`,
    delta: `since ${D(start)}, still running`,
    deltaTone: "is-down",
  }
}

/** See `CountSessionWork`. */
function sessionWorkOf(session: Session, lines: CountedLine[]): CountSessionWork {
  const items: QueueItem[] = []
  const start = session.startedAt
  const days =
    start === null ? 0 : Math.floor((Date.now() - start.getTime()) / 86_400_000)

  if (session.completedAt === null && session.status === "IN_PROGRESS") {
    items.push({
      key: "open",
      tone: "bad",
      lead: count(days),
      unit: days === 1 ? "day" : "days",
      title: "This count was never closed",
      body:
        `Opened ${start === null ? "at an unrecorded time" : `on ${D(start)}`} and still ` +
        `IN_PROGRESS, with ${count(lines.length)} ` +
        `${lines.length === 1 ? "line" : "lines"} entered. A count only becomes a reading ` +
        `when it closes: until then there is no completed session for the next one to be ` +
        `measured against, which is why no variance exists anywhere in this account.`,
      act: "See every count",
      href: "/dashboard/operations/inventory/counts",
    })
  } else if (session.status === "ABANDONED") {
    items.push({
      key: "abandoned",
      tone: "warn",
      lead: count(lines.length),
      unit: lines.length === 1 ? "line" : "lines",
      title: "This count was abandoned",
      body:
        `It was opened ${start === null ? "at an unrecorded time" : `on ${D(start)}`} and ` +
        `${lines.length === 0 ? "nothing was ever entered in it" : "abandoned with lines in it"}. ` +
        `An abandoned count teaches the model nothing and is not a baseline for the next one.`,
      act: "See every count",
      href: "/dashboard/operations/inventory/counts",
    })
  }

  return { items, meta: `${count(items.length)} open` }
}


export interface CountSessionHead {
  title: string
  sub: string
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

export interface CountSessionLines {
  rows: Row[]
  phoneRows: MListRow[]
  meta: string
  note: string
}

/**
 * `P.countsession`'s "What to do" — one open thing, and only one.
 *
 * The prototype's item is a PATTERN across counts ("beef has been short three
 * counts running"), which needs a variance this account cannot compute. What
 * it can say about a session is whether the session itself needs something,
 * and for this one it does: it was opened on 12 May and never closed.
 *
 * The unpriced line is deliberately NOT a second item. It is a caveat on a
 * figure, and it is already said under the figure — the lines note reads "1
 * line has no cost on the ingredient, so the total is a floor". A worklist
 * that repeats a note from two sections above it is noise, not a second job.
 */
export interface CountSessionWork {
  items: QueueItem[]
  meta: string
}

export interface CountSessionSections {
  head: SectionData<CountSessionHead>
  lines: SectionData<CountSessionLines>
  variance: SectionData<CountsVariance>
  work: SectionData<CountSessionWork>
}

export interface CountSessionInput {
  countId: string
  accountId: string
}

async function loadSession(
  input: CountSessionInput,
): Promise<{ session: Session; lines: CountedLine[]; data: Data } | null> {
  const { countId, accountId } = input
  const all = await loadCounts({ accountId, storeId: null, range: { start: new Date(), end: new Date() } })
  const session = all.sessions.find((s) => s.id === countId)
  if (!session) return null
  // `loadCounts` flattens every line in the account; re-narrow to this one by
  // the ids the session actually holds.
  const ids = new Set(
    (
      await prisma.stockCountLine.findMany({
        where: { stockCountId: countId },
        select: { id: true },
      })
    ).map((l) => l.id),
  )
  return { session, lines: all.lines.filter((l) => ids.has(l.id)), data: all }
}

export async function getCountSessionName(
  countId: string,
  accountId: string,
): Promise<{ name: string } | null> {
  const row = await prisma.stockCount.findFirst({
    where: { id: countId, store: { accountId } },
    select: { countedAt: true, store: { select: { name: true } } },
  })
  return row ? { name: `${D(row.countedAt)} · ${row.store?.name ?? "count"}` } : null
}

export function getCountSessionSectionPromises(
  input: CountSessionInput,
): StreamedSections<CountSessionSections> {
  const dataP = classify(() => loadSession(input), {
    retryAction: "retryCountSession",
    isEmpty: (d) => d === null,
    emptyReason: "no_match",
  })

  const s = <T,>(f: (d: NonNullable<Awaited<ReturnType<typeof loadSession>>>) => T) =>
    guardSection(
      dataP.then((sd) => mapReady(sd, (d) => f(d as NonNullable<typeof d>))),
      "retryCountSession",
    )

  return {
    head: s(({ session, lines }) => {
      const value = lines.reduce((t, l) => t + (l.value ?? 0), 0)
      const valueCell: FigureProps = {
        label: "Counted stock",
        value: money(value),
        delta:
          session.unpriced > 0
            ? `at least — ${count(session.unpriced)} unpriced`
            : `${count(lines.length)} ${lines.length === 1 ? "line" : "lines"}`,
        deltaTone: session.unpriced > 0 ? "is-down" : "is-flat",
      }
      const statusCell: FigureProps = {
        label: "Status",
        value: STATUS_LABEL[session.status] ?? titleCase(session.status.toLowerCase()),
        delta: session.completedAt === null ? "never closed" : `closed ${D(session.completedAt)}`,
        deltaTone: session.completedAt === null ? "is-down" : "is-flat",
      }
      return {
        title: `${D(session.countedAt)} count`,
        sub: `${session.store} · started by ${session.by} · ${DT(session.startedAt)}`,
        cells: [
          { label: "Lines", value: count(lines.length), delta: lines.length === 0 ? "nothing counted" : "counted", deltaTone: lines.length === 0 ? "is-down" : "is-flat" },
          valueCell,
          statusCell,
          {
            label: "Variance",
            value: "—",
            delta: "no expected quantity recorded",
            deltaTone: "is-down",
          },
          // `P.countsession`'s fifth cell is "Duration · 18 min · ▼ 4 min",
          // which a closed count has and an open one does not. This session
          // has no end, so the honest fifth figure is how long it has been
          // going — the same clock, still running.
          durationCell(session),
        ],
        phoneCells: [valueCell, statusCell],
      }
    }),
    lines: s(({ session, lines }) => ({
      // `Row` is a discriminated union — a link row, a press row, or neither —
      // so each branch is built whole. A spread of `href` produces a shape
      // that matches none of the three, and a line whose ingredient was
      // deleted genuinely has nowhere to link.
      rows: lines.map((l): Row => {
        const cells = {
          ingredient: titleCase(l.ingredient),
          native:
            l.nativeQty === null
              ? "—"
              : `${l.nativeQty.toFixed(2)} ${(l.nativeUnit ?? "").toLowerCase()}`.trim(),
          qty: `${l.qty.toLocaleString("en-US")} ${(l.unit ?? "").toLowerCase()}`.trim(),
          cost: l.unitCost === null ? { v: "no cost", cls: "hot" } : unitCost(l.unitCost),
          value: l.value === null ? { v: "—", cls: "hot" } : money(l.value, { cents: true }),
        }
        return l.ingredientId
          ? { key: l.id, href: `/dashboard/ingredients/${l.ingredientId}`, cells }
          : { key: l.id, cells }
      }),
      phoneRows: lines.slice(0, 8).map((l) => ({
        key: l.id,
        title: titleCase(l.ingredient),
        detail:
          l.nativeQty === null
            ? `${l.qty.toLocaleString("en-US")} ${(l.unit ?? "").toLowerCase()}`.trim()
            : `${l.nativeQty.toFixed(2)} ${(l.nativeUnit ?? "").toLowerCase()}`.trim(),
        value: l.value === null ? "—" : money(l.value, { cents: true }),
      })),
      meta:
        lines.length === 0
          ? "no line"
          : `${count(lines.length)} ${lines.length === 1 ? "line" : "lines"}`,
      note:
        lines.length === 0
          ? `This session was opened and nothing was counted in it.`
          : `Counted in the unit the shelf uses and converted to the ingredient's recipe unit, ` +
            `which is what prices it. ` +
            (session.unpriced > 0
              ? `${count(session.unpriced)} ${session.unpriced === 1 ? "line has" : "lines have"} ` +
                `no cost on the ingredient, so the total is a floor.`
              : `Every line priced.`),
    })),
    variance: s(({ data }) => varianceOf(data)),
    work: s(({ session, lines }) => sessionWorkOf(session, lines)),
  }
}

export async function getCountSessionSections(
  input: CountSessionInput,
): Promise<CountSessionSections> {
  return awaitSections(getCountSessionSectionPromises(input))
}
