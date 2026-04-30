import { prisma } from "@/lib/prisma"

export type DbSize = {
  totalBytes: number
  capBytes: number
  pct: number
}

export type TableSize = {
  table: string
  bytes: number
  rows: bigint
}

export type DbConnections = {
  active: number
  max: number
}

const DEFAULT_CAP = 512 * 1024 * 1024 // Neon free tier

export async function getDbSize(): Promise<DbSize> {
  const rows = await prisma.$queryRaw<{ size: bigint }[]>`
    SELECT pg_database_size(current_database())::bigint AS size
  `
  const totalBytes = Number(rows[0]?.size ?? 0)
  const capBytes = Number(process.env.NEON_STORAGE_CAP_BYTES ?? DEFAULT_CAP)
  return { totalBytes, capBytes, pct: capBytes > 0 ? (totalBytes / capBytes) * 100 : 0 }
}

export async function getTableSizes(limit = 12): Promise<TableSize[]> {
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
  return rows.map((r) => ({ table: r.relname, bytes: Number(r.bytes), rows: r.rows }))
}

export async function getConnections(): Promise<DbConnections> {
  const rows = await prisma.$queryRaw<{ active: bigint; max: bigint }[]>`
    SELECT
      (SELECT COUNT(*)::bigint FROM pg_stat_activity WHERE datname = current_database()) AS active,
      (SELECT setting::bigint FROM pg_settings WHERE name = 'max_connections') AS max
  `
  return { active: Number(rows[0]?.active ?? 0), max: Number(rows[0]?.max ?? 0) }
}
