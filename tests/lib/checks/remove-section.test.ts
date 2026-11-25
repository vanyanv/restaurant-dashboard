// Remove section saves straight away, and Save takes the longer Spanish task
// lines Glendale's Night check carries (up to 150 characters; the old 140 cap
// failed with zod's bare "Too big").

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
    checkSection: { delete: vi.fn(), deleteMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    checkItem: { deleteMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    store: { findMany: vi.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import { requireOwnerStore } from "@/lib/auth-scope"
import { removeChecklistSection, saveChecklist } from "@/lib/counter/actions/checks"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const sec = (id: string, enabled: boolean, items: number) => ({ id, enabled, _count: { items } })

beforeEach(() => {
  vi.clearAllMocks()
  asMock(prisma.$transaction).mockImplementation((arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: typeof prisma) => unknown)(prisma) : Promise.all(arg as unknown[]),
  )
  asMock(prisma.checkSection.update).mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve({ id: where.id }))
})

describe("removeChecklistSection", () => {
  it("deletes the section and renumbers the rest", async () => {
    asMock(prisma.checkTemplate.findUnique).mockResolvedValue({
      id: "tpl", enabled: true, sections: [sec("old_k", false, 9), sec("old_f", false, 17), sec("close_f", true, 8)],
    })
    const r = await removeChecklistSection({ storeId: "st", kind: "EVENING", sectionId: "old_f" })
    expect(r.ok).toBe(true)
    expect(requireOwnerStore).toHaveBeenCalledWith("st")
    expect(prisma.checkSection.delete).toHaveBeenCalledWith({ where: { id: "old_f" } })
    const moves = asMock(prisma.checkSection.update).mock.calls.map((c) => [c[0].where.id, c[0].data.position])
    expect(moves).toEqual([["old_k", 0], ["close_f", 1]])
  })

  it("refuses a section that isn't on this store's check", async () => {
    asMock(prisma.checkTemplate.findUnique).mockResolvedValue({ id: "tpl", enabled: true, sections: [sec("a", true, 1), sec("b", true, 1)] })
    const r = await removeChecklistSection({ storeId: "st", kind: "EVENING", sectionId: "other_store" })
    expect(r.ok).toBe(false)
    expect(prisma.checkSection.delete).not.toHaveBeenCalled()
  })

  it("refuses to remove the only section crew see on a check that is on", async () => {
    asMock(prisma.checkTemplate.findUnique).mockResolvedValue({ id: "tpl", enabled: true, sections: [sec("a", true, 3), sec("b", false, 3)] })
    const r = await removeChecklistSection({ storeId: "st", kind: "EVENING", sectionId: "a" })
    expect(r.ok).toBe(false)
    expect(prisma.checkSection.delete).not.toHaveBeenCalled()
  })
})

describe("saveChecklist task length", () => {
  const base = { storeId: "st", kind: "EVENING" as const, opensAtMin: 1050, submitFromMin: 1050, dueAtMin: 1500, graceMin: 0, enabled: true }
  beforeEach(() => {
    asMock(prisma.checkTemplate.findUnique).mockResolvedValue({ id: "tpl", sections: [{ id: "s", items: [{ id: "i" }] }] })
  })
  const withEs = (es: string) => ({
    ...base,
    sections: [{ id: "s", nameEn: "Before you leave", nameEs: "", enabled: true, items: [{ id: "i", en: "Lights off", es, photoRequired: false }] }],
  })

  it("saves a 150-character Spanish line", async () => {
    expect((await saveChecklist(withEs("a".repeat(150)))).ok).toBe(true)
  })

  it("says which line is too long, in words", async () => {
    const r = await saveChecklist(withEs("a".repeat(241)))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe("A task in Spanish is too long. Keep it under 240 characters.")
  })
})
