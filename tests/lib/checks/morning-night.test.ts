import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { DEFAULT_TEMPLATES } from "@/lib/checks/defaults"
import { acceptingDay, visibleDay, windowPhase, type CheckWindow } from "@/lib/checks/time"
import { snapshotForm, type MarkRow } from "@/lib/checks/marks"
import { checkReportContent } from "@/lib/checks/report"
import { storeDayAlert } from "@/lib/checks/missed-alerts"
import type { ActiveCheck } from "@/lib/checks/crew"

/**
 * Morning and Night (2026-10-29): crew see the list early, Submit opens late,
 * no grace; several crew tick one shared form; the owners get an email.
 * October 2026 is PDT, so LA = UTC-7. 2026-10-29 is a Thursday.
 */

const tpl = (kind: "MORNING" | "EVENING"): CheckWindow => {
  const t = DEFAULT_TEMPLATES.find((x) => x.kind === kind)!
  return { opensAtMin: t.opensAtMin, submitFromMin: t.submitFromMin, dueAtMin: t.dueAtMin, dueByWeekday: [...t.dueByWeekday], graceMin: t.graceMin }
}
const MORNING = tpl("MORNING")
const NIGHT = tpl("EVENING")
const utc = (s: string) => new Date(s)

describe("Morning window", () => {
  it("is visible from 9 am, submittable 4:30-5:30 pm, then closed with no grace", () => {
    const d = "2026-10-29"
    expect(windowPhase(d, MORNING, utc("2026-10-29T15:59:00Z"))).toBe("upcoming")
    expect(windowPhase(d, MORNING, utc("2026-10-29T16:00:00Z"))).toBe("preview")
    expect(windowPhase(d, MORNING, utc("2026-10-29T23:29:00Z"))).toBe("preview")
    expect(windowPhase(d, MORNING, utc("2026-10-29T23:30:00Z"))).toBe("open")
    expect(windowPhase(d, MORNING, utc("2026-10-30T00:30:00Z"))).toBe("open")
    expect(windowPhase(d, MORNING, utc("2026-10-30T00:31:00Z"))).toBe("closed")
  })
  it("shows the list before Submit opens, but does not take a submission", () => {
    const noon = utc("2026-10-29T19:00:00Z")
    expect(visibleDay(MORNING, noon)).toBe("2026-10-29")
    expect(acceptingDay(MORNING, noon)).toBeNull()
  })
})

describe("Night window", () => {
  it("closes at 2 am on a Thursday night and 3 am on a Friday night", () => {
    // Thursday night: submit 12:30-2:00 am Friday.
    expect(windowPhase("2026-10-29", NIGHT, utc("2026-10-30T07:29:00Z"))).toBe("preview")
    expect(windowPhase("2026-10-29", NIGHT, utc("2026-10-30T07:30:00Z"))).toBe("open")
    expect(windowPhase("2026-10-29", NIGHT, utc("2026-10-30T09:00:00Z"))).toBe("open")
    expect(windowPhase("2026-10-29", NIGHT, utc("2026-10-30T09:01:00Z"))).toBe("closed")
    // Friday night: open until 3:00 am Saturday.
    expect(windowPhase("2026-10-30", NIGHT, utc("2026-10-31T09:30:00Z"))).toBe("open")
    expect(windowPhase("2026-10-30", NIGHT, utc("2026-10-31T10:01:00Z"))).toBe("closed")
  })
  it("belongs to the evening it started on after midnight", () => {
    expect(visibleDay(NIGHT, utc("2026-10-30T07:00:00Z"))).toBe("2026-10-29")
    expect(visibleDay(NIGHT, utc("2026-10-30T00:29:00Z"))).toBeNull()
    expect(visibleDay(NIGHT, utc("2026-10-30T00:30:00Z"))).toBe("2026-10-29")
  })
})

describe("the Morning list", () => {
  it("is the owner's 8 tasks with photos on walk-in, mopping and dishes", () => {
    const t = DEFAULT_TEMPLATES.find((x) => x.kind === "MORNING")!
    const items = t.sections.flatMap((s) => s.items)
    expect(items).toHaveLength(8)
    expect(items.filter((i) => i[2]).map((i) => i[0])).toEqual([
      "Organize walk-in",
      "Mop floors with degreaser and detergent",
      "Clean dishes before shift change",
    ])
  })
})

