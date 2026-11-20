// The change-only bulk upsert the background syncs share. These pin the SQL
// shape (the WHERE ... IS DISTINCT FROM that makes an unchanged row a no-op,
// the exact conflict target, the touch column set only through the UPDATE),
// Prisma's `undefined` = "leave it alone" semantics, chunking, and the
// last-wins de-duplication that one INSERT ... ON CONFLICT statement needs.
// The SQL itself was run against Postgres 16 (insert, re-run = 0 rows, one
// changed row = 1 row) when this landed; these tests keep its shape.

import { describe, it, expect, vi } from "vitest"
import { Prisma } from "@/generated/prisma/client"
import {
  buildChangedUpsertSql,
  castValue,
  buildDeleteMissingSql,
  dedupeByKey,
  sumByKey,
  planChangedUpserts,
  upsertChangedRows,
  type ChangedUpsertSpec,
} from "@/lib/upsert-changed"

const SPEC: ChangedUpsertSpec = {
  table: "OtterMenuItem",
  conflict: [
    { name: "storeId", type: "text" },
    { name: "date", type: "date" },
    { name: "isModifier", type: "boolean" },
  ],
  insertOnly: [{ name: "createdBy", type: "text" }],
  values: [
    { name: "qty", type: "float" },
    { name: "note", type: "text" },
  ],
  touch: "syncedAt",
}

const DATE = new Date("2026-11-18T00:00:00.000Z")
const NOW = new Date("2026-11-20T10:00:00.000Z")
const flat = (s: Prisma.Sql) => s.sql.replace(/\s+/g, " ")

describe("buildChangedUpsertSql", () => {
  it("only updates a row whose compared columns differ, and moves the touch column only then", () => {
    const sql = buildChangedUpsertSql(SPEC, [{ storeId: "s", date: DATE, isModifier: false, createdBy: "x", qty: 1, note: null }], NOW)
    const text = flat(sql)
    expect(text).toContain(`INSERT INTO "OtterMenuItem" AS t ("id", "storeId", "date", "isModifier", "createdBy", "qty", "note", "syncedAt")`)
    expect(text).toContain(`ON CONFLICT ("storeId", "date", "isModifier") DO UPDATE SET "qty" = EXCLUDED."qty", "note" = EXCLUDED."note", "syncedAt" = EXCLUDED."syncedAt"`)
    expect(text).toContain(`WHERE ROW(t."qty", t."note") IS DISTINCT FROM ROW(EXCLUDED."qty", EXCLUDED."note")`)
    // insert-only columns are neither updated nor compared
    expect(text).not.toContain(`"createdBy" = EXCLUDED`)
    expect(text).not.toContain(`t."createdBy"`)
  })

  it("binds every value as a cast parameter", () => {
    const sql = buildChangedUpsertSql(SPEC, [{ storeId: "s", date: DATE, isModifier: true, createdBy: "x", qty: 2.5, note: "n" }], NOW)
    expect(sql.text.replace(/\s+/g, " ")).toMatch(/\(\$1, \$2::text, \$3::date, \$4::boolean, \$5::text, \$6::double precision, \$7::text, \$8::timestamp\(3\)\)/)
    expect(sql.values.slice(1)).toEqual(["s", DATE, true, "x", 2.5, "n", NOW])
  })

  it("refuses an identifier that is not a plain name", () => {
    expect(() =>
      buildChangedUpsertSql({ ...SPEC, table: `X"; DROP TABLE "Store` }, [{}], NOW),
    ).toThrow(/refusing identifier/)
  })
})

describe("castValue", () => {
  it("writes Prisma.JsonNull as JSON null and null as SQL NULL", () => {
    expect(castValue(Prisma.JsonNull, "jsonb").values).toEqual(["null"])
    expect(castValue({ a: 1 }, "jsonb").values).toEqual([`{"a":1}`])
    expect(castValue(null, "jsonb").sql).toBe("NULL::jsonb")
  })

  it("sends bigints as text so ids past 2^53 survive", () => {
    expect(castValue("9007199254740993", "bigint").values).toEqual(["9007199254740993"])
  })
})

