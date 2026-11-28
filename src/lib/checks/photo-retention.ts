import { prisma } from "@/lib/prisma"
import { checkThumbKey, deleteCheckObjects } from "@/lib/blob"
import { MIN_PHOTO_KEEP_DAYS } from "@/lib/checks/photo-keep"

const BATCH = 500
// One night's tail is a few dozen photos; the cap only matters for a first
// pass over a backlog, which the next nights finish.
const MAX_BATCHES = 10

export type PhotoPurgeOutcome = {
  accountId: string
  keepDays: number
  /** Photos deleted and stamped this run. */
  photos: number
  /** Photos storage would not delete; they keep their rows and the next night retries. */
  failed: number
  capped: boolean
  error?: string
}

/**
 * Delete crew check photos older than each account's `checkPhotoKeepDays`
 * from storage, with their small copies, and stamp the rows so the dashboard
 * says "removed" instead of showing a broken image. The check records, ticks
 * and notes stay. An account with no keep set (null) is left alone.
 *
 * A photo lives on a task mark (`CheckMark.photoKey`) and, once the check
 * closes, on a `CheckPhoto` row with the same key, so each key is deleted once
 * and every row holding it is stamped together. A row is stamped only after
 * storage confirms its file is gone.
 *
 * `accountId` limits the sweep to one account (an owner running it by hand);
 * null is the nightly run over every account.
 */
export async function purgeOldCheckPhotos(opts: { now: Date; accountId: string | null }): Promise<PhotoPurgeOutcome[]> {
  const accounts = await prisma.account.findMany({
    where: { checkPhotoKeepDays: { not: null }, ...(opts.accountId ? { id: opts.accountId } : {}) },
    select: { id: true, checkPhotoKeepDays: true },
  })
  const out: PhotoPurgeOutcome[] = []
  for (const a of accounts) {
    const keepDays = Math.max(MIN_PHOTO_KEEP_DAYS, a.checkPhotoKeepDays!)
    const cutoff = new Date(opts.now.getTime() - keepDays * 24 * 60 * 60 * 1000)
    const outcome: PhotoPurgeOutcome = { accountId: a.id, keepDays, photos: 0, failed: 0, capped: true }
    // Keys storage refused this run, skipped by later batches so they can't
    // hold up the rest.
    const failed: string[] = []
    try {
      for (let b = 0; b < MAX_BATCHES; b++) {
        const [marks, sections] = await Promise.all([
          prisma.checkMark.findMany({
            where: {
              store: { accountId: a.id },
              photoKey: { not: null, notIn: failed },
              photoPurgedAt: null,
              at: { lt: cutoff },
            },
            select: { photoKey: true },
            orderBy: { at: "asc" },
            take: BATCH,
          }),
          prisma.checkPhoto.findMany({
            where: { submission: { store: { accountId: a.id } }, storageKey: { notIn: failed }, purgedAt: null, createdAt: { lt: cutoff } },
            select: { storageKey: true },
            orderBy: { createdAt: "asc" },
            take: BATCH,
          }),
        ])
        const keys = [...new Set([...marks.map((m) => m.photoKey!), ...sections.map((s) => s.storageKey)])]
        if (keys.length === 0) {
          outcome.capped = false
          break
        }
        const gone = await deleteCheckObjects(keys.flatMap((k) => [k, checkThumbKey(k)]))
        // Both copies must be gone before the row says so.
        const done = keys.filter((k) => gone.has(k) && gone.has(checkThumbKey(k)))
        for (const k of keys) if (!done.includes(k)) failed.push(k)
        if (done.length > 0) {
          await prisma.$transaction([
            prisma.checkMark.updateMany({
              where: { store: { accountId: a.id }, photoKey: { in: done }, photoPurgedAt: null },
              data: { photoPurgedAt: opts.now },
            }),
            prisma.checkPhoto.updateMany({
              where: { submission: { store: { accountId: a.id } }, storageKey: { in: done }, purgedAt: null },
              data: { purgedAt: opts.now },
            }),
          ])
        }
        outcome.photos += done.length
        if (marks.length < BATCH && sections.length < BATCH) {
          outcome.capped = false
          break
        }
      }
    } catch (err) {
      // One account's trouble doesn't stop the others; the route reports it.
      outcome.error = err instanceof Error ? err.message : String(err)
    }
    outcome.failed = failed.length
    out.push(outcome)
  }
  return out
}
