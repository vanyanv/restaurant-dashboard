import { prisma } from "@/lib/prisma"

type Counter = { hits: number; misses: number; writes: number; busts: number; failures: number }

const counters = new Map<string, Counter>()

const FLUSH_EVERY_OPS = 200
let opsSinceFlush = 0

function getOrCreate(prefix: string): Counter {
  let c = counters.get(prefix)
  if (!c) {
    c = { hits: 0, misses: 0, writes: 0, busts: 0, failures: 0 }
    counters.set(prefix, c)
  }
  return c
}

function maybeFlush() {
  opsSinceFlush++
  if (opsSinceFlush >= FLUSH_EVERY_OPS) {
    void flushCacheStats()
  }
}

export function bumpHit(prefix: string)     { getOrCreate(prefix).hits++;     maybeFlush() }
export function bumpMiss(prefix: string)    { getOrCreate(prefix).misses++;   maybeFlush() }
export function bumpWrite(prefix: string)   { getOrCreate(prefix).writes++;   maybeFlush() }
export function bumpBust(prefix: string)    { getOrCreate(prefix).busts++;    maybeFlush() }
export function bumpFailure(prefix: string) { getOrCreate(prefix).failures++; maybeFlush() }

/**
 * Upsert all in-process counters into CacheStat. Called from the 10-min
 * cron and opportunistically every FLUSH_EVERY_OPS operations. Snapshots
 * + clears the in-process map atomically before doing DB work, so
 * concurrent bumps during the flush land in the next bucket.
 *
 * On per-prefix failure, restores that prefix's counts so the next pass
 * retries — counts are never lost to a transient DB blip.
 */
export async function flushCacheStats(): Promise<{ flushed: number }> {
  if (counters.size === 0) return { flushed: 0 }

  const snapshot = new Map(counters)
  counters.clear()
  opsSinceFlush = 0

  const hour = new Date()
  hour.setMinutes(0, 0, 0)

  let flushed = 0
  for (const [prefix, c] of snapshot) {
    try {
      await prisma.cacheStat.upsert({
        where: { hourBucket_keyPrefix: { hourBucket: hour, keyPrefix: prefix } },
        create: { hourBucket: hour, keyPrefix: prefix, ...c },
        update: {
          hits:     { increment: c.hits },
          misses:   { increment: c.misses },
          writes:   { increment: c.writes },
          busts:    { increment: c.busts },
          failures: { increment: c.failures },
        },
      })
      flushed++
    } catch (err) {
      console.error("[cache-stats] flush failed for", prefix, err)
      // Restore counts so we don't lose them on the next pass
      const restore = getOrCreate(prefix)
      restore.hits     += c.hits
      restore.misses   += c.misses
      restore.writes   += c.writes
      restore.busts    += c.busts
      restore.failures += c.failures
    }
  }
  return { flushed }
}

/**
 * "pnl:account:xyz" → "pnl". For ungrouped keys (no colon), the whole key
 * is the prefix. Used to bucket counters by namespace.
 */
export function prefixOf(cacheKey: string): string {
  const idx = cacheKey.indexOf(":")
  return idx > 0 ? cacheKey.slice(0, idx) : cacheKey
}
