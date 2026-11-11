import { describe, expect, it } from "vitest"
import type { GridCell, GridMark, GridStore, RecordTask } from "@/lib/checks/data"
import { BURST_MIN, checkReport, taskShare, tickBurst, tickTimeline } from "@/lib/checks/insights"

const NIGHT = { opensAtMin: 21 * 60, submitFromMin: 23 * 60, dueAtMin: 25 * 60, graceMin: 30 }
// 2026-11-10 is a Tuesday. 1:00 am LA on the 11th is 09:00 UTC (PST, -8).
const at = (iso: string) => new Date(iso)

let n = 0
function mark(itemId: string, by: string, iso: string, extra: Partial<GridMark> = {}): GridMark {
  n += 1
  return {
    id: `m${n}`,
    itemId,
    itemText: itemId,
    sectionName: "Kitchen",
    done: true,
    note: null,
    crewName: by,
    at: at(iso),
    hasPhoto: false,
    review: null,
    reviewNote: null,
    ...extra,
  }
}

function task(item: string, done: boolean, by: string | null = null, iso: string | null = null, note: string | null = null): RecordTask {
  return { section: "Kitchen", item, done, note, by, at: iso ? at(iso) : null, photo: false }
}

function cell(day: string, status: GridCell["status"], tasks: RecordTask[], marks: GridMark[] = []): GridCell {
  const done = tasks.filter((t) => t.done).length
  return {
    day,
    kind: "EVENING",
    status,
    submission:
      tasks.length === 0
        ? null
        : {
            id: `s-${day}`,
            crewName: "",
            autoClosed: status !== "on_time" && status !== "late",
            done,
            total: tasks.length,
            missed: tasks.filter((t) => !t.done).map((t) => ({ section: t.section, item: t.item })),
            tasks,
            submittedAt: at(`${day}T10:00:00Z`),
            startedAt: null,
            lateMinutes: 0,
            flaggedCount: 0,
            flags: [],
            photos: [],
          },
    startedBy: null,
    marks,
    done,
    total: tasks.length,
    people: [],
  }
}

function store(cells: GridCell[]): GridStore {
  return {
    id: "vn",
    name: "Van Nuys",
    preOpen: false,
    pausedSince: null,
    templates: [{ id: "t1", kind: "EVENING", enabled: true, createdAt: at("2026-10-01T00:00:00Z"), itemCount: 3, ...NIGHT }],
    closedDays: [],
    cells,
  }
}

describe("tickBurst", () => {
  it("finds one person ticking six tasks inside three minutes", () => {
    const t0 = at("2026-11-11T09:10:00Z").getTime()
    // Six ticks between 1:10:00 and 1:10:05 am.
    const b = tickBurst(Array.from({ length: BURST_MIN }, (_, i) => ({ ...mark(`i${i}`, "Jose M.", "2026-11-11T09:10:00Z"), at: new Date(t0 + i * 1000) })))
    expect(b).not.toBeNull()
    expect(b!.count).toBe(6)
    expect(b!.by).toBe("Jose M.")
  })

  it("does not count ticks spread out, two people, or ticks later undone", () => {
    const t0 = at("2026-11-11T09:00:00Z").getTime()
    const spread = Array.from({ length: 8 }, (_, i) => ({ ...mark(`s${i}`, "Ana", "2026-11-11T09:00:00Z"), at: new Date(t0 + i * 60_000) }))
    expect(tickBurst(spread)).toBeNull()
    const split = Array.from({ length: 6 }, (_, i) => ({ ...mark(`p${i}`, i % 2 ? "Ana" : "Jose", "2026-11-11T09:00:00Z"), at: new Date(t0 + i * 1000) }))
    expect(tickBurst(split)).toBeNull()
    const undone = Array.from({ length: 6 }, (_, i) => ({ ...mark(`u${i}`, "Ana", "2026-11-11T09:00:00Z"), at: new Date(t0 + i * 1000) }))
    undone.push({ ...mark("u0", "Ana", "2026-11-11T09:00:00Z", { done: false }), at: new Date(t0 + 10_000) })
    expect(tickBurst(undone)).toBeNull()
  })
})

