// Section on/off in the checklist editor. Pinned: an off section is saved with
// its tasks (not deleted); crew's list leaves it out; a list with every
// section off is refused; copying to other stores carries the switch.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {}, hasOwnerAccess: () => true }))
vi.mock("@/lib/auth-scope", () => ({ requireOwnerStore: vi.fn() }))
vi.mock("@/lib/checks/email", () => ({ sendPinEmail: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    checkTemplate: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    checkSection: { deleteMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    checkItem: { deleteMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    store: { findMany: vi.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import { saveChecklist } from "@/lib/counter/actions/checks"
import { loadSections } from "@/lib/checks/sections"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const base = {
  storeId: "st_1",
  kind: "EVENING" as const,
  opensAtMin: 1050,
  submitFromMin: 1050,
  dueAtMin: 1500,
  graceMin: 0,
  enabled: true,
}
const kitchen = { id: "sec_k", nameEn: "Kitchen", nameEs: "Cocina", enabled: true, items: [{ id: "it_1", en: "Sweep", es: "", photoRequired: false }] }
const sink = { id: "sec_s", nameEn: "Sink & dishes", nameEs: "", enabled: false, items: [{ id: "it_2", en: "Wash dishes", es: "", photoRequired: true }] }

beforeEach(() => {
  vi.clearAllMocks()
  asMock(prisma.$transaction).mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma))
  asMock(prisma.checkTemplate.findUnique).mockResolvedValue({
    id: "tpl_1",
    sections: [
      { id: "sec_k", items: [{ id: "it_1" }] },
      { id: "sec_s", items: [{ id: "it_2" }] },
    ],
  })
  asMock(prisma.checkSection.update).mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve({ id: where.id }))
})

describe("saveChecklist with a section off", () => {
  it("keeps the off section and its tasks, saved as off", async () => {
    const r = await saveChecklist({ ...base, sections: [kitchen, sink] })
    expect(r.ok).toBe(true)
    // Nothing that is still on the page is deleted.
    expect(asMock(prisma.checkSection.deleteMany).mock.calls[0][0].where.id.notIn).toEqual(["sec_k", "sec_s"])
    expect(asMock(prisma.checkItem.deleteMany).mock.calls[0][0].where.id.notIn).toEqual(["it_1", "it_2"])
    const updates = asMock(prisma.checkSection.update).mock.calls.map((c) => [c[0].where.id, c[0].data.enabled])
    expect(updates).toEqual([["sec_k", true], ["sec_s", false]])
    expect(prisma.checkItem.update).toHaveBeenCalledTimes(2)
  })

  it("treats a section with no switch sent as on", async () => {
    const { enabled: _drop, ...old } = kitchen
    void _drop
    const r = await saveChecklist({ ...base, sections: [old] })
    expect(r.ok).toBe(true)
    expect(asMock(prisma.checkSection.update).mock.calls[0][0].data.enabled).toBe(true)
  })

  it("refuses a list where every section is off", async () => {
    const r = await saveChecklist({ ...base, sections: [{ ...kitchen, enabled: false }, sink] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Every section is off/)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe("crew's list", () => {
  it("asks only for sections that are on", async () => {
    asMock(prisma.checkTemplate.findUnique).mockResolvedValue({ sections: [] })
    await loadSections("st_1", "EVENING")
    const q = asMock(prisma.checkTemplate.findUnique).mock.calls[0][0]
    expect(q.select.sections.where).toEqual({ enabled: true })
  })
})

describe("copying a list to other stores", () => {
  it("keeps each store's own on/off for the check and carries section switches", async () => {
    const { copyChecklistToOtherStores } = await import("@/lib/counter/actions/checks")
    const source = {
      id: "tpl_1", opensAtMin: 1050, submitFromMin: 1050, dueAtMin: 1500, dueByWeekday: [], graceMin: 0, enabled: true,
      store: { accountId: "acc_1" },
      sections: [
        { id: "sec_k", nameEn: "Kitchen", nameEs: null, enabled: true, items: [{ textEn: "Sweep", textEs: null, photoRequired: false }] },
        { id: "sec_s", nameEn: "Sink", nameEs: null, enabled: false, items: [{ textEn: "Dishes", textEs: null, photoRequired: false }] },
      ],
    }
    const target = { id: "tpl_2", enabled: false, sections: [] }
    asMock(prisma.checkTemplate.findUnique).mockImplementation(({ where }: { where: { storeId_kind: { storeId: string } } }) =>
      Promise.resolve(where.storeId_kind.storeId === "st_1" ? source : target),
    )
    asMock(prisma.store.findMany).mockResolvedValue([{ id: "st_2" }])
    asMock(prisma.checkSection.create).mockResolvedValue({ id: "new" })
    const r = await copyChecklistToOtherStores({ storeId: "st_1", kind: "EVENING" })
    expect(r.ok).toBe(true)
    expect(asMock(prisma.checkTemplate.update).mock.calls[0][0].data.enabled).toBe(false)
    expect(asMock(prisma.checkSection.create).mock.calls.map((c) => c[0].data.enabled)).toEqual([true, false])
  })
})
