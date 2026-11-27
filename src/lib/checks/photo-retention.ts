import { prisma } from "@/lib/prisma"
import { checkThumbKey, deleteCheckObjects } from "@/lib/blob"
import { MIN_PHOTO_KEEP_DAYS } from "@/lib/checks/photo-keep"

const BATCH = 500
// One night's tail is a few dozen photos; the cap only matters for a first
// pass over a backlog, which the next nights finish.
const MAX_BATCHES = 10

export type PhotoPurgeOutcome = { accountId: string; keepDays: number; photos: number; capped: boolean }

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
    let photos = 0
    let capped = true
    for (let b = 0; b < MAX_BATCHES; b++) {
      const [marks, sections] = await Promise.all([
        prisma.checkMark.findMany({
          where: { store: { accountId: a.id }, photoKey: { not: null }, photoPurgedAt: null, at: { lt: cutoff } },
          select: { photoKey: true },
          orderBy: { at: "asc" },
          take: BATCH,
        }),
        prisma.checkPhoto.findMany({
          where: { submission: { store: { accountId: a.id } }, purgedAt: null, createdAt: { lt: cutoff } },
          select: { storageKey: true },
          orderBy: { createdAt: "asc" },
          take: BATCH,
        }),
      ])
      const keys = [...new Set([...marks.map((m) => m.photoKey!), ...sections.map((s) => s.storageKey)])]
      if (keys.length === 0) {
        capped = false
        break
      }
      const gone = await deleteCheckObjects(keys.flatMap((k) => [k, checkThumbKey(k)]))
      // Both copies must be gone before the row says so.
      const done = keys.filter((k) => gone.has(k) && gone.has(checkThumbKey(k)))
      if (done.length === 0) throw new Error(`check photo delete failed for ${keys.length} photos`)
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
      photos += done.length
      if (done.length < keys.length) throw new Error(`${keys.length - done.length} check photos could not be deleted`)
      if (marks.length < BATCH && sections.length < BATCH) {
        capped = false
        break
      }
    }
    out.push({ accountId: a.id, keepDays, photos, capped })
  }
  return out
}
