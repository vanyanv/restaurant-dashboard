import { prisma } from "@/lib/prisma"
import { vendorMatchKey } from "@/lib/vendor-normalize"

/**
 * What makes two stored invoices the same bill: vendor (by match key, so
 * "Sysco" and "Sysco Los Angeles, Inc." agree), invoice number, total, and
 * whether it is a return. The email it came in does not count — a bill can
 * arrive more than once. Seen on this account: a forwarded copy (Sysco
 * 945828794, IFS H12702-00) and KEVIDKO's payment receipt, which carries the
 * bill again (376528, 378460).
 *
 * The total is part of the key because a credit memo can reuse its bill's
 * number; the store and date because a short or recycled number on a
 * standing order could otherwise collide across stores or weeks. Null when
 * the number is too thin to identify a bill (empty, under 4 characters, or
 * no digits at all, like an extractor's "N/A"): better to store a duplicate
 * than to drop a real bill.
 *
 * Pass `invoiceDate: null` for a bill whose PDF printed no date: the sync
 * dates those by the email's arrival, which differs between two copies of
 * the same bill, so the date cannot be part of what makes them the same.
 * `loadInvoiceIdentities` stores both the dated and the dateless key.
 */
export function invoiceIdentityKey(inv: {
  vendorName: string
  invoiceNumber: string | null | undefined
  totalAmount: number
  isReturn?: boolean | null
  storeId?: string | null
  invoiceDate?: Date | null
}): string | null {
  const number = (inv.invoiceNumber ?? "").trim().toLowerCase()
  if (number.length < 4 || !/\d/.test(number)) return null
  return [
    vendorMatchKey(inv.vendorName),
    number,
    inv.totalAmount.toFixed(2),
    inv.isReturn ? "return" : "bill",
    inv.storeId ?? "",
    inv.invoiceDate ? inv.invoiceDate.toISOString().slice(0, 10) : "",
  ].join("::")
}

/** Identity keys of the account's invoices that share one of these numbers. */
export async function loadInvoiceIdentities(
  accountId: string,
  invoiceNumbers: Array<string | null | undefined>
): Promise<Set<string>> {
  const numbers = [...new Set(invoiceNumbers.filter((n): n is string => !!n?.trim()))]
  if (numbers.length === 0) return new Set()
  const rows = await prisma.invoice.findMany({
    where: { accountId, invoiceNumber: { in: numbers } },
    select: {
      vendorName: true,
      invoiceNumber: true,
      totalAmount: true,
      isReturn: true,
      storeId: true,
      invoiceDate: true,
    },
  })
  const out = new Set<string>()
  for (const r of rows) {
    const key = invoiceIdentityKey(r)
    if (key) out.add(key)
    const dateless = invoiceIdentityKey({ ...r, invoiceDate: null })
    if (dateless) out.add(dateless)
  }
  return out
}
