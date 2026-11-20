import { prisma } from "@/lib/prisma"

/**
 * Which account the invoice mailbox belongs to.
 *
 * The sync reads one mailbox (`MICROSOFT_MAIL_USER_ID`), so every bill in it
 * belongs to one account. `INVOICE_ACCOUNT_ID` names it, the way
 * `SHOP_ACCOUNT_ID` names the account that owns the shop. Without it, the
 * account of the oldest OWNER user (by createdAt, then id) — the first owner
 * the app ever had. Before 2026-11-20 the cron took `findFirst` OWNER with no
 * order (whichever row Postgres returned first), and a manual sync filed the
 * mailbox under whoever pressed the button, so a second account's owner could
 * pull this account's bills into theirs.
 *
 * `userId` is the owner the cron files rows under (`Invoice.ownerId`): the
 * oldest OWNER of that account.
 */
export async function resolveInvoiceMailbox(): Promise<{ accountId: string; userId: string } | null> {
  const pinned = process.env.INVOICE_ACCOUNT_ID?.trim()
  const owner = await prisma.user.findFirst({
    where: { role: "OWNER", ...(pinned ? { accountId: pinned } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, accountId: true },
  })
  if (!owner) return null
  return { accountId: owner.accountId, userId: owner.id }
}
