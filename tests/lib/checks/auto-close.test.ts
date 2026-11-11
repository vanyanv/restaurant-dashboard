import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({
  checkMark: { findMany: vi.fn() },
  checkSubmission: { create: vi.fn() },
  checkTemplate: { findUnique: vi.fn() },
}))
vi.mock("@/lib/prisma", () => ({ prisma: db }))
const sent = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock("@/lib/checks/report", async (orig) => ({ ...(await orig<typeof import("@/lib/checks/report")>()), sendCheckReport: sent }))
// No request scope in a test: `after` throws, so the email runs straight away.
vi.mock("next/server", () => ({ after: () => { throw new Error("outside a request") } }))

import { autoCloseChecks, closedForm, type CloseMark } from "@/lib/checks/close"
import { recordCounts } from "@/lib/checks/data"
import { cellStatus, countsToward, onTimeRate } from "@/lib/checks/status"
import { checkReportContent } from "@/lib/checks/report"
import { storeDayAlert } from "@/lib/checks/missed-alerts"
import type { CrewSection } from "@/lib/checks/crew"
import type { CheckWindow } from "@/lib/checks/time"

/**
 * Checks close themselves (2026-11-11): when the window ends with nothing
 * sent, the record is written from the shared form, ticked tasks done and
 * the rest missed. November 2026 is PST, so LA = UTC-8. 2026-11-10 is a
 * Tuesday; its Night check is due 1:30 am and closes at 2:00 am Wednesday.
 */

const NIGHT: CheckWindow = { opensAtMin: 1050, submitFromMin: 1470, dueAtMin: 1530, dueByWeekday: [], graceMin: 30 }
const DAY = "2026-11-10"
const DUE = new Date("2026-11-11T09:30:00Z") // 1:30 am
const CLOSES = new Date("2026-11-11T10:00:00Z") // 2:00 am

const sections: CrewSection[] = [
  {
    id: "k",
    en: "Kitchen",
    es: "Cocina",
    items: [
      { id: "grill", en: "Scrape the grills", es: null, photoRequired: true },
      { id: "mop", en: "Mop floors", es: null, photoRequired: true },
      { id: "soda", en: "Wipe soda machine", es: null, photoRequired: false },
    ],
  },
  { id: "f", en: "Front of house", es: null, items: [{ id: "bags", en: "Restock to-go bags", es: null, photoRequired: false }] },
]

const mark = (itemId: string, at: string, over: Partial<CloseMark> = {}): CloseMark => ({
  itemId,
  done: true,
  note: null,
  crewName: "Maria R.",
  at: new Date(at),
  photoKey: null,
  photoType: null,
  photoSize: null,
  ...over,
})

describe("closedForm", () => {
  it("keeps ticked tasks as done and records the rest as missed", () => {
    const f = closedForm(sections, [
      mark("grill", "2026-11-11T07:42:00Z", { photoKey: "p/grill.jpg", photoType: "image/jpeg", photoSize: 900 }),
      mark("soda", "2026-11-11T08:00:00Z", { crewName: "Jose M." }),
    ])
    expect(f.done).toBe(2)
    expect(f.total).toBe(4)
    expect(f.content.sections[0].items.map((i) => [i.text, i.done, i.by])).toEqual([
      ["Scrape the grills", true, "Maria R."],
      ["Mop floors", false, null],
      ["Wipe soda machine", true, "Jose M."],
    ])
    expect(f.photos).toEqual([{ sectionName: "Scrape the grills", storageKey: "p/grill.jpg", contentType: "image/jpeg", size: 900 }])
    expect(f.people).toEqual(["Maria R.", "Jose M."])
    expect(f.lastDoneAt?.toISOString()).toBe("2026-11-11T08:00:00.000Z")
    expect(recordCounts(f.content)).toEqual({
      done: 2,
      total: 4,
      missed: [
        { section: "Kitchen", item: "Mop floors" },
        { section: "Front of house", item: "Restock to-go bags" },
      ],
    })
  })

  it("reads the latest mark: an untick leaves the task missed, and the unticker is not credited", () => {
    const f = closedForm(sections, [
      mark("mop", "2026-11-11T07:00:00Z", { crewName: "Jose M." }),
      mark("mop", "2026-11-11T07:05:00Z", { crewName: "Jose M.", done: false }),
      mark("grill", "2026-11-11T07:10:00Z"),
    ])
    expect(f.content.sections[0].items[1]).toMatchObject({ text: "Mop floors", done: false, by: null, at: null })
    expect(f.people).toEqual(["Maria R."])
  })

  it("counts a note as done and flagged", () => {
    const f = closedForm(sections, [mark("mop", "2026-11-11T07:00:00Z", { note: "Out of degreaser" })])
    expect(f.flagged).toBe(1)
    expect(f.content.sections[0].items[1]).toMatchObject({ done: true, flag: "Out of degreaser" })
  })
})

