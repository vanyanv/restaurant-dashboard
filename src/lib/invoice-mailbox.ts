import { prisma } from "@/lib/prisma"

export type InvoiceMailbox =
  | { ok: true; accountId: string; userId: string }
  | { ok: false; error: string }

/**
 * Which account the invoice mailbox belongs to.
 *
 * The sync reads one mailbox (`MICROSOFT_MAIL_USER_ID`), so every bill in it
 * belongs to one account. `INVOICE_ACCOUNT_ID` names it, the way
 * `SHOP_ACCOUNT_ID` names the account that owns the shop.
 *
 * Without it, the mailbox is the owners' account only while exactly one
 * account has OWNER users. As soon as a second account gets an owner the sync
 * refuses to run until INVOICE_ACCOUNT_ID is set, so the mailbox can never
 * switch account on its own (picking "the oldest owner" would silently move
 * it if that user were deleted). Before 2026-11-20 the cron took `findFirst`
 * OWNER with no order, and a manual sync filed the mailbox under whoever
 * pressed the button.
 *
 * `userId` is the owner the cron files rows under (`Invoice.ownerId`): the
 * oldest OWNER of that account (by createdAt, then id).
 */
export async function resolveInvoiceMailbox(): Promise<InvoiceMailbox> {
  const pinned = process.env.INVOICE_ACCOUNT_ID?.trim()
  let accountId = pinned
  if (!accountId) {
    const accounts = await prisma.user.findMany({
      where: { role: "OWNER" },
      distinct: ["accountId"],
      select: { accountId: true },
      take: 2,
    })
    if (accounts.length === 0) return { ok: false, error: "No owner user found for the invoice mailbox" }
    if (accounts.length > 1) {
      return {
        ok: false,
        error:
          "More than one account has owners: set INVOICE_ACCOUNT_ID to the account the invoice mailbox belongs to",
      }
    }
    accountId = accounts[0].accountId
  }
  const owner = await prisma.user.findFirst({
    where: { role: "OWNER", accountId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, accountId: true },
  })
  if (!owner) return { ok: false, error: `No owner user found in invoice account ${accountId}` }
  return { ok: true, accountId: owner.accountId, userId: owner.id }
}
