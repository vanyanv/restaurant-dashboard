import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
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

const createPrismaClient = () => {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required')
  const adapter = new PrismaPg({
    connectionString: stripSslMode(databaseUrl),
    ssl: needsSsl(databaseUrl),
  })

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

export const prisma = globalForPrisma.prisma ?? withTrace(createPrismaClient())

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