describe("cellStatus with a record", () => {
  const base = { day: DAY, window: NIGHT, enabled: true, closed: false, now: new Date("2026-11-11T12:00:00Z") }
  it("is partial with some tasks done, missed with none, on time or late with all", () => {
    expect(cellStatus({ ...base, submission: { lateMinutes: 0, done: 18, total: 21 } })).toBe("partial")
    expect(cellStatus({ ...base, submission: { lateMinutes: 0, done: 0, total: 21 } })).toBe("missed")
    expect(cellStatus({ ...base, submission: { lateMinutes: 0, done: 21, total: 21 } })).toBe("on_time")
    expect(cellStatus({ ...base, submission: { lateMinutes: 12, done: 21, total: 21 } })).toBe("late")
    // A crew submit from before checks closed themselves carries no counts.
    expect(cellStatus({ ...base, submission: { lateMinutes: 0 } })).toBe("on_time")
  })
  it("counts partial against the on-time rate", () => {
    expect(countsToward("partial")).toBe("not_on_time")
    expect(onTimeRate(["on_time", "partial", "late", "missed"])).toBe(25)
  })
  it("still pauses a window closed during training, record or not", () => {
    const pauses = [{ pausedAt: new Date("2026-11-03T00:00:00Z"), resumedAt: null }]
    expect(cellStatus({ ...base, pauses, submission: { lateMinutes: 0, done: 3, total: 21 } })).toBe("paused")
  })
})

describe("autoCloseChecks", () => {
  const store = { id: "s1", accountId: "acc" }
  const candidate = { kind: "EVENING" as const, day: DAY, window: NIGHT, templateId: "t1" }
  const template = {
    sections: sections.map((s) => ({
      id: s.id,
      nameEn: s.en,
      nameEs: s.es,
      items: s.items.map((i) => ({ id: i.id, textEn: i.en, textEs: i.es, photoRequired: i.photoRequired })),
    })),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    db.checkTemplate.findUnique.mockResolvedValue(template)
    db.checkSubmission.create.mockResolvedValue({ id: "sub1" })
  })

  it("writes the record at the close time, scoped to the store's account, and emails it", async () => {
    db.checkMark.findMany.mockResolvedValue([
      mark("grill", "2026-11-11T07:42:00Z"),
      mark("soda", "2026-11-11T08:10:00Z", { crewName: "Jose M." }),
      // After the window ended (a phone that was offline): not counted.
      mark("mop", "2026-11-11T10:05:00Z"),
    ])
    const n = await autoCloseChecks({ store, candidates: [candidate], now: new Date("2026-11-11T10:20:00Z") })
    expect(n).toBe(1)
    expect(db.checkMark.findMany.mock.calls[0][0].where).toMatchObject({ storeId: "s1", kind: "EVENING", store: { accountId: "acc" } })
    const data = db.checkSubmission.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      storeId: "s1",
      templateId: "t1",
      kind: "EVENING",
      autoClosed: true,
      crewMemberId: null,
      crewName: "Maria R., Jose M.",
      submittedAt: CLOSES,
      lateMinutes: 0,
    })
    expect(recordCounts(data.content)).toMatchObject({ done: 2, total: 4 })
    await vi.waitFor(() => expect(sent).toHaveBeenCalledWith("sub1"))
  })

  it("calls an all-done check late by its last tick, not by when it closed", async () => {
    db.checkMark.findMany.mockResolvedValue(
      ["grill", "mop", "soda", "bags"].map((id, i) => mark(id, i === 3 ? "2026-11-11T09:42:00Z" : "2026-11-11T08:00:00Z")),
    )
    await autoCloseChecks({ store, candidates: [candidate], now: new Date("2026-11-11T10:05:00Z") })
    expect(db.checkSubmission.create.mock.calls[0][0].data.lateMinutes).toBe(12)
  })

  it("records a check nobody started as all missed", async () => {
    db.checkMark.findMany.mockResolvedValue([])
    await autoCloseChecks({ store, candidates: [candidate], now: new Date("2026-11-11T10:05:00Z") })
    const data = db.checkSubmission.create.mock.calls[0][0].data
    expect(data.crewName).toBe("")
    expect(data.startedAt).toBeNull()
    expect(recordCounts(data.content)).toMatchObject({ done: 0, total: 4 })
  })

  it("leaves a record crew or another loader already wrote, and sends nothing", async () => {
    db.checkMark.findMany.mockResolvedValue([])
    db.checkSubmission.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }))
    const n = await autoCloseChecks({ store, candidates: [candidate], now: new Date("2026-11-11T10:05:00Z") })
    expect(n).toBe(0)
    expect(sent).not.toHaveBeenCalled()
  })

  it("closes an old window without emailing about it", async () => {
    db.checkMark.findMany.mockResolvedValue([])
    const n = await autoCloseChecks({ store, candidates: [candidate], now: new Date("2026-11-12T04:00:00Z") })
    expect(n).toBe(1)
    await new Promise((r) => setTimeout(r, 0))
    expect(sent).not.toHaveBeenCalled()
  })

  it("skips a check whose list is empty", async () => {
    db.checkTemplate.findUnique.mockResolvedValue({ sections: [] })
    db.checkMark.findMany.mockResolvedValue([])
    expect(await autoCloseChecks({ store, candidates: [candidate], now: CLOSES })).toBe(0)
    expect(db.checkSubmission.create).not.toHaveBeenCalled()
  })
})

