/**
 * Bulk "write only what changed" upserts for the background syncs.
 *
 * Every sync re-reads a rolling window and used to upsert every row in it on
 * every run, so `@updatedAt` columns moved and Postgres wrote a new row
 * version each time even when no figure had changed (prod, 2026-11-20:
 * OtterMenuItem 326k updates on 37k rows, DailyCogsItem 476k on 21k). This
 * builds one `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE (...) IS DISTINCT
 * FROM (EXCLUDED...)` per chunk: a new row is inserted, a changed row is
 * updated (and its touch column moves), an unchanged row is not written at
 * all. `$executeRaw` returns inserted + updated, which is the "rows actually
 * changed" count the callers report and gate their cache busts on.
 *
 * Same shape as the OtterOrder upsert in `otter-orders-sync.ts`.
 *
 * Table and column names are module constants of the callers, never request
 * input, which is what makes the `Prisma.raw` identifiers below safe; every
 * value is a bound parameter with an explicit cast.
 *
 * `undefined` keeps Prisma's meaning: a value column that is `undefined` on a
 * row is left out of that row's INSERT (column default) and out of its UPDATE
 * (existing value kept). Rows are grouped by which columns they define, so the
 * usual case of every column defined is one statement per chunk.
 */
import { randomUUID } from "crypto"
import { Prisma } from "@/generated/prisma/client"

export type SqlColumnType =
  | "text"
  | "date"
  | "timestamp"
  | "float"
  | "int"
  | "bigint"
  | "boolean"
  | "jsonb"
  | "int[]"

export type ColumnSpec = { name: string; type: SqlColumnType }

export interface ChangedUpsertSpec {
  /** Real table name, as in prisma/schema.prisma (no @@map in this schema). */
  table: string
  /**
   * The columns of the unique constraint the ON CONFLICT targets — exactly the
   * constraint's column set. Written on insert, never updated.
   */
  conflict: readonly ColumnSpec[]
  /** Written on insert only; neither compared nor updated on conflict. */
  insertOnly?: readonly ColumnSpec[]
  /** Written on insert; compared, and updated when different, on conflict. */
  values: readonly ColumnSpec[]
  /**
   * Timestamp column set to `now` on insert and whenever the row changes
   * (`syncedAt` / `updatedAt`). Raw SQL does not run Prisma's `@updatedAt`.
   */
  touch: string
}

/** A row keyed by column name. `undefined` = not provided (see module doc). */
export type UpsertRow = Record<string, unknown>

/** Anything that can run `$executeRaw` — the client or a transaction client. */
export type RawExecutor = {
  $executeRaw: (query: Prisma.Sql) => Prisma.PrismaPromise<number>
}

export const DEFAULT_UPSERT_CHUNK = 1000

const CAST: Record<SqlColumnType, string> = {
  text: "text",
  date: "date",
  timestamp: "timestamp(3)",
  float: "double precision",
  int: "integer",
  bigint: "bigint",
  boolean: "boolean",
  jsonb: "jsonb",
  "int[]": "integer[]",
}

function ident(name: string): Prisma.Sql {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`upsert-changed: refusing identifier ${JSON.stringify(name)}`)
  }
  return Prisma.raw(`"${name}"`)
}

/** One bound parameter, cast to the column's type. */
export function castValue(value: unknown, type: SqlColumnType): Prisma.Sql {
  const cast = Prisma.raw(CAST[type])
  if (value === null || value === undefined) return Prisma.sql`NULL::${cast}`
  switch (type) {
    case "jsonb":
      // Prisma.JsonNull is JSON `null`, not SQL NULL — store it the way the
      // Prisma client did ('null'::jsonb).
      return Prisma.sql`${value === Prisma.JsonNull ? "null" : JSON.stringify(value)}::jsonb`
    case "bigint":
      return Prisma.sql`${String(value)}::bigint`
    default:
      // A Date goes out from the pg adapter as its UTC wall clock with no
      // zone, which is how the Prisma client writes date/timestamp columns.
      return Prisma.sql`${value}::${cast}`
  }
}

/**
 * The upsert statement for `rows`, all of which define the same set of value
 * columns (`definedValues`). Exported for the SQL-shape tests.
 */
