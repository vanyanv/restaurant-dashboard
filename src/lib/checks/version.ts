import { createHash } from "node:crypto"
import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import type { CrewStore } from "./crew"
import { addDays, CHECK_KINDS, todayLA, windowPhase, type CheckKindName, type CheckWindow } from "./time"

/**
 * A fingerprint of everything the crew page shows for one store, in one
 * small query, so the page's refresh can skip loading the whole view when
 * nothing has changed (`/api/checks/[code]/state?v=`).
 *
 * It must change whenever the crew view could. Two halves:
 *
 *   - the database: the store's name and stage, its checklists (template
 *     rows, every section and task row), and every mark, record, start and
 *     closure for the days the view covers (yesterday and today), plus the
 *     pauses the grid reads. Rows are hashed whole (`row::text`), so an
 *     owner's edit to any column (a record's content, a mark's review)
 *     changes it, as does a deleted row.
 *   - the clock: the business day, and where `now` sits in each check's
 *     window for yesterday and today (`windowPhase`). Every time-driven
 *     change in the view (a list opening, Submit unlocking, a window going
 *     late or closing, the day rolling over) is one of those changing.
 *
 * When unsure whether something shows, it is in: a spare reload costs one
 * view load, a missing one leaves a phone stale.
 */

export type CheckStateFingerprint = { store: CrewStore; version: string }

type Row = {
  id: string
  name: string
  accountId: string
  stage: string
  templates: Array<{
    kind: CheckKindName
    opensAtMin: number
    submitFromMin: number | null
    dueAtMin: number
    dueByWeekday: number[] | null
    graceMin: number
    thanksgivingOff: boolean
    thanksgivingOpensMin: number | null
    thanksgivingDueMin: number | null
    enabled: boolean
  }>
  db: string
}

/** One query: the store (by its public code, or by id within an account) and its check-state hash. */
async function fingerprintRow(storeWhere: Prisma.Sql, fromDay: string, toDay: string): Promise<Row | null> {
  const rows = await prisma.$queryRaw<Row[]>`
    WITH st AS (
      SELECT s.id, s.name, s."accountId", s."lifecycleStage"::text AS stage
      FROM "Store" s
      WHERE ${storeWhere} AND s."isActive" = true
      LIMIT 1
    )
    SELECT
      st.id, st.name, st."accountId", st.stage,
      (SELECT coalesce(json_agg(json_build_object(
          'kind', t.kind, 'opensAtMin', t."opensAtMin", 'submitFromMin', t."submitFromMin",
          'dueAtMin', t."dueAtMin", 'dueByWeekday', t."dueByWeekday", 'graceMin', t."graceMin",
          'thanksgivingOff', t."thanksgivingOff", 'thanksgivingOpensMin', t."thanksgivingOpensMin",
          'thanksgivingDueMin', t."thanksgivingDueMin", 'enabled', t.enabled) ORDER BY t.kind), '[]'::json)
        FROM "CheckTemplate" t WHERE t."storeId" = st.id) AS templates,
      md5(concat_ws('#',
        concat('t:', (SELECT string_agg(t::text, '|' ORDER BY t.id) FROM "CheckTemplate" t WHERE t."storeId" = st.id)),
        concat('s:', (SELECT string_agg(sec::text, '|' ORDER BY sec.id)
           FROM "CheckSection" sec JOIN "CheckTemplate" t ON t.id = sec."templateId"
           WHERE t."storeId" = st.id)),
        concat('i:', (SELECT string_agg(i::text, '|' ORDER BY i.id)
           FROM "CheckItem" i JOIN "CheckSection" sec ON sec.id = i."sectionId"
           JOIN "CheckTemplate" t ON t.id = sec."templateId"
           WHERE t."storeId" = st.id)),
        concat('m:', (SELECT string_agg(m::text, '|' ORDER BY m.id) FROM "CheckMark" m
           WHERE m."storeId" = st.id AND m."businessDate" BETWEEN ${fromDay}::date AND ${toDay}::date)),
        concat('b:', (SELECT string_agg(x::text, '|' ORDER BY x.id) FROM "CheckSubmission" x
           WHERE x."storeId" = st.id AND x."businessDate" BETWEEN ${fromDay}::date AND ${toDay}::date)),
        concat('x:', (SELECT string_agg(x::text, '|' ORDER BY x.id) FROM "CheckStart" x
           WHERE x."storeId" = st.id AND x."businessDate" BETWEEN ${fromDay}::date AND ${toDay}::date)),
        concat('c:', (SELECT string_agg(x::text, '|' ORDER BY x.id) FROM "CheckClosure" x
           WHERE x."storeId" = st.id AND x."businessDate" BETWEEN ${fromDay}::date AND ${toDay}::date)),
        concat('p:', (SELECT string_agg(x::text, '|' ORDER BY x.id) FROM "CheckPause" x
           WHERE x."storeId" = st.id AND (x."resumedAt" IS NULL OR x."resumedAt" >= ${fromDay}::timestamp)))
      )) AS db
    FROM st
  `
  return rows[0] ?? null
}

/** Where `now` sits in each check's windows: the clock half of the version. */
export function clockKey(templates: Row["templates"], now: Date): string {
  const today = todayLA(now)
  const days = [addDays(today, -1), today]
  const parts = [today]
  for (const kind of CHECK_KINDS) {
    const t = templates.find((x) => x.kind === kind)
    if (!t) continue
    const w: CheckWindow = { ...t, dueByWeekday: t.dueByWeekday ?? [] }
    parts.push(`${kind}:${days.map((d) => windowPhase(d, w, now)).join(",")}`)
  }
  return parts.join(";")
}

function versionOf(row: Row, now: Date): string {
  return createHash("sha1")
    .update(`${row.name}\n${row.stage}\n${row.db}\n${clockKey(row.templates, now)}`)
    .digest("base64url")
    .slice(0, 20)
}

function dayRange(now: Date) {
  const today = todayLA(now)
  return { fromDay: addDays(today, -1), toDay: today }
}

/** The crew page's refresh: the store behind a public code and its version, in one query. Null for an unknown or inactive code. */
export async function checkStateByCode(code: string, now: Date): Promise<CheckStateFingerprint | null> {
  if (!/^[a-z0-9-]{3,64}$/.test(code)) return null
  const { fromDay, toDay } = dayRange(now)
  const row = await fingerprintRow(Prisma.sql`s."checkCode" = ${code}`, fromDay, toDay)
  if (!row) return null
  return { store: { id: row.id, name: row.name, accountId: row.accountId }, version: versionOf(row, now) }
}

/** The version of a store already found, filtered by its account. Empty when the store is gone. */
export async function checkStateVersion(store: CrewStore, now: Date): Promise<string> {
  const { fromDay, toDay } = dayRange(now)
  const row = await fingerprintRow(Prisma.sql`s.id = ${store.id} AND s."accountId" = ${store.accountId}`, fromDay, toDay)
  return row ? versionOf(row, now) : ""
}
