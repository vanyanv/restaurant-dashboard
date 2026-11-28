import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { attachDatabasePool } from '@vercel/functions'
import { Pool } from 'pg'
import { poolIdleMs } from '@/lib/pg-pool-idle'
import { after } from 'next/server'
import {
  bumpClosedGeneration,
  inScopedWrites,
  isFigureWrite,
  wroteNoRows,
} from '@/lib/cache/closed-range'
import { withUsageCount } from '@/lib/usage/prisma-count'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  pgPool: Pool | undefined
}

// Strip sslmode from the connection string. SSL is configured explicitly via
// `needsSsl` below, and leaving `sslmode=` in the URL makes pg-connection-string
// emit a deprecation warning on every boot.
const stripSslMode = (raw: string): string => {
  try {
    const url = new URL(raw)
    url.searchParams.delete('sslmode')
    return url.toString()
  } catch {
    return raw
  }
}

/**
 * SSL for every real host, and never for a local one.
 *
 * This was a bare `ssl: true`, which is right for Neon and makes a database on
 * localhost unreachable — a local Postgres does not speak TLS, so the
 * connection fails before it can be refused. That left the app with exactly
 * one database it could ever talk to: the production one. When Neon suspended
 * this project on 2026-09-02 for exceeding its data-transfer quota, there was
 * no way to run the product at all, and no way to develop against anything
 * else.
 *
 * Host-based rather than an env flag, because it is a fact about where the
 * database is rather than a preference someone has to remember to set — and a
 * flag that must be set correctly to avoid sending credentials in the clear is
 * a flag that will one day be set wrong. A hostname that will not parse falls
 * through to SSL, which is the safe direction.
 */
const needsSsl = (raw: string): boolean => {
  try {
    const host = new URL(raw).hostname
    return !(host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]')
  } catch {
    return true
  }
}

/**
 * Connections each server instance may hold open at once.
 *
 * Neon and Vercel both suggest a small per-instance pool on Neon's pooled
 * (`-pooler`) host. Measured here on 2026-11-20 (local Postgres behind a 20 ms
 * proxy, 5 loads per page, median): max 5 left Overview, P&L, Labor, Count,
 * Analytics and phone Overview within 1% of max 10 but made Decisions 13%
 * slower (1,095 -> 1,236 ms), because pages already have 20-47 queries in
 * flight at once. So this stays at node-postgres's 10 until the per-page
 * query counts come down; re-measure before lowering it.
 * `DATABASE_POOL_MAX` overrides it.
 */
const DEFAULT_POOL_MAX = 10
const poolMax = (): number => {
  const n = Number(process.env.DATABASE_POOL_MAX)
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_POOL_MAX
}

/**
 * The one `pg` pool per server instance. `src/lib/chat/prisma-chat.ts` builds
 * its client on this same pool, so `DATABASE_POOL_MAX` is the whole instance's
 * connection budget and `attachDatabasePool` covers every connection.
 */
export const getPgPool = (): Pool => {
  if (globalForPrisma.pgPool) return globalForPrisma.pgPool
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required')
  const pool = new Pool({
    connectionString: stripSslMode(databaseUrl),
    ssl: needsSsl(databaseUrl),
    max: poolMax(),
    // 2 s, not node-postgres's 10 s: on Vercel this is also how long each
    // instance is held open after its last query. See `@/lib/pg-pool-idle`.
    idleTimeoutMillis: poolIdleMs(),
  })
  // Closes idle clients before a Vercel function suspends, so a frozen
  // instance does not hold Neon pooler connections. Does nothing off Vercel.
  attachDatabasePool(pool)
  globalForPrisma.pgPool = pool
  return pool
}

const createPrismaClient = () => {
  // This client owns the pool: `$disconnect()` (scripts) ends it, so the
  // process exits without waiting out idle clients.
  const adapter = new PrismaPg(getPgPool(), { disposeExternalPool: true })

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development'
      ? ['query', 'error', 'warn']
      : ['error'],
  })
}

/**
 * `PRISMA_TRACE=1` prints one line per database round trip.
 *
 * A page's server time is round trips × latency, and nothing in the app could
 * see the first term. The perf sweep can time `/dashboard/decisions` at a
 * second of streamed HTML and say nothing about whether that is one slow query
 * or forty fast ones issued in a chain — which are opposite problems with
 * opposite fixes. This makes the count observable:
 *
 *   PRISMA_TRACE=1 npx next start -p 3100      # then read the server log
 *
 * `$allOperations` at the root sees model calls AND `$queryRaw`, so a page that
 * reaches for raw SQL is counted like any other. The `console.log` goes to the
 * server's stdout, one line each: elapsed ms, model, operation.
 *
 * Off by default and gated on an env var rather than NODE_ENV, because the
 * question "how many queries does this page make" is worth asking against a
 * production build — a development server answers a different question.
 */
const withTrace = (client: PrismaClient): PrismaClient => {
  if (process.env.PRISMA_TRACE !== "1") return client
  return client.$extends({
    query: {
      async $allOperations({ model, operation, args, query }) {
        const started = performance.now()
        try {
          return await query(args)
        } finally {
          const ms = (performance.now() - started).toFixed(1)
          console.log(`[q] ${ms}ms ${model ?? "raw"}.${operation}`)
        }
      },
    },
    // An extended client is a different TYPE but the same surface; every call
    // site here uses model methods, which the extension preserves.
  }) as unknown as PrismaClient
}

/**
 * Drops saved past-day figures when their data changes. See
 * `@/lib/cache/closed-range` for the scheme; this is the half that notices
 * writes.
 *
 * After a successful write to a figure model, bump the generation now, and
 * again once the request has finished (`after`). The second bump covers an
 * interactive transaction: the first fires before COMMIT, so a reader in that
 * window could save the old rows under the new generation. Outside a request
 * (a script) `after` throws and only the first bump happens.
 *
 * Writers inside `withScopedWrites` skip this; they bump once at the end if
 * they touched a closed day. A write whose result says it affected no row
 * (`$executeRaw` → 0, `*Many` → `{ count: 0 }`) skips it too: the change-only
 * sync upserts are mostly that, and nothing they did can stale a figure.
 */
const withClosedRangeBust = (client: PrismaClient): PrismaClient =>
  client.$extends({
    query: {
      async $allOperations({ model, operation, args, query }) {
        const result = await query(args)
        if (isFigureWrite(model, operation) && !inScopedWrites() && !wroteNoRows(result)) {
          await bumpClosedGeneration()
          try {
            after(bumpClosedGeneration)
          } catch {
            // Not inside a request.
          }
        }
        return result
      },
    },
  }) as unknown as PrismaClient

export const prisma =
  globalForPrisma.prisma ?? withTrace(withClosedRangeBust(withUsageCount(createPrismaClient())))

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