export function buildChangedUpsertSql(
  spec: ChangedUpsertSpec,
  rows: readonly UpsertRow[],
  now: Date,
  definedValues: readonly ColumnSpec[] = spec.values,
): Prisma.Sql {
  if (rows.length === 0) throw new Error("upsert-changed: no rows")
  const insertCols: ColumnSpec[] = [
    ...spec.conflict,
    ...(spec.insertOnly ?? []),
    ...definedValues,
  ]
  const columnList = Prisma.join(
    [ident("id"), ...insertCols.map((c) => ident(c.name)), ident(spec.touch)],
    ", ",
  )
  const valuesList = Prisma.join(
    rows.map(
      (row) =>
        Prisma.sql`(${Prisma.join(
          [
            Prisma.sql`${randomUUID()}`,
            ...insertCols.map((c) => castValue(row[c.name], c.type)),
            castValue(now, "timestamp"),
          ],
          ", ",
        )})`,
    ),
    ",\n",
  )
  const conflictList = Prisma.join(spec.conflict.map((c) => ident(c.name)), ", ")

  if (definedValues.length === 0) {
    return Prisma.sql`
      INSERT INTO ${ident(spec.table)} AS t (${columnList})
      VALUES ${valuesList}
      ON CONFLICT (${conflictList}) DO NOTHING
    `
  }

  const setList = Prisma.join(
    [
      ...definedValues.map((c) => Prisma.sql`${ident(c.name)} = EXCLUDED.${ident(c.name)}`),
      Prisma.sql`${ident(spec.touch)} = EXCLUDED.${ident(spec.touch)}`,
    ],
    ", ",
  )
  const current = Prisma.join(definedValues.map((c) => Prisma.sql`t.${ident(c.name)}`), ", ")
  const incoming = Prisma.join(
    definedValues.map((c) => Prisma.sql`EXCLUDED.${ident(c.name)}`),
    ", ",
  )
  return Prisma.sql`
    INSERT INTO ${ident(spec.table)} AS t (${columnList})
    VALUES ${valuesList}
    ON CONFLICT (${conflictList}) DO UPDATE SET ${setList}
    WHERE ROW(${current}) IS DISTINCT FROM ROW(${incoming})
  `
}

/**
 * Group rows by which value columns they define, then split each group into
 * chunks. Each returned statement is independent (one atomic INSERT).
 */
export function planChangedUpserts(
  spec: ChangedUpsertSpec,
  rows: readonly UpsertRow[],
  opts: { now?: Date; chunkSize?: number } = {},
): Array<{ sql: Prisma.Sql; rowCount: number }> {
  const now = opts.now ?? new Date()
  const chunkSize = Math.max(1, opts.chunkSize ?? DEFAULT_UPSERT_CHUNK)
  const groups = new Map<string, { cols: ColumnSpec[]; rows: UpsertRow[] }>()
  for (const row of rows) {
    const cols = spec.values.filter((c) => row[c.name] !== undefined)
    const key = cols.map((c) => c.name).join(",")
    const group = groups.get(key) ?? { cols, rows: [] }
    group.rows.push(row)
    groups.set(key, group)
  }
  const out: Array<{ sql: Prisma.Sql; rowCount: number }> = []
  for (const { cols, rows: groupRows } of groups.values()) {
    for (let i = 0; i < groupRows.length; i += chunkSize) {
      const chunk = groupRows.slice(i, i + chunkSize)
      out.push({ sql: buildChangedUpsertSql(spec, chunk, now, cols), rowCount: chunk.length })
    }
  }
  return out
}

/**
 * Upsert `rows`, writing only new or changed ones. Returns how many rows were
 * inserted or updated. Throws on the first failing chunk.
 */
export async function upsertChangedRows(
  db: RawExecutor,
  spec: ChangedUpsertSpec,
  rows: readonly UpsertRow[],
  opts: { now?: Date; chunkSize?: number } = {},
): Promise<number> {
  let changed = 0
  for (const { sql } of planChangedUpserts(spec, rows, opts)) {
    changed += await db.$executeRaw(sql)
  }
  return changed
}

/**
 * Last occurrence wins, as sequential upserts did. One INSERT ... ON CONFLICT
 * statement cannot touch the same key twice ("ON CONFLICT DO UPDATE command
 * cannot affect row a second time"), so duplicates must go before the write.
 */
