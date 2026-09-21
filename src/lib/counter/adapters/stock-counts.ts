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
import {
  loadStoreInventoryContext,
  runningOnHandFromContext,
  type ContextIngredient,
} from "@/lib/inventory/store-inventory-context"
import type { FigureProps, KvRow, MListRow, QueueItem, Row } from "@/components/counter"

/**
 * Stock counts — `P.counts` and `P.countsession`
 * (`docs/counter/counter-prototype.html`).
 *
 * "Every count session, who did it, and what it found."
 *
 * ## Variance, and what an expectation is actually anchored to
 *
 * `P.counts` is built on variance: its strip ends in `Shrink · 1.2% · ▲ 0.3
 * pts`, its table carries `Short`, `Over` and `$ variance`, and its second
 * section is a variance-by-session chart.
 *
 * A variance needs an EXPECTED quantity to subtract the counted one from.
 * `StockCountLine.estimatedQtyAtCount` is the column for it, and until
 * 2026-09-20 it was null on every line in the account because `loadCountEntry`
 * hard-coded `estimate: null` on every row it handed the entry form — the
 * expectation was never computed, so it was never carried down with the save,
 * so `applyCalibrationUpdatesForCount` early-returned on close and
 * `IngredientModelState` stayed at 0 rows. A closed loop with four links and
 * no way in.
 *
 * It is open now, and the thing that opens it is worth naming precisely,
 * because it is NOT `IngredientModelState`. An expectation here is
 * `runningOnHandFromContext` — the most recent **CLOSED** count for a (store,
 * ingredient), plus deliveries since, minus the recipe-walk depletion of what
 * was sold since, minus adjustments. No calibration row is needed to produce
 * it; `calibrationFactor` only refines it later. What IS needed is the anchor:
 * a count that has reached COMPLETED. With none, `baseAt` is null, the walk
 * silently re-bases on the epoch and "expected on hand" degenerates into
 * "every delivery ever recorded minus every sale ever modelled" — a number
 * that is not an expectation and would poison the first calibration sample it
 * touched. So an estimate is recorded **only where `baseAt` is non-null**, and
 * the copy on the page says so rather than implying that finishing a count is
 * the missing step.
 *
 * On this account that still means zero expectations today: nothing has ever
 * closed. The first count to close becomes the baseline; the next one taken
 * against it carries an expectation per ingredient, and this page stops being
 * a list of absences.
 *
 * What CAN always be stated is what was counted and what it is worth: 9 of the
 * 10 lines carry a `costPerRecipeUnit` and price out.
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
  /**
   * What the model expected on the shelf when the line was saved, in the same
   * recipe unit as `qty`. Null where the ingredient had no CLOSED count behind
   * it to expect from — see the file docblock.
   */
  estimate: number | null
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
  /** Every line in SCOPE, for the "what was counted" figures — see `scope`. */
  lines: CountedLine[]
  linesWithEstimate: number
  modelStateRows: number
  rangeLabel: string
  /**
   * What "here" means in this page's copy: "this store" when the switcher has
   * one picked, "this account" otherwise.
   *
   * Every figure on this page is scoped by `loadCounts`'s store filter, and
   * the sentences that explain a missing variance are factual claims an owner
   * would act on. Saying "no count on this account has ever closed" while
   * Hollywood is picked and Culver City closed three last month is not a
   * loose phrasing — it is a false statement about the other store, in the
   * one sentence whose job is to say why there is nothing to show.
   */
  scope: "this store" | "this account"
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
    prisma.ingredientModelState.count({ where: { storeId: { in: storeIds } } }),
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
        estimate:
          l.estimatedQtyAtCount !== null && Number.isFinite(l.estimatedQtyAtCount)
            ? l.estimatedQtyAtCount
            : null,
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
    // Same test `CountedLine.estimate` applies below, so the Variance
    // section's count and the session strip's cell cannot give two answers to
    // one question. `double precision` accepts 'NaN', and a row holding one is
    // not a line carrying an expected quantity.
    linesWithEstimate: counts.reduce(
      (t, c) =>
        t +
        c.lines.filter(
          (l) => l.estimatedQtyAtCount !== null && Number.isFinite(l.estimatedQtyAtCount),
        ).length,
      0,
    ),
    modelStateRows,
    rangeLabel: rangeLabel(range, "custom"),
    scope: storeId === null ? "this account" : "this store",
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
        ? `No stock count has ever been started on ${d.scope}.`
        : `No Short, Over or variance column: those subtract a counted quantity from an expected ` +
          `one, and ` +
          (d.linesWithEstimate === 0
            ? `no line has an expected quantity on it yet`
            : `only ${count(d.linesWithEstimate)} of ${count(d.lines.length)} lines have one`) +
          ` — see below. ` +
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
 * Variance — stated when there is one, and precisely accounted for when not.
 *
 * The prototype's second section is a variance-by-session bar chart. Drawing
 * it would mean inventing the series while no line carries an expectation.
 *
 * ## The copy here has to be true about WHICH step is missing
 *
 * It used to read as though finishing a count were the missing step ("A count
 * that closes with an expectation attached is what turns this section into a
 * number"), which put the reader one button away from a variance. It is not
 * one button away, and it never was. An expectation is measured from the last
 * CLOSED count on that store — deliveries since, minus what the recipes say
 * the sales consumed, minus adjustments. Closing THIS count records no
 * expectation for it; it creates the baseline the NEXT count is measured
 * against. Two counts, not one, and the page now says that.
 */
function varianceOf(d: Data): CountsVariance {
  const completed = d.sessions.filter((x) => x.status === "COMPLETED").length
  const has = d.linesWithEstimate > 0
  return {
    lead: has
      ? `A variance is a counted quantity minus an expected one. ` +
        `${count(d.linesWithEstimate)} of ${count(d.lines.length)} counted lines carry an ` +
        `expected quantity, recorded when the line was saved and anchored to the moment its ` +
        `session was opened: the last closed count on that store, plus deliveries since, minus ` +
        `what the recipes say the sales consumed, minus adjustments.`
      : `A variance is a counted quantity minus an expected one. No line here carries the ` +
        `second yet, and the reason is not that a count was left unfinished. An expected ` +
        `quantity is measured FROM the last closed count on the store, and ` +
        `${completed === 0 ? `no count on ${d.scope} has ever closed` : "no closed count precedes these"} ` +
        `— so there is nothing to measure from. Closing a count does not give that count an ` +
        `expectation; it becomes the baseline the next one is measured against.`,
    absences:
      `${count(d.lines.length)} lines have been counted and ` +
      `${count(d.linesWithEstimate)} of them carry an expected quantity. ` +
      `${count(completed)} of ${count(d.sessions.length)} sessions on ${d.scope} have reached ` +
      `COMPLETED, ` +
      `which is what an expectation is measured from, and IngredientModelState — the table that ` +
      `refines the expectation once closed counts start scoring it — holds ` +
      `${count(d.modelStateRows)} rows.`,
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
        value: count(completed),
        ...(completed === 0 && d.sessions.length > 0 ? { tone: "bad" as const } : {}),
      },
    ],
    meta: has ? "expected against counted" : "what it would need",
    note: has
      ? `StockCountLine.estimatedQtyAtCount is the column the expectation is written to, on the ` +
        `save. It is only written where that ingredient has a closed count behind it to be ` +
        `measured from; an ingredient counted here for the first time still has none, which is ` +
        `why the two figures above differ.`
      : `StockCountLine.estimatedQtyAtCount is the column an expectation is written to, on the ` +
        `save. It is left empty on purpose while a store has no closed count: with no anchor the ` +
        `walk would re-base on the epoch and return every delivery ever recorded minus every ` +
        `sale ever modelled, which is not an expectation and would be worse than an empty ` +
        `column. Close a count and the next one taken against it fills this in.`,
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

/**
 * `P.countsession`'s "Variance" cell.
 *
 * `value` is Σ (expected − counted) × unit cost over the lines that have BOTH
 * an expectation and a cost. `delta` has to say how many lines that is,
 * because "$0.00" over two of forty lines and over forty of forty are
 * different claims — a line carrying an expectation with no cost on the
 * ingredient contributes exactly nothing to the money while still being a
 * real gap on the shelf.
 *
 * ## It is NOT a floor, and this cell must not borrow that word
 *
 * The counted-stock cell beside it says "at least — N unpriced" and is right
 * to: every line it omits would have added `qty × cost`, which cannot be
 * negative, so the total it shows is a genuine lower bound. **Variance is
 * signed.** An omitted line can be short (positive) or over (negative), so
 * leaving it out bounds the figure in neither direction and can flip it: three
 * priced lines netting +$40 beside two unpriced ones that would have come to
 * −$900 make "at least $40.00" a false statement about a −$860 gap. So the
 * delta names the unpriced lines as an unknown rather than as a margin, and
 * the tone stays cautious while any remain — not because the money says so,
 * but because the money is not yet the answer.
 */
function varianceCell(lines: CountedLine[]): FigureProps {
  const withEstimate = lines.filter((l) => l.estimate !== null)
  if (withEstimate.length === 0) {
    return {
      label: "Variance",
      value: "—",
      delta: "no closed count to expect from",
      deltaTone: "is-down",
    }
  }
  const priced = withEstimate.filter((l) => l.unitCost !== null)
  if (priced.length === 0) {
    return {
      label: "Variance",
      value: "—",
      delta: `${count(withEstimate.length)} expected, none priced`,
      deltaTone: "is-down",
    }
  }
  const unpriced = withEstimate.length - priced.length
  const gap = priced.reduce((t, l) => t + ((l.estimate as number) - l.qty) * (l.unitCost ?? 0), 0)
  return {
    label: "Variance",
    value: money(gap),
    delta:
      unpriced > 0
        ? `${count(priced.length)} of ${count(lines.length)} ` +
          `${lines.length === 1 ? "line" : "lines"} expected and priced · ` +
          `${count(unpriced)} unpriced, either way`
        : `${count(priced.length)} of ${count(lines.length)} ` +
          `${lines.length === 1 ? "line" : "lines"} expected`,
    deltaTone: gap > 0 || unpriced > 0 ? "is-down" : "is-flat",
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
        `when it closes, and closing it is what gives the NEXT count something to expect ` +
        `from — this one is measured against whatever closed before it, which is nothing.`,
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

/**
 * THE COUNT ITSELF — the section that turns this page from a receipt into a
 * clipboard.
 *
 * `beginStockCount` has been wired since the Counter inventory pages were
 * built and it sends the owner here, to a page that had no input on it. You
 * could START a count and then not count anything. That is worse than a
 * missing feature, because it looks like a working one, and this account's
 * three attempts — all in May, the fullest of them ten lines of soda syrup —
 * are what a flow that dead-ends leaves behind. `StockCount.status` has never
 * once been COMPLETED here, and the inventory model calibrates on COMPLETED
 * counts, so every count ever taken on this account has been invisible to the
 * thing it exists to feed.
 *
 * `estimate` is what the model expected on the shelf at `StockCount.startedAt`
 * — one as-of moment for every line on the session, whichever order they were
 * typed in. It travels down with the save into
 * `StockCountLine.estimatedQtyAtCount`, which is the training target the
 * calibration is later scored against, and it is deliberately taken BEFORE
 * any counting rather than recomputed per box: scoring the model against a
 * number it produced after seeing the answer would not be scoring it at all.
 *
 * It is null for an ingredient with no closed count behind it to be expected
 * from — see `loadCountEntry` for why that null is the honest value and not a
 * missing feature.
 */
export interface CountSessionEntryRow {
  ingredientId: string
  name: string
  category: string
  /** The unit the number is in. "each" when the ingredient has no recipe unit. */
  unit: string
  estimate: number | null
  /** What is already recorded for this ingredient on this count. */
  entered: number | null
}

export interface CountSessionEntry {
  countId: string
  /** Only an IN_PROGRESS count takes entries. */
  open: boolean
  rows: CountSessionEntryRow[]
  meta: string
  note: string
}

export interface CountSessionSections {
  head: SectionData<CountSessionHead>
  lines: SectionData<CountSessionLines>
  variance: SectionData<CountsVariance>
  work: SectionData<CountSessionWork>
  entry: SectionData<CountSessionEntry>
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
          // The prototype's fourth cell. It stays an em-dash while no line on
          // the session carries an expectation — and it is filled the moment
          // one does, in money, because the lines are in different units and
          // only the priced-out gap adds up across them. Positive = short:
          // less on the shelf than the last closed count plus deliveries minus
          // modelled usage says there should be.
          varianceCell(lines),
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
    /*
     * NOT built off `loadSession` — it needs the whole catalogue, not the
     * lines this count already has, and the frozen model estimate per
     * ingredient that `getCountEntryData` is the only thing that assembles.
     * Its own `guardSection` for the same reason: a catalogue that fails to
     * load should cost the page its entry form, not its receipt.
     */
    entry: guardSection(
      classify(() => loadCountEntry(input.countId, input.accountId), {
        retryAction: "retryCountSession",
        isEmpty: (e) => e === null,
        emptyReason: "no_match",
      }).then((sd) => mapReady(sd, (e) => e as CountSessionEntry)),
      "retryCountSession",
    ),
  }
}

/**
 * The catalogue and what has been entered against it so far.
 *
 * ## WHY THIS DOES NOT CALL `getCountEntryData`
 *
 * It did, for one draft, because that action assembles exactly this shape and
 * the editorial count form used it. **The page then took over three minutes
 * to load.** Measured against the running production build, twice:
 * `180.0s`, `180.0s` — both hitting curl's timeout rather than finishing.
 *
 * The cost is one line of it. `getCountEntryData` calls
 * `computeRunningOnHand` for EVERY canonical ingredient on the account — 76
 * here — inside a `Promise.all` that fires all 76 at a connection pool sized
 * for a handful, and each of those calls re-issues the SAME store-wide sales,
 * mapping and recipe queries the other 75 just issued, then walks the recipe
 * tree with a `findUnique` per node.
 *
 * ## WHY THE ESTIMATE IS BACK ANYWAY
 *
 * That measurement rules out the per-ingredient reader. It does not rule out
 * the expectation, because the per-ingredient reader is not the only way to
 * compute one. `loadStoreInventoryContext` +`runningOnHandFromContext` are the
 * batched twins of exactly that maths — **six queries for the whole store, no
 * matter how many ingredients**, sharing the pure helpers in `usage-math.ts`
 * so the two paths cannot drift. The inventory dashboard already runs on them;
 * they were written for this same 76-ingredient loop. So the choice was never
 * "a usable clipboard with no estimate, or neither": it is one store-wide
 * prefetch.
 *
 * Three properties of doing it HERE, on the read, rather than on the save:
 *
 *  1. **The save path does not move.** A count is typed in a walk-in on a
 *     phone with one bar. Every box saves on blur, and a failed write shows a
 *     small grey "not saved — try again". Putting a recipe walk in front of
 *     that write would trade a missing column for lost lines, which is the
 *     worse defect. The number is already in the browser when the box is
 *     blurred; the save carries it and costs nothing extra.
 *  2. **One as-of moment for the whole session.** The context is anchored to
 *     `StockCount.startedAt`, so the thirtieth line typed at 9:40pm is scored
 *     against the same shelf state as the first at 9:04pm. It is the last
 *     instant before anyone started counting, which is the only honest moment
 *     to take a prediction from.
 *  3. **It is skipped entirely when it cannot mean anything.** See below.
 *
 * ## THE NO-ANCHOR CASE, WHICH IS THIS ACCOUNT'S CASE
 *
 * `runningOnHandFromContext` returns `baseAt: null` for an ingredient with no
 * COMPLETED count behind it, and then `onHand` is NOT an expectation. With no
 * anchor the walk re-bases on `new Date(0)`: `baseQty` is 0, and the figure
 * becomes every delivery ever recorded minus every sale the recipes could
 * model, over the entire history of the account, with no opening inventory.
 * That number is large, arbitrary, and would land in
 * `IngredientModelState.calibrationFactor` as the model's first ever sample.
 *
 * So the estimate is recorded **only where `baseAt` is non-null**, per
 * ingredient, and a store with no closed count at all skips the prefetch on a
 * single indexed probe. No count on this account has ever closed, so today
 * that means the note below says plainly that no expectation is recorded and
 * why — not "finish the count and you will get one". The first count to close
 * becomes the anchor; the next one carries expectations.
 */
async function loadCountEntry(
  countId: string,
  accountId: string,
): Promise<CountSessionEntry | null> {
  // The boundary is the caller's account, never the fetched row's: deriving
  // accountId from the record makes any countId "valid". Everything below
  // this point is scoped by the `accountId` argument or by a storeId that
  // came back through this filter.
  const countRow = await prisma.stockCount.findFirst({
    where: { id: countId, store: { accountId } },
    select: { id: true, status: true, storeId: true, startedAt: true },
  })
  if (!countRow) return null

  // Both are NOT NULL in the schema (`StockCount.storeId String`,
  // `startedAt DateTime @default(now())`), so there is no absent-start case to
  // branch on here. `Session.startedAt` further down IS nullable, which is a
  // different shape and a different query; don't copy its guard back into this
  // one and reintroduce a branch that can never be taken.
  const { storeId, startedAt } = countRow

  const [ingredients, lines, anchor] = await Promise.all([
    prisma.canonicalIngredient.findMany({
      where: { accountId },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        category: true,
        recipeUnit: true,
        // The pack is the CS -> recipe-unit factor. Omitting it drops every
        // case-priced delivery from the expectation and the figure goes
        // negative — see `convertDelivered` in `usage-math.ts`.
        caseUnit: true,
        recipeUnitsPerCase: true,
        innerPackUnit: true,
        innerPacksPerCase: true,
      },
    }),
    prisma.stockCountLine.findMany({
      where: { stockCountId: countId },
      select: { canonicalIngredientId: true, qtyInRecipeUnit: true },
    }),
    // One probe, served by `@@index([storeId, status])`. If the store has
    // never closed a count, no ingredient can have an anchor, every
    // expectation would be the epoch-based nonsense the docblock describes,
    // and the six-query prefetch below is skipped entirely.
    prisma.stockCount.findFirst({
      where: {
        storeId,
        status: "COMPLETED",
        countedAt: { lte: startedAt },
        store: { accountId },
      },
      select: { id: true },
    }),
  ])

  const estimateById =
    anchor === null
      ? new Map<string, number>()
      : await loadEntryEstimates({ storeId, accountId, asOf: startedAt, ingredients })

  const enteredById = new Map(lines.map((l) => [l.canonicalIngredientId, l.qtyInRecipeUnit]))

  const rows: CountSessionEntryRow[] = ingredients.map((i) => ({
    ingredientId: i.id,
    name: titleCase(i.name),
    category: i.category ?? "Uncategorized",
    // The unit the number is IN. An ingredient with no recipe unit is counted
    // in whatever "each" means for it, which the box says rather than leaving
    // the reader to guess.
    unit: i.recipeUnit ?? "each",
    estimate: estimateById.get(i.id) ?? null,
    entered: enteredById.get(i.id) ?? null,
  }))

  const done = rows.filter((r) => r.entered !== null).length
  const expected = rows.filter((r) => r.estimate !== null).length
  const open = countRow.status === "IN_PROGRESS"
  const saving =
    `Enter what is on the shelf, in the unit the shelf uses. Each box saves when you ` +
    `leave it, and re-entering a number corrects it rather than adding to it. `
  return {
    countId,
    open,
    rows,
    meta: `${count(done)} of ${count(rows.length)}`,
    note: !open
      ? `This count is closed, so its lines can no longer be edited.`
      : expected > 0
        ? saving +
          // "carries", not "records": the expectation is attached to a line AS
          // IT SAVES, so a row nobody has typed into yet has nothing stored
          // against it. Saying "N of M record" would also be wrong for a line
          // saved in an earlier session render, before this store had a closed
          // count — `useCountEntry` skips a write when the number is unchanged,
          // so that line keeps its null until someone corrects the figure.
          `${count(expected)} of ${count(rows.length)} ingredients also carry what was ` +
          `expected on the shelf when this session opened on ${DT(startedAt)}, and each one ` +
          `is attached to its line as that line saves: the last closed count on this store, ` +
          `plus deliveries since, minus what the recipes say the sales consumed. The rest ` +
          `have no closed count behind them to be expected from, or their deliveries do not ` +
          `all convert to the unit on the shelf, so nothing is attached rather than a guess.`
        : // There are TWO ways to arrive at nothing, and they call for
          // different sentences. No anchor means no closed count to measure
          // from, and closing this one is the fix. An anchor with nothing
          // computable means the walk ran and every ingredient was
          // disqualified — usually because its deliveries do not convert to
          // the unit on the shelf — and closing another count fixes none of
          // that. Telling the second reader "there is none" would be a false
          // statement about their own data in the one sentence explaining why
          // the column is empty.
          anchor === null
          ? saving +
            `Nothing here records an expected quantity, and finishing this count will not ` +
            `change that: an expectation is measured FROM the last closed count on this ` +
            `store, and there is none. Closing this one is what creates that baseline — the ` +
            `next count taken against it carries an expected quantity, and a variance.`
          : saving +
            `Nothing here carries an expected quantity, and it is not for want of a closed ` +
            `count — this store has one. Every ingredient was disqualified: either its ` +
            `deliveries do not all convert to the unit on the shelf, so the figure would be ` +
            `an undercount of unknown size, or it was not on the last closed count and has ` +
            `nothing of its own to be measured from. Setting case sizes on the ingredients ` +
            `you buy by the case is what fills this in.`,
  }
}

/**
 * Every expectation for the session, in six store-wide queries.
 *
 * Wrapped whole in a `try`: an expectation is a column this form can do
 * without, and a catalogue that loads is worth more than one that 500s because
 * a sales query hiccupped. A failure degrades to "no expectation recorded",
 * which the note above already has honest copy for.
 *
 * ## Three ways a walk comes back unusable, and all three are skipped
 *
 * An expectation written here is not just drawn — it is saved onto the line
 * and then read back by `applyCalibrationUpdatesForCount` as a TRAINING
 * SAMPLE. A wrong one is therefore worse than none twice over, and worse
 * again because `saveStockCountLine` now writes the column once: nothing in
 * the app can clear a bad value afterwards.
 *
 *  1. **No anchor** (`baseAt === null`). No closed count behind this
 *     ingredient, so the walk re-bases on the epoch and `onHand` is every
 *     delivery ever recorded minus every sale ever modelled. Not an
 *     expectation.
 *  2. **Partial** (`partial === true`). `sumDeliveries` in
 *     `@/lib/inventory/usage-math` sets this and SILENTLY DROPS the line
 *     whenever a delivery's unit will not convert to the recipe unit — which
 *     is why `convertDelivered`'s docblock there records 31 of 76 ingredients
 *     holding a negative on-hand, Coke Mexican Glass at −1,694,000 ml. Adding
 *     the pack columns to this adapter's `select` fixes the ingredients whose
 *     pack row is POPULATED; that same docblock measures the coverage at 61
 *     of 76 for `recipeUnitsPerCase` and 59 for `caseUnit`, so the rest still
 *     come back partial and still come back understated. A partial walk is an
 *     under-count with no way to say by how much.
 *  3. **Negative.** A shelf cannot hold less than nothing, so a negative
 *     `onHand` is arithmetic, not a prediction. `run-out.ts` skips on the same
 *     grounds (`if (onHand <= 0) continue`) — the difference here is that zero
 *     IS a legitimate expectation: "we think you are out" is a real thing to
 *     check against a shelf, and the counter finding one left is exactly the
 *     variance this feature exists to catch.
 */
async function loadEntryEstimates(input: {
  storeId: string
  accountId: string
  asOf: Date
  ingredients: ContextIngredient[]
}): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  try {
    const ctx = await loadStoreInventoryContext({
      storeId: input.storeId,
      accountId: input.accountId,
      asOf: input.asOf,
    })
    for (const ingredient of input.ingredients) {
      const walk = runningOnHandFromContext(ctx, ingredient)
      // The three skips are argued in the docblock above. Each one leaves the
      // ingredient at `null`, which the copy already accounts for, rather than
      // recording a number the calibration would then be scored against.
      if (walk.baseAt === null) continue
      if (walk.partial) continue
      if (!Number.isFinite(walk.onHand)) continue
      if (walk.onHand < 0) continue
      out.set(ingredient.id, walk.onHand)
    }
  } catch {
    return new Map()
  }
  return out
}

export async function getCountSessionSections(
  input: CountSessionInput,
): Promise<CountSessionSections> {
  return awaitSections(getCountSessionSectionPromises(input))
}
