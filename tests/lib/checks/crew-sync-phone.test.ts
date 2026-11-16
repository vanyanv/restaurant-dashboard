// Sync from Harri and crew mobile numbers: Harri's number fills an empty
// Mobile field and never replaces one already on the crew row.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    harriEmployee: { findMany: vi.fn() },
    crewMember: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import { syncCrewFromHarri } from "@/lib/checks/setup"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const emp = (o: Record<string, unknown>) => ({ userId: 1, firstName: "Ana", lastName: "Ruiz", email: null, phone: "+18185550123", status: "active", ...o })
const crew = (o: Record<string, unknown>) => ({
  id: "c1", source: "HARRI", harriUserId: 1, pin: "4829", active: true,
  firstName: "Ana", lastName: "Ruiz", email: null, phone: null, inactiveReason: null, ...o,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe("syncCrewFromHarri phone", () => {
  it("fills an empty Mobile field from Harri", async () => {
    asMock(prisma.harriEmployee.findMany).mockResolvedValue([emp({})])
    asMock(prisma.crewMember.findMany).mockResolvedValue([crew({})])
    await syncCrewFromHarri("s1")
    expect(prisma.crewMember.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c1" }, data: expect.objectContaining({ phone: "+18185550123" }) }),
    )
  })

  it("never replaces a number already on the crew row", async () => {
    asMock(prisma.harriEmployee.findMany).mockResolvedValue([emp({})])
    asMock(prisma.crewMember.findMany).mockResolvedValue([crew({ phone: "+13105550199" })])
    await syncCrewFromHarri("s1")
    expect(prisma.crewMember.update).not.toHaveBeenCalled()
  })

  it("gives a new crew member Harri's number", async () => {
    asMock(prisma.harriEmployee.findMany).mockResolvedValue([emp({ userId: 2 })])
    asMock(prisma.crewMember.findMany).mockResolvedValue([])
    await syncCrewFromHarri("s1")
    expect(prisma.crewMember.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ harriUserId: 2, phone: "+18185550123" }) }),
    )
  })

  it("leaves Mobile empty when Harri has none", async () => {
    asMock(prisma.harriEmployee.findMany).mockResolvedValue([emp({ phone: null })])
    asMock(prisma.crewMember.findMany).mockResolvedValue([crew({})])
    await syncCrewFromHarri("s1")
    expect(prisma.crewMember.update).not.toHaveBeenCalled()
  })
})
