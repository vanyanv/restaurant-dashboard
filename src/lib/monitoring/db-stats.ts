import { unstable_cache } from "next/cache"
import { prisma } from "@/lib/prisma"

export type DbSize = {
  totalBytes: number
  capBytes: number
  pct: number
}

export type TableSize = {
  table: string
  bytes: number
  rows: number
}

export type DbConnections = {
  active: number
  max: number
}

const DEFAULT_CAP = 512 * 1024 * 1024 // Neon free tier

async function getDbSizeUncached(): Promise<DbSize> {
  const rows = await prisma.$queryRaw<{ size: bigint }[]>`
    SELECT pg_database_size(current_database())::bigint AS size
  `
  const totalBytes = Number(rows[0]?.size ?? 0)
  const capBytes = Number(process.env.NEON_STORAGE_CAP_BYTES ?? DEFAULT_CAP)
  return { totalBytes, capBytes, pct: capBytes > 0 ? (totalBytes / capBytes) * 100 : 0 }
}

export const getDbSize = unstable_cache(
  getDbSizeUncached,
  ["monitoring:db-size"],
  { revalidate: 30, tags: ["monitoring:db"] },
)

async function getTableSizesUncached(limit = 12): Promise<TableSize[]> {
  // pg_total_relation_size is computed once per row; ORDER BY references the
  // alias-equivalent expression so Postgres reuses the result.
  const rows = await prisma.$queryRaw<{ relname: string; bytes: bigint; rows: bigint }[]>`
    SELECT
      c.relname,
      pg_total_relation_size(c.oid)::bigint AS bytes,
      COALESCE(c.reltuples::bigint, 0::bigint) AS rows
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY pg_total_relation_size(c.oid) DESC
    LIMIT ${limit}
  `
  return rows.map((r) => ({ table: r.relname, bytes: Number(r.bytes), rows: Number(r.rows) }))
}

export const getTableSizes = unstable_cache(
  getTableSizesUncached,
  ["monitoring:table-sizes"],
  { revalidate: 60, tags: ["monitoring:db"] },
)

async function getConnectionsUncached(): Promise<DbConnections> {
  const rows = await prisma.$queryRaw<{ active: bigint; max: bigint }[]>`
    SELECT
      (SELECT COUNT(*)::bigint FROM pg_stat_activity WHERE datname = current_database()) AS active,
      (SELECT setting::bigint FROM pg_settings WHERE name = 'max_connections') AS max
  `
  return { active: Number(rows[0]?.active ?? 0), max: Number(rows[0]?.max ?? 0) }
}

export const getConnections = unstable_cache(
  getConnectionsUncached,
  ["monitoring:db-connections"],
  { revalidate: 10, tags: ["monitoring:db"] },
)
