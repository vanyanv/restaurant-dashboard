import { Client } from "pg"

/**
 * Test data for the crew checks page, written straight to the e2e database.
 *
 * The demo seed has no store checks: no check link, no crew, no lists. This
 * gives the first demo store a link, one crew member with a known PIN, and
 * pauses its checks so the page is in practice mode, which keeps a check open
 * at any hour (a real window would make the test pass or fail by time of day).
 * The lists themselves are created by the page on first load, as in production.
 *
 * Never point this at a real database: it refuses any host but localhost.
 */
export const CREW_CODE = "e2e-crew-checks"
export const CREW_PIN = "4826"
export const CREW_NAME = "Test"

async function client(): Promise<Client> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set for the crew e2e tests")
  const host = new URL(url).hostname
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(`Refusing to write crew test data to ${host}; the crew tests only run against a local database`)
  }
  const c = new Client({ connectionString: url })
  await c.connect()
  return c
}

export async function setUpCrewStore(): Promise<{ storeId: string }> {
  const db = await client()
  try {
    const found = await db.query<{ id: string }>(
      `SELECT id FROM "Store" WHERE "checkCode" = $1
       UNION ALL (SELECT id FROM "Store" ORDER BY "createdAt" ASC LIMIT 1)
       LIMIT 1`,
      [CREW_CODE],
    )
    const storeId = found.rows[0]?.id
    if (!storeId) throw new Error("No store in the e2e database; run npm run db:seed first")
    // A pre-open store has no checks at all; the demo seed leaves stores pre-open.
    await db.query(
      `UPDATE "Store" SET "checkCode" = $2, "lifecycleStage" = 'ready' WHERE id = $1`,
      [storeId, CREW_CODE],
    )
    await db.query(
      `INSERT INTO "CrewMember" (id, "storeId", source, "firstName", pin, active, "updatedAt")
       VALUES (gen_random_uuid()::text, $1, 'MANUAL', $2, $3, true, now())
       ON CONFLICT ("storeId", pin) DO UPDATE SET active = true, "inactiveReason" = NULL, "firstName" = $2`,
      [storeId, CREW_NAME, CREW_PIN],
    )
    await db.query(
      `INSERT INTO "CheckPause" (id, "storeId")
       SELECT gen_random_uuid()::text, $1
       WHERE NOT EXISTS (SELECT 1 FROM "CheckPause" WHERE "storeId" = $1 AND "resumedAt" IS NULL)`,
      [storeId],
    )
    return { storeId }
  } finally {
    await db.end()
  }
}

/** Clear every tick so each test starts from an empty list. */
export async function clearCrewMarks(storeId: string): Promise<void> {
  const db = await client()
  try {
    for (const table of ["CheckMark", "CheckSubmission", "CheckStart"]) {
      await db.query(`DELETE FROM "${table}" WHERE "storeId" = $1`, [storeId])
    }
  } finally {
    await db.end()
  }
}