describe("the email for a check that closed itself", () => {
  const content = closedForm(sections, [
    mark("grill", "2026-11-11T07:42:00Z", { photoKey: "k" }),
    mark("soda", "2026-11-11T09:41:00Z", { crewName: "Jose M.", note: "Bin lid <broken>" }),
  ]).content
  const base = {
    store: "Van Nuys",
    kind: "EVENING" as const,
    day: DAY,
    by: "",
    submittedAt: CLOSES,
    lateMinutes: 0,
    autoClosed: true,
    dueAt: DUE,
    photoCount: 1,
    link: "https://dash.example/x",
  }

  it("leads with done and missed, lists missed tasks by section, then notes and late tasks, then what was done", () => {
    const r = checkReportContent({ ...base, content })
    expect(r.subject).toBe("Van Nuys · Night check: 2 of 4 done, 2 missed")
    expect(r.text).toContain("Closed itself at 2:00 am.")
    const missedAt = r.text.indexOf("MISSED (2)")
    const notesAt = r.text.indexOf("NOTES AND LATE TASKS (1)")
    const doneAt = r.text.indexOf("DONE (2)")
    expect(missedAt).toBeGreaterThan(0)
    expect(notesAt).toBeGreaterThan(missedAt)
    expect(doneAt).toBeGreaterThan(notesAt)
    expect(r.text).toMatch(/Kitchen\s+Mop floors/)
    expect(r.text).toMatch(/Front of house\s+Restock to-go bags/)
    expect(r.text).toContain("1:41 am   Wipe soda machine · Jose M. · late · NOTE: Bin lid <broken>")
    expect(r.html).toContain("Missed (2)")
    expect(r.html).toContain("Bin lid &#60;broken&#62;")
    expect(r.html).not.toContain("<broken>")
  })

  it("says plainly when nobody started", () => {
    const r = checkReportContent({ ...base, content: closedForm(sections, []).content, photoCount: 0 })
    expect(r.subject).toBe("Van Nuys · Night check: not started, all 4 missed")
    expect(r.html).toContain("Not started · all 4 missed")
    expect(r.text).not.toContain("DONE")
  })
})

describe("Needs you for a check that closed itself", () => {
  it("names how many tasks were missed, and is a watch", () => {
    const a = storeDayAlert("Van Nuys", DAY, [
      { kind: "EVENING", level: "partial", tasks: 3, line: "Night closed at 2:00 am with 18 of 21 done. Missed: Mop floors." },
      { kind: "MORNING", level: "late", line: "Morning was all done, the last task 4 min after 5:30 pm." },
    ])
    expect(a.severity).toBe("WATCH")
    expect(a.title).toBe("Van Nuys · Night 3 tasks missed, Morning late · Tue Nov 10")
    expect(a.body).toContain("Missed: Mop floors.")
  })
})

