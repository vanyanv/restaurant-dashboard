// The invoice mailbox belongs to one account (2026-11-20 audit). The cron used
// `findFirst` OWNER with no account and no order. Now it is INVOICE_ACCOUNT_ID,
// or the owners' account while exactly one account has owners; with two and
// no pin the sync refuses rather than guess.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({ user: { findFirst: vi.fn(), findMany: vi.fn() } }))
vi.mock("@/lib/prisma", () => ({ prisma: db }))

import { resolveInvoiceMailbox } from "@/lib/invoice-mailbox"

beforeEach(() => {
  db.user.findFirst.mockReset()
  db.user.findMany.mockReset()
  db.user.findFirst.mockResolvedValue({ id: "u_first", accountId: "acct_first" })
  db.user.findMany.mockResolvedValue([{ accountId: "acct_first" }])
})
afterEach(() => vi.unstubAllEnvs())

describe("resolveInvoiceMailbox", () => {
  it("pins to INVOICE_ACCOUNT_ID when it is set, whatever other accounts exist", async () => {
    vi.stubEnv("INVOICE_ACCOUNT_ID", "acct_pinned")
    db.user.findFirst.mockResolvedValue({ id: "u_p", accountId: "acct_pinned" })
    expect(await resolveInvoiceMailbox()).toEqual({ ok: true, accountId: "acct_pinned", userId: "u_p" })
    expect(db.user.findMany).not.toHaveBeenCalled()
    expect(db.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: "OWNER", accountId: "acct_pinned" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
    )
  })

  it("uses the owners' account when only one account has owners", async () => {
    vi.stubEnv("INVOICE_ACCOUNT_ID", "")
    expect(await resolveInvoiceMailbox()).toEqual({ ok: true, accountId: "acct_first", userId: "u_first" })
    expect(db.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: "OWNER", accountId: "acct_first" } })
    )
  })

  it("refuses when two accounts have owners and nothing pins the mailbox", async () => {
    vi.stubEnv("INVOICE_ACCOUNT_ID", "")
    db.user.findMany.mockResolvedValue([{ accountId: "acct_first" }, { accountId: "acct_second" }])
    const res = await resolveInvoiceMailbox()
    expect(res.ok).toBe(false)
    expect(res.ok ? "" : res.error).toMatch(/INVOICE_ACCOUNT_ID/)
    expect(db.user.findFirst).not.toHaveBeenCalled()
  })

  it("refuses when there is no owner", async () => {
    vi.stubEnv("INVOICE_ACCOUNT_ID", "")
    db.user.findMany.mockResolvedValue([])
    expect((await resolveInvoiceMailbox()).ok).toBe(false)
  })
})