export function dedupeByKey<T>(rows: readonly T[], key: (row: T) => string): T[] {
  const byKey = new Map<string, T>()
  for (const row of rows) {
    const k = key(row)
    byKey.delete(k)
    byKey.set(k, row)
  }
  return [...byKey.values()]
}

/** One column's values as a bound array parameter, cast to `type[]`. */
function castArray(values: readonly unknown[], type: SqlColumnType): Prisma.Sql {
  const cast = Prisma.raw(`${CAST[type]}[]`)
  const out = values.map((v) => {
    if (v === null || v === undefined) return null
    // A @db.Date column compares on its calendar day; send "YYYY-MM-DD".
    if (type === "date" && v instanceof Date) return v.toISOString().slice(0, 10)
    if (v instanceof Date) return v.toISOString()
    return v
  })
  return Prisma.sql`${out}::${cast}`
}

/**
 * The reconcile half of a sync: DELETE the rows inside one fully fetched
 * scope that the fresh fetch no longer returned. Run it in the same
 * transaction as the upsert of `keep`, the way `hourly-sync.ts` reconciles
 * `OtterHourlySummary`, so readers never see the window half-replaced.
 *
 * - `where`: equality filters every deleted row must match (the store, and
 *   e.g. `isModifier`). Always include the tenant/store column.
 * - `dates`: the dates whose fetch fully succeeded. A date whose fetch failed
 *   or was truncated must be left out — its rows are kept.
 * - `key`: the columns that, together with `where`, identify a row (the rest
 *   of the unique constraint, including the date column). They must be
 *   NOT NULL columns: the match is `=`.
 * - `keep`: the rows just written; anything in scope not among them goes.
 *
 * Returns null when there is no date to reconcile. Three to six bound
 * parameters whatever the row count (arrays through `unnest`), so a 30-day
 * backfill chunk cannot run into the bind-parameter limit.
 */
export function buildDeleteMissingSql(opts: {
  table: string
  where: ReadonlyArray<{ column: ColumnSpec; value: unknown }>
  dates: { column: string; values: readonly (Date | string)[] }
  key: readonly ColumnSpec[]
  keep: readonly UpsertRow[]
}): Prisma.Sql | null {
  const { table, where, dates, key, keep } = opts
  if (dates.values.length === 0) return null
  if (key.length === 0) throw new Error("upsert-changed: delete-missing needs a key")
  const filters = [
    ...where.map(({ column, value }) => Prisma.sql`t.${ident(column.name)} = ${castValue(value, column.type)}`),
    Prisma.sql`t.${ident(dates.column)} = ANY(${castArray([...new Set(dates.values.map((d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d)))], "date")})`,
  ]
  const aliases = key.map((_, i) => ident(`k${i}`))
  const unnestArgs = Prisma.join(
    key.map((c) => castArray(keep.map((r) => r[c.name]), c.type)),
    ", ",
  )
  const match = Prisma.join(
    key.map((c, i) => Prisma.sql`t.${ident(c.name)} = k.${aliases[i]}`),
    " AND ",
  )
  return Prisma.sql`
    DELETE FROM ${ident(table)} AS t
    WHERE ${Prisma.join(filters, " AND ")}
      AND NOT EXISTS (
        SELECT 1 FROM unnest(${unnestArgs}) AS k(${Prisma.join(aliases, ", ")})
        WHERE ${match}
      )
  `
}

/**
 * Collapse rows that share a key by adding their numeric fields — for Otter
 * responses that return one row per Otter UUID when a store has two (menu
 * categories group by `store`). `dedupeByKey`'s last-wins would drop one
 * UUID's sales. A field that is null on every duplicate stays null.
 */
export function sumByKey<T extends { data: Record<string, number | null> }>(
  rows: readonly T[],
  key: (row: T) => string,
): T[] {
  const byKey = new Map<string, T>()
  for (const row of rows) {
    const k = key(row)
    const existing = byKey.get(k)
    if (!existing) {
      byKey.set(k, { ...row, data: { ...row.data } })
      continue
    }
    for (const [field, v] of Object.entries(row.data)) {
      if (v == null) continue
      const cur = existing.data[field]
      existing.data[field] = cur == null ? v : cur + v
    }
  }
  return [...byKey.values()]
}
