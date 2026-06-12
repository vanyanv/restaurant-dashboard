import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withCronAuth } from "@/lib/cron-auth"
import { withJobRun } from "@/lib/monitoring/job-run"
import { recomputeAccountVendorLeadTimes } from "@/lib/inventory/vendor-lead-time"

export const maxDuration = 120

/**
 * Nightly recompute of VendorLeadTime cache rows. Walks every account's
 * invoice history, groups by normalized vendor name, and upserts the median
 * inter-invoice cadence as a proxy for delivery lead time. Reorder reads
 * pick this up — they never recompute on the request path.
 */
export const POST = withCronAuth(async () => {
  const result = await withJobRun(
    "vendor-lead-time.recompute",
    { triggeredBy: "github-actions" },
    async ({ addRows }) => {
      const accounts = await prisma.account.findMany({
        select: { id: true, name: true },
      })

      const perAccount: Array<{
        accountId: string
        accountName: string
        vendorsProcessed: number
        vendorsWithSignal: number
        rowsUpserted: number
      }> = []

      let totalUpserts = 0
      for (const acct of accounts) {
        const r = await recomputeAccountVendorLeadTimes(acct.id)
        perAccount.push({
          accountId: acct.id,
          accountName: acct.name,
          ...r,
        })
        totalUpserts += r.rowsUpserted
      }

      addRows(totalUpserts)
      return {
        accountsProcessed: accounts.length,
        totalUpserts,
        perAccount,
      }
    }
  )

  return NextResponse.json(result)
})
