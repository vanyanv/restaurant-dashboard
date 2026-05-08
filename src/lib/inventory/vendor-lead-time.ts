import { prisma } from "@/lib/prisma"
import { normalizeVendorName } from "@/lib/vendor-normalize"

const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface MedianLeadDaysResult {
  sampleSize: number
  medianLeadDays: number | null
}

/**
 * Median inter-invoice cadence (in days) for one (account, vendor) — a proxy
 * for delivery lead time in the reorder math.
 *
 * Invoice dates are sorted and deduped to whole days first; sampleSize counts
 * the number of resulting deltas. Caller decides what to do with sampleSize<3
 * (typically: fall back to a per-account default).
 */
export function computeMedianLeadDaysFromInvoices(
  invoiceDates: Date[]
): MedianLeadDaysResult {
  if (invoiceDates.length < 2) {
    return { sampleSize: 0, medianLeadDays: null }
  }
  const dayKeys = Array.from(
    new Set(
      invoiceDates.map((d) => Math.floor(d.getTime() / MS_PER_DAY))
    )
  ).sort((a, b) => a - b)

  if (dayKeys.length < 2) {
    return { sampleSize: 0, medianLeadDays: null }
  }

  const deltas: number[] = []
  for (let i = 1; i < dayKeys.length; i++) {
    deltas.push(dayKeys[i] - dayKeys[i - 1])
  }
  deltas.sort((a, b) => a - b)
  const mid = deltas.length / 2
  const median =
    deltas.length % 2 === 1
      ? deltas[Math.floor(mid)]
      : (deltas[mid - 1] + deltas[mid]) / 2

  return { sampleSize: deltas.length, medianLeadDays: median }
}

const DEFAULT_FALLBACK_LEAD_DAYS = 3
const MIN_TRUSTED_SAMPLE_SIZE = 3

export interface RecomputeLeadTimesResult {
  vendorsProcessed: number
  vendorsWithSignal: number
  rowsUpserted: number
}

/**
 * Recompute VendorLeadTime cache rows for one account by walking the account's
 * invoices, grouping by normalized vendor name, and computing the median
 * inter-invoice cadence. Vendors with sampleSize < 3 are still cached, but
 * their `medianLeadDays` is set to the per-account fallback so reorder reads
 * never see a NULL.
 */
export async function recomputeAccountVendorLeadTimes(
  accountId: string,
  options: { fallbackLeadDays?: number } = {}
): Promise<RecomputeLeadTimesResult> {
  const fallback = options.fallbackLeadDays ?? DEFAULT_FALLBACK_LEAD_DAYS

  const invoices = await prisma.invoice.findMany({
    where: { accountId, invoiceDate: { not: null } },
    select: { vendorName: true, invoiceDate: true },
  })

  const byVendor = new Map<string, Date[]>()
  for (const inv of invoices) {
    if (!inv.invoiceDate) continue
    const key = normalizeVendorName(inv.vendorName)
    if (!key) continue
    let dates = byVendor.get(key)
    if (!dates) {
      dates = []
      byVendor.set(key, dates)
    }
    dates.push(inv.invoiceDate)
  }

  let vendorsWithSignal = 0
  let rowsUpserted = 0
  for (const [vendorKey, dates] of byVendor) {
    const { sampleSize, medianLeadDays } = computeMedianLeadDaysFromInvoices(dates)
    const trusted = sampleSize >= MIN_TRUSTED_SAMPLE_SIZE && medianLeadDays != null
    if (trusted) vendorsWithSignal++
    const lead = trusted ? (medianLeadDays as number) : fallback

    await prisma.vendorLeadTime.upsert({
      where: {
        accountId_vendorNameNormalized: {
          accountId,
          vendorNameNormalized: vendorKey,
        },
      },
      create: {
        accountId,
        vendorNameNormalized: vendorKey,
        medianLeadDays: lead,
        sampleSize,
        lastComputedAt: new Date(),
      },
      update: {
        medianLeadDays: lead,
        sampleSize,
        lastComputedAt: new Date(),
      },
    })
    rowsUpserted++
  }

  return {
    vendorsProcessed: byVendor.size,
    vendorsWithSignal,
    rowsUpserted,
  }
}
