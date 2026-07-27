import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withCronAuth } from "@/lib/cron-auth"
import { withJobRun } from "@/lib/monitoring/job-run"
import { generateMappingProposalsCore } from "@/lib/mapping-proposals-core"

/**
 * Post-sync proposal generation: after each Otter sync, surface new unmapped
 * POS items as PENDING RecipeMappingProposal rows so they are waiting in the
 * review sheet instead of requiring a manual button press. Layer-0 exact-name
 * matching resolves most items with no LLM call; only genuinely fuzzy new
 * items reach gpt-4.1-mini (and repeat runs skip everything already
 * PENDING/REJECTED, so routine runs cost nothing). Writes are proposals
 * only — a human Accept is still the only path to an OtterItemMapping.
 */
export const GET = withCronAuth(async () => {
  const result = await withJobRun(
    "proposals.generate",
    { triggeredBy: "github-actions" },
    async ({ addRows }) => {
      const stores = await prisma.store.findMany({
        where: { isActive: true },
        select: { id: true, name: true, accountId: true },
        orderBy: { name: "asc" },
      })

      // Proposal usage is attributed to the account's OWNER (the reviewer).
      const ownerByAccount = new Map<string, string | null>()
      async function ownerFor(accountId: string): Promise<string | null> {
        const cached = ownerByAccount.get(accountId)
        if (cached !== undefined) return cached
        const owner = await prisma.user.findFirst({
          where: { accountId, role: "OWNER" },
          select: { id: true },
        })
        ownerByAccount.set(accountId, owner?.id ?? null)
        return owner?.id ?? null
      }

      const perStore: Array<{
        storeId: string
        storeName: string
        created: number
        skippedExisting: number
        error?: string
      }> = []
      for (const store of stores) {
        const ownerId = await ownerFor(store.accountId)
        const r = await generateMappingProposalsCore(
          { accountId: store.accountId, ownerId },
          { storeId: store.id }
        )
        if (r.ok) {
          addRows(r.created)
          perStore.push({
            storeId: store.id,
            storeName: store.name,
            created: r.created,
            skippedExisting: r.skippedExisting,
          })
        } else {
          // "no_data" is normal for pre-open stores — record, don't fail.
          perStore.push({
            storeId: store.id,
            storeName: store.name,
            created: 0,
            skippedExisting: 0,
            error: r.error,
          })
        }
      }

      return { stores: perStore }
    }
  )

  return NextResponse.json(result)
})