describe("tickTimeline", () => {
  it("places ticks on the strip and marks the ones after due", () => {
    const tl = tickTimeline("2026-11-10", NIGHT, [mark("a", "Ana", "2026-11-11T08:30:00Z"), mark("b", "Ana", "2026-11-11T09:10:00Z")])
    expect(tl).not.toBeNull()
    expect(tl!.ticks.map((t) => t.late)).toEqual([false, true])
    expect(tl!.dueLabel).toBe("1:00 am")
    expect(tl!.duePct).toBeGreaterThan(0)
    expect(tl!.duePct).toBeLessThan(100)
  })
  it("is null with no standing tick", () => {
    expect(tickTimeline("2026-11-10", NIGHT, [mark("a", "Ana", "2026-11-11T08:30:00Z", { done: false })])).toBeNull()
  })
})

describe("taskShare", () => {
  it("adds tasks over counted cells only", () => {
    const a = cell("2026-11-09", "on_time", [task("x", true), task("y", true)])
    const b = cell("2026-11-10", "partial", [task("x", true), task("y", false)])
    const open = { ...cell("2026-11-11", "open", []), done: 1, total: 2 }
    expect(taskShare([a, b, open])).toEqual({ done: 3, total: 4, pct: 75 })
    expect(taskShare([open])).toBeNull()
  })
})

describe("checkReport", () => {
  const days = ["2026-11-09", "2026-11-10"]
  const grid = [
    store([
      cell("2026-11-09", "on_time", [
        task("Mop", true, "Ana", "2026-11-10T08:40:00Z"),
        task("Grills", true, "Jose", "2026-11-10T08:50:00Z", "Out of degreaser"),
        task("Trash", true, "Ana", "2026-11-10T08:45:00Z"),
      ]),
      cell("2026-11-10", "partial", [
        task("Mop", false),
        task("Grills", true, "Jose", "2026-11-11T09:20:00Z"),
        task("Trash", true, "Jose", "2026-11-11T09:25:00Z"),
      ]),
      // Outside the range: never counted.
      cell("2026-11-08", "missed", [task("Mop", false), task("Grills", false), task("Trash", false)]),
    ]),
  ]
  const r = checkReport(grid, days)

  it("counts checks by how they ended", () => {
    expect(r.checks).toEqual({ due: 2, complete: 1, partial: 1, missed: 0, late: 0 })
    expect(r.share).toEqual({ done: 5, total: 6, pct: 83 })
  })

  it("ranks the task missed most, out of the checks it was on", () => {
    expect(r.mostMissed).toEqual([{ store: "Van Nuys", check: "Night", item: "Mop", missed: 1, of: 2 }])
  })

  it("splits the share by the weekday the check belongs to, Monday first", () => {
    const night = r.weekdays.find((w) => w.kind === "EVENING")!
    expect(night.days[0]).toMatchObject({ short: "Mon", pct: 100, checks: 1 })
    expect(night.days[1]).toMatchObject({ short: "Tue", pct: 67, checks: 1 })
    expect(night.days[2]).toMatchObject({ short: "Wed", pct: null, checks: 0 })
  })

  it("credits each person from the record, with late ticks and notes", () => {
    const jose = r.people.find((p) => p.name === "Jose")!
    const ana = r.people.find((p) => p.name === "Ana")!
    // Due 1:00 am = 09:00Z; Jose's two ticks on the 10th's check were after it.
    expect(jose).toMatchObject({ checks: 2, tasks: 3, lateTicks: 2, notes: 1 })
    expect(ana).toMatchObject({ checks: 1, tasks: 2, lateTicks: 0, notes: 0, typicalSpan: "5 min" })
    expect(r.people[0].name).toBe("Jose")
  })
})