describe("planChangedUpserts", () => {
  it("leaves an undefined column out of that row's insert and update, as Prisma did", () => {
    const plans = planChangedUpserts(SPEC, [
      { storeId: "s", date: DATE, isModifier: false, qty: 1, note: "a" },
      { storeId: "s", date: DATE, isModifier: true, qty: 2 },
    ], { now: NOW })
    expect(plans).toHaveLength(2)
    const second = flat(plans[1].sql)
    expect(second).not.toContain(`"note"`)
    expect(second).toContain(`WHERE ROW(t."qty") IS DISTINCT FROM ROW(EXCLUDED."qty")`)
  })

  it("chunks large inputs", () => {
    const rows = Array.from({ length: 2501 }, (_, i) => ({ storeId: `s${i}`, date: DATE, isModifier: false, qty: i, note: null }))
    expect(planChangedUpserts(SPEC, rows).map((p) => p.rowCount)).toEqual([1000, 1000, 501])
  })
})

describe("upsertChangedRows", () => {
  it("returns the rows the database reports as inserted or updated", async () => {
    const db = { $executeRaw: vi.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(0) }
    const rows = Array.from({ length: 4 }, (_, i) => ({ storeId: `s${i}`, date: DATE, isModifier: false, qty: i, note: null }))
    const changed = await upsertChangedRows(db as never, SPEC, rows, { chunkSize: 2 })
    expect(changed).toBe(3)
    expect(db.$executeRaw).toHaveBeenCalledTimes(2)
  })

  it("does nothing for no rows", async () => {
    const db = { $executeRaw: vi.fn() }
    expect(await upsertChangedRows(db as never, SPEC, [])).toBe(0)
    expect(db.$executeRaw).not.toHaveBeenCalled()
  })
})

describe("dedupeByKey", () => {
  it("keeps the last occurrence, as sequential upserts did", () => {
    expect(dedupeByKey([{ k: "a", v: 1 }, { k: "b", v: 2 }, { k: "a", v: 3 }], (r) => r.k)).toEqual([
      { k: "b", v: 2 },
      { k: "a", v: 3 },
    ])
  })
})

describe("sumByKey", () => {
  it("adds numeric fields of rows that share a key; null only when every duplicate is null", () => {
    const out = sumByKey(
      [
        { k: "a", data: { qty: 2, sales: null as number | null } },
        { k: "b", data: { qty: 1, sales: 5 } },
        { k: "a", data: { qty: 3, sales: null } },
        { k: "b", data: { qty: 1, sales: 2 } },
      ],
      (r) => r.k,
    )
    expect(out).toEqual([
      { k: "a", data: { qty: 5, sales: null } },
      { k: "b", data: { qty: 2, sales: 7 } },
    ])
  })
})

describe("buildDeleteMissingSql", () => {
  const key = [
    { name: "date", type: "date" as const },
    { name: "category", type: "text" as const },
  ]
  const DAY = new Date("2026-05-01T00:00:00.000Z")

  it("deletes, within the store and the given dates, every row not among the kept keys", () => {
    const sql = buildDeleteMissingSql({
      table: "OtterMenuCategory",
      where: [{ column: { name: "storeId", type: "text" }, value: "s1" }],
      dates: { column: "date", values: ["2026-05-01", "2026-05-02", "2026-05-01"] },
      key,
      keep: [
        { storeId: "s1", date: DAY, category: "Sliders" },
        { storeId: "s1", date: DAY, category: "Drinks" },
      ],
    })!
    expect(flat(sql)).toBe(
      ` DELETE FROM "OtterMenuCategory" AS t WHERE t."storeId" = ?::text AND t."date" = ANY(?::date[]) ` +
        `AND NOT EXISTS ( SELECT 1 FROM unnest(?::date[], ?::text[]) AS k("k0", "k1") ` +
        `WHERE t."date" = k."k0" AND t."category" = k."k1" ) `,
    )
    // three or so parameters whatever the row count; dates de-duplicated
    expect(sql.values).toEqual([
      "s1",
      ["2026-05-01", "2026-05-02"],
      ["2026-05-01", "2026-05-01"],
      ["Sliders", "Drinks"],
    ])
  })

  it("clears the scope when the fetch came back empty, and does nothing without dates", () => {
    const empty = buildDeleteMissingSql({
      table: "OtterMenuCategory",
      where: [{ column: { name: "storeId", type: "text" }, value: "s1" }],
      dates: { column: "date", values: ["2026-05-01"] },
      key,
      keep: [],
    })!
    expect(empty.values).toEqual(["s1", ["2026-05-01"], [], []])
    expect(
      buildDeleteMissingSql({
        table: "OtterMenuCategory",
        where: [{ column: { name: "storeId", type: "text" }, value: "s1" }],
        dates: { column: "date", values: [] },
        key,
        keep: [],
      }),
    ).toBeNull()
  })
})
