import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withCronAuth } from "@/lib/cron-auth"
import { withJobRun } from "@/lib/monitoring/job-run"
import { generateMappingProposalsCore } from "@/lib/mapping-proposals-core"
import { JobStatus, Prisma } from "@/generated/prisma/client"

/**
 * Post-sync proposal generation: after each Otter sync, surface new unmapped
 * POS items as PENDING RecipeMappingProposal rows so they are waiting in the
 * review sheet instead of requiring a manual button press. Layer-0 exact-name
 * matching resolves most items with no LLM call; only genuinely fuzzy new
 * items reach gpt-4.1-mini (and repeat runs skip everything already
 * PENDING/REJECTED, so routine runs cost nothing). Writes are proposals
 * only — a human Accept is still the only path to an OtterItemMapping.
 */

// This route shipped with no `maxDuration`, so it ran on Vercel's 10s default
// while every sibling cron route declares its own (30s–300s). Walking every
// active store — each a `computeRecipeSuggestions` pass plus a possible
// gpt-4.1-mini call — does not fit in 10s, so from at least 2026-09-13 every
// `Otter Daily Sync` run ended `HTTP 504 FUNCTION_INVOCATION_TIMEOUT` after
// ~11s with nothing written, and the next run faced the same work. Same shape
// as the 2026-09-11 invoice-sync incident, and the same remedy: declare the
// budget, bound the work, defer the rest.
export const maxDuration = 120

// Per-run work budget. Stores are walked in a rotation that resumes after the
// last store a run completed, so a budget that only reaches some of them still
// serves every store across consecutive runs rather than re-walking the same
// prefix. Whatever is not started is reported as `deferred` and recorded on the
// JobRun row. The gap to maxDuration is headroom for the store in flight when
// the deadline passes — it is not interrupted.
const STORE_BUDGET_MS = 75_000

/** The last store a previous run completed, from its JobRun.metadata. */
function readLastStoreId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const v = (metadata as Record<string, unknown>).lastStoreId
  return typeof v === "string" && v.length > 0 ? v : null
}

/**
 * withJobRun only writes metadata at create, so the rotation cursor and the
 * deferred count are written back here, on the row it created.
 *
 * A failure here is deliberately not swallowed. This is the only writer of
 * `lastStoreId`, so losing the write loses the rotation: the row would still
 * close as SUCCESS, carrying the metadata it was created with (none), and the
 * next run would read no cursor and re-walk the same prefix — which under a
 * 75s budget is how the tail of the list starves, the failure this whole
 * route exists to fix. Letting it throw makes withJobRun record FAILURE
 * instead, and `findFirst` below only reads SUCCESS/PARTIAL rows, so the next
 * run falls back to the last cursor that was actually written.
 */
async function recordProgress(
  jobRunId: string,
  deferred: number,
  lastStoreId: string | null,
): Promise<void> {
  await prisma.jobRun.update({
    where: { id: jobRunId },
    data: { metadata: { deferred, lastStoreId } as Prisma.InputJsonValue },
  })
}

export const GET = withCronAuth(async () => {
  const result = await withJobRun(
    "proposals.generate",
    { triggeredBy: "github-actions" },
    async ({ jobRunId, addRows }) => {
      const stores = await prisma.store.findMany({
        where: { isActive: true },
        select: { id: true, name: true, accountId: true },
        orderBy: { name: "asc" },
      })

      // Resume after the last store the previous run finished. `findIndex`
      // returns -1 for a store that has since been deactivated or renamed out
      // of position, which starts the rotation from the top — correct, not an
      // error.
      const previous = await prisma.jobRun.findFirst({
        where: {
          jobName: "proposals.generate",
          status: { in: [JobStatus.SUCCESS, JobStatus.PARTIAL] },
        },
        orderBy: { startedAt: "desc" },
        select: { metadata: true },
      })
      const resumeAfter = readLastStoreId(previous?.metadata)
      const startAt = resumeAfter
        ? stores.findIndex((s) => s.id === resumeAfter) + 1
        : 0
      const ordered = [...stores.slice(startAt), ...stores.slice(0, startAt)]

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
      const deadlineAt = Date.now() + STORE_BUDGET_MS
      let lastStoreId: string | null = null
      let deferred = 0

      for (const store of ordered) {
        if (Date.now() >= deadlineAt) {
          deferred++
          continue
        }
        try {
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
        } catch (err) {
          // The core turns an OpenAI failure into empty drafts, but a Prisma
          // or config failure still rejects. Uncaught, it would leave the loop
          // before recordProgress and take the whole rotation with it: the run
          // closes FAILURE, the next one resumes from the older cursor, and
          // the store that threw gets retried first every time while the tail
          // is never reached. Recorded per-store, the walk continues.
          perStore.push({
            storeId: store.id,
            storeName: store.name,
            created: 0,
            skippedExisting: 0,
            error: err instanceof Error ? err.message : String(err),
          })
        }
        // A store that errored still advances the rotation; otherwise one
        // permanently failing store would pin every later run to itself.
        lastStoreId = store.id
      }

      await recordProgress(jobRunId, deferred, lastStoreId)

      return { stores: perStore, deferred }
    }
  )

  return NextResponse.json(result)
})
