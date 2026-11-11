import { z } from "zod"
import { dateRangeSchema, parseDateRange, resolveStoreIds, ymd } from "./_shared"
import type { ChatTool } from "./types"
import { loadCheckGrid } from "@/lib/checks/data"
import { onTimeRate, type CellStatus } from "@/lib/checks/status"
import { CHECK_LABEL, todayLA } from "@/lib/checks/time"

/**
 * The store cleaning checks (morning, Transition, evening): which were on
 * time, late or missed, who submitted them, and which items the crew flagged
 * as needing attention.
 *
 * Read through `loadCheckGrid`, the loader behind Checks → Today, History and
 * the missed-check alerts, so a check the chat calls missed is the one the
 * History grid shows as missed. Photos and PINs are never returned.
 */

const params = z
  .object({
    storeIds: z
      .array(z.string().min(1))
      .optional()
      .describe("Restrict to these store ids from listStores. Omit for every store."),
    dateRange: dateRangeSchema.describe(
      "Inclusive YYYY-MM-DD business days, up to 31. A check that runs past midnight counts for the day it started.",
    ),
  })
  .strict()

type Counted = "on_time" | "late" | "partial" | "missed" | "open" | "closed"
const COUNTED: readonly Counted[] = ["on_time", "late", "partial", "missed", "open", "closed"]

export type CleaningChecksResult = {
  from: string
  to: string
  stores: Array<{
    storeId: string
    storeName: string
    /** Share of due checks done by the due time, 0..100. Null when none were due. */
    onTimePct: number | null
    counts: Record<Counted, number>
    /**
     * Late, partly done and missed checks, newest first. "partial" closed
     * itself when its window ended with some tasks done; `missedTasks` names
     * the ones nobody ticked.
     */
    problems: Array<{
      date: string
      check: string
      status: "late" | "partial" | "missed"
      lateMinutes: number | null
      submittedBy: string | null
      tasksDone: number | null
      tasksTotal: number | null
      missedTasks: string[]
    }>
    /** Items the crew marked as needing attention, newest first. */
    flagged: Array<{ date: string; check: string; section: string; item: string; note: string; submittedBy: string }>
  }>
}

export const getCleaningChecks: ChatTool<typeof params, CleaningChecksResult> = {
  name: "getCleaningChecks",
  description:
    "Store cleaning checks (morning, Transition, evening) by store and business day: on-time rate, counts of on-time / late / missed / still open / store closed, each late or missed check with who did it and how late, and every item the crew flagged as needing attention with their note. Use for questions about cleaning, closing checks, missed or late checks, or what the crew flagged.",
  parameters: params,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const { from, to } = parseDateRange(args.dateRange)
    if ((to.getTime() - from.getTime()) / 86_400_000 > 30) {
      throw new Error("dateRange is limited to 31 days for checks")
    }
    const now = new Date()
    // Never ask about days that have not started: they are all "upcoming".
    const today = todayLA(now)
    const toDay = ymd(to) > today ? today : ymd(to)
    if (ymd(from) > today) {
      throw new Error(`dateRange starts after today (${today}); no check has been due yet`)
    }

    const grid = await loadCheckGrid({
      accountId: ctx.accountId,
      storeIds,
      fromDay: ymd(from),
      toDay,
      now,
    })

    return {
      from: ymd(from),
      to: toDay,
      stores: grid.map((store) => {
        const counts = Object.fromEntries(COUNTED.map((k) => [k, 0])) as Record<Counted, number>
        const statuses: CellStatus[] = []
        for (const c of store.cells) {
          statuses.push(c.status)
          if ((COUNTED as readonly string[]).includes(c.status)) counts[c.status as Counted] += 1
        }
        const newestFirst = [...store.cells].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
        return {
          storeId: store.id,
          storeName: store.name,
          onTimePct: onTimeRate(statuses),
          counts,
          problems: newestFirst
            .filter((c) => c.status === "late" || c.status === "partial" || c.status === "missed")
            .map((c) => ({
              date: c.day,
              check: CHECK_LABEL[c.kind].en,
              status: c.status as "late" | "partial" | "missed",
              lateMinutes: c.submission ? c.submission.lateMinutes : null,
              // A check that closed itself was sent by nobody; crewName lists who ticked.
              submittedBy: c.submission && !c.submission.autoClosed ? c.submission.crewName : null,
              tasksDone: c.submission ? c.submission.done : null,
              tasksTotal: c.submission ? c.submission.total : null,
              missedTasks: c.submission?.missed.map((m) => m.item) ?? [],
            })),
          flagged: newestFirst.flatMap((c) =>
            (c.submission?.flags ?? []).map((f) => ({
              date: c.day,
              check: CHECK_LABEL[c.kind].en,
              section: f.section,
              item: f.item,
              note: f.note,
              submittedBy: c.submission!.crewName,
            })),
          ),
        }
      }),
    }
  },
}
