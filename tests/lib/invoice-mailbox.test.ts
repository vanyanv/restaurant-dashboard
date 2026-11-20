// The invoice mailbox belongs to one account (2026-11-20 audit). The cron used
// `findFirst` OWNER with no account and no order; now it is INVOICE_ACCOUNT_ID,
// or else the oldest OWNER, deterministically.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({ user: { findFirst: vi.fn() } }))
vi.mock("@/lib/prisma", () => ({ prisma: db }))

import { resolveInvoiceMailbox } from "@/lib/invoice-mailbox"

beforeEach(() => {
  db.user.findFirst.mockReset()
  db.user.findFirst.mockResolvedValue({ id: "u_first", accountId: "acct_first" })
})
afterEach(() => vi.unstubAllEnvs())

describe("resolveInvoiceMailbox", () => {
  it("pins to INVOICE_ACCOUNT_ID when it is set", async () => {
    vi.stubEnv("INVOICE_ACCOUNT_ID", "acct_pinned")
    db.user.findFirst.mockResolvedValue({ id: "u_p", accountId: "acct_pinned" })
    expect(await resolveInvoiceMailbox()).toEqual({ accountId: "acct_pinned", userId: "u_p" })
    expect(db.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: "OWNER", accountId: "acct_pinned" } })
    )
  })

  it("otherwise takes the oldest OWNER, ordered so the answer never changes", async () => {
    vi.stubEnv("INVOICE_ACCOUNT_ID", "")
    expect(await resolveInvoiceMailbox()).toEqual({ accountId: "acct_first", userId: "u_first" })
    expect(db.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: "OWNER" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
    )
  })

  it("returns null when there is no owner", async () => {
    db.user.findFirst.mockResolvedValue(null)
    expect(await resolveInvoiceMailbox()).toBeNull()
  })
})