const active = (): ActiveCheck => ({
  kind: "MORNING",
  day: "2026-10-29",
  label: { en: "Morning", es: "Mañana" },
  submitFrom: 0,
  dueAt: 0,
  closesAt: 0,
  canSubmit: true,
  submitFromLabel: "",
  dueLabel: "",
  sections: [
    {
      id: "s1",
      en: "Morning tasks",
      es: null,
      items: [
        { id: "a", en: "Do prep", es: null, photoRequired: false },
        { id: "b", en: "Organize walk-in", es: null, photoRequired: true },
      ],
    } as ActiveCheck["sections"][number],
  ],
  marks: [],
  people: [],
})

const mark = (over: Partial<MarkRow>): MarkRow => ({
  itemId: "a", itemText: "Do prep", sectionName: "Morning tasks", done: true, note: null,
  crewName: "Maria G.", at: utc("2026-10-29T17:00:00Z"), photoKey: null, photoType: null, photoSize: null,
  ...over,
})

describe("snapshotForm", () => {
  it("refuses while a task is open, and while a photo task has no photo", () => {
    expect(snapshotForm(active(), [mark({})])).toEqual({ error: "1 task still to do." })
    expect(snapshotForm(active(), [mark({}), mark({ itemId: "b" })])).toEqual({ error: "1 photo still needed." })
  })
  it("uses the latest mark per task, keeps who and when, and collects photos", () => {
    const rows = [
      mark({}),
      mark({ itemId: "b", crewName: "Luis R.", at: utc("2026-10-29T18:00:00Z"), photoKey: "k1", photoType: "image/jpeg", photoSize: 9 }),
      mark({ itemId: "a", done: false, crewName: "Luis R.", at: utc("2026-10-29T18:05:00Z") }),
      mark({ itemId: "a", crewName: "Ana P.", at: utc("2026-10-29T18:10:00Z") }),
    ]
    const r = snapshotForm(active(), rows)
    if ("error" in r) throw new Error(r.error)
    expect(r.content.sections[0].items.map((i) => [i.text, i.by, i.photo])).toEqual([
      ["Do prep", "Ana P.", false],
      ["Organize walk-in", "Luis R.", true],
    ])
    expect(r.photos).toEqual([{ sectionName: "Organize walk-in", storageKey: "k1", contentType: "image/jpeg", size: 9 }])
  })
  it("lets a note stand in for a missing photo, and counts it as flagged", () => {
    const r = snapshotForm(active(), [mark({}), mark({ itemId: "b", note: "Walk-in door broken" })])
    if ("error" in r) throw new Error(r.error)
    expect(r.flagged).toBe(1)
  })
})

describe("check report email", () => {
  it("names the store, who sent it, every task with who and when, and links photos", () => {
    const r = checkReportContent({
      store: "Van Nuys",
      kind: "MORNING",
      day: "2026-10-29",
      by: "Maria G.",
      submittedAt: utc("2026-10-29T23:45:00Z"),
      lateMinutes: 0,
      content: {
        sections: [
          {
            name: "Morning tasks",
            photoRequired: false,
            items: [
              { text: "Do prep", done: true, flag: null, by: "Ana P.", at: "2026-10-29T17:00:00.000Z" },
              { text: "Organize walk-in", done: true, flag: "Door <broken>", by: "Luis R.", at: "2026-10-29T18:00:00.000Z", photo: true },
            ],
          },
        ],
      },
      photoCount: 1,
      link: "https://dash.example/dashboard/checks/history?store=s1&day=2026-10-29&kind=MORNING",
    })
    expect(r.subject).toBe("Van Nuys · Morning check submitted 4:45 pm by Maria G.")
    expect(r.text).toContain("Done by Ana P., Luis R.")
    expect(r.text).toContain("10:00 am")
    expect(r.html).toContain("Door &#60;broken&#62;")
    expect(r.html).not.toContain("<broken>")
    expect(r.html).toContain("See 1 photo")
  })
})

describe("missed check alert", () => {
  it("folds a store's bad day into one line", () => {
    const a = storeDayAlert("Hollywood", "2026-10-28", [
      { kind: "MORNING", missed: true, line: "Morning was due by 5:30 pm and nobody submitted it." },
      { kind: "EVENING", missed: false, line: "Night was sent 4 min late by Ana P." },
    ])
    expect(a.severity).toBe("WATCH")
    expect(a.title).toMatch(/^Hollywood · Morning missed, Night late · /)
    expect(a.body).toContain("nobody submitted")
  })
})
