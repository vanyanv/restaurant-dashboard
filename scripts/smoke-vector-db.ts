/**
 * Production-style smoke test for the chat/vector database branch.
 *
 * Usage:
 *   ./node_modules/.bin/tsx --env-file=.env.local scripts/smoke-vector-db.ts
 */

import { spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import pg from "pg"
import { embed, toVectorLiteral } from "../src/lib/chat/embeddings"

const REQUIRED_ENV = [
  "DATABASE_URL",
  "DATABASE_URL2",
  "OPENAI_API_KEY",
  "NEXTAUTH_SECRET",
] as const

type EmbeddingCorpus = {
  label: string
  table: string
  accountScoped: boolean
  ownerScoped: boolean
  query: string
  directSql: string
  orphanSql: string
  scopeSql: string
}

const CORPORA: EmbeddingCorpus[] = [
  {
    label: "invoice lines",
    table: "InvoiceLineEmbedding",
    accountScoped: true,
    ownerScoped: true,
    query: "chicken thighs invoice line",
    directSql: `
      SELECT e.id, (1 - (e.embedding <=> $1::vector))::float8 AS score
        FROM "InvoiceLineEmbedding" e
        JOIN "InvoiceLineItem" l ON l.id = e."invoiceLineId"
        JOIN "Invoice" i ON i.id = e."invoiceId"
       WHERE e."accountId" = $2
       ORDER BY e.embedding <=> $1::vector
       LIMIT 5`,
    orphanSql: `
      SELECT COUNT(*)::int AS count
        FROM "InvoiceLineEmbedding" e
       WHERE NOT EXISTS (SELECT 1 FROM "Invoice" i WHERE i.id = e."invoiceId")
          OR (e."invoiceLineId" IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM "InvoiceLineItem" l WHERE l.id = e."invoiceLineId"
             ))`,
    scopeSql: `
      SELECT COUNT(*)::int AS count
        FROM "InvoiceLineEmbedding" e
        LEFT JOIN "User" u ON u.id = e."ownerId"
        LEFT JOIN "Invoice" i ON i.id = e."invoiceId"
       WHERE e."accountId" IS NULL
          OR e."ownerId" IS NULL
          OR u.id IS NULL
          OR u."accountId" <> e."accountId"
          OR i."accountId" <> e."accountId"`,
  },
  {
    label: "menu items",
    table: "MenuItemEmbedding",
    accountScoped: true,
    ownerScoped: true,
    query: "milkshake menu item",
    directSql: `
      SELECT e.id, (1 - (e.embedding <=> $1::vector))::float8 AS score
        FROM "MenuItemEmbedding" e
        JOIN "Store" s ON s.id = e."storeId"
       WHERE e."accountId" = $2
       ORDER BY e.embedding <=> $1::vector
       LIMIT 5`,
    orphanSql: `
      SELECT COUNT(*)::int AS count
        FROM "MenuItemEmbedding" e
       WHERE NOT EXISTS (SELECT 1 FROM "Store" s WHERE s.id = e."storeId")`,
    scopeSql: `
      SELECT COUNT(*)::int AS count
        FROM "MenuItemEmbedding" e
        LEFT JOIN "User" u ON u.id = e."ownerId"
        LEFT JOIN "Store" s ON s.id = e."storeId"
       WHERE e."accountId" IS NULL
          OR e."ownerId" IS NULL
          OR u.id IS NULL
          OR u."accountId" <> e."accountId"
          OR s."accountId" <> e."accountId"`,
  },
  {
    label: "recipes",
    table: "RecipeEmbedding",
    accountScoped: true,
    ownerScoped: true,
    query: "cheese burger recipe",
    directSql: `
      SELECT e.id, (1 - (e.embedding <=> $1::vector))::float8 AS score
        FROM "RecipeEmbedding" e
        JOIN "Recipe" r ON r.id = e."recipeId"
       WHERE e."accountId" = $2
       ORDER BY e.embedding <=> $1::vector
       LIMIT 5`,
    orphanSql: `
      SELECT COUNT(*)::int AS count
        FROM "RecipeEmbedding" e
       WHERE NOT EXISTS (SELECT 1 FROM "Recipe" r WHERE r.id = e."recipeId")`,
    scopeSql: `
      SELECT COUNT(*)::int AS count
        FROM "RecipeEmbedding" e
        LEFT JOIN "User" u ON u.id = e."ownerId"
        LEFT JOIN "Recipe" r ON r.id = e."recipeId"
       WHERE e."accountId" IS NULL
          OR e."ownerId" IS NULL
          OR u.id IS NULL
          OR u."accountId" <> e."accountId"
          OR r."accountId" <> e."accountId"`,
  },
  {
    label: "canonical ingredients",
    table: "CanonicalIngredientEmbedding",
    accountScoped: true,
    ownerScoped: true,
    query: "extra virgin olive oil ingredient",
    directSql: `
      SELECT e.id, (1 - (e.embedding <=> $1::vector))::float8 AS score
        FROM "CanonicalIngredientEmbedding" e
        JOIN "CanonicalIngredient" c ON c.id = e."canonicalIngredientId"
       WHERE e."accountId" = $2
       ORDER BY e.embedding <=> $1::vector
       LIMIT 5`,
    orphanSql: `
      SELECT COUNT(*)::int AS count
        FROM "CanonicalIngredientEmbedding" e
       WHERE NOT EXISTS (
         SELECT 1 FROM "CanonicalIngredient" c WHERE c.id = e."canonicalIngredientId"
       )`,
    scopeSql: `
      SELECT COUNT(*)::int AS count
        FROM "CanonicalIngredientEmbedding" e
        LEFT JOIN "User" u ON u.id = e."ownerId"
        LEFT JOIN "CanonicalIngredient" c ON c.id = e."canonicalIngredientId"
       WHERE e."accountId" IS NULL
          OR e."ownerId" IS NULL
          OR u.id IS NULL
          OR u."accountId" <> e."accountId"
          OR c."accountId" <> e."accountId"`,
  },
  {
    label: "P&L narratives",
    table: "PnlNarrativeEmbedding",
    accountScoped: true,
    ownerScoped: false,
    query: "weekly labor and cogs narrative",
    directSql: `
      SELECT e.id, (1 - (e.embedding <=> $1::vector))::float8 AS score
        FROM "PnlNarrativeEmbedding" e
       WHERE e."accountId" = $2
       ORDER BY e.embedding <=> $1::vector
       LIMIT 5`,
    orphanSql: `
      SELECT COUNT(*)::int AS count
        FROM "PnlNarrativeEmbedding" e
       WHERE NOT EXISTS (SELECT 1 FROM "Account" a WHERE a.id = e."accountId")
          OR (e."storeId" IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM "Store" s WHERE s.id = e."storeId"
             ))`,
    scopeSql: `
      SELECT COUNT(*)::int AS count
        FROM "PnlNarrativeEmbedding" e
        LEFT JOIN "Store" s ON s.id = e."storeId"
       WHERE e."accountId" IS NULL
          OR (e."storeId" IS NOT NULL AND s."accountId" <> e."accountId")`,
  },
]

async function main() {
  await loadEnvLocal()
  assertRequiredEnv()

  console.log("Vector DB smoke: starting")
  checkPrismaDrift("DATABASE_URL", process.env.DATABASE_URL!)
  checkPrismaDrift("DATABASE_URL2", process.env.DATABASE_URL2!)

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL2! })
  await client.connect()
  try {
    await checkVectorExtension(client)
    await checkHnswIndexes(client)
    const accountId = await pickAccountId(client)
    console.log(`Using account scope: ${accountId}`)
    await checkCorpusHealth(client)
    await checkRawRetrieval(client, accountId)
  } finally {
    await client.end()
  }

  console.log("Vector DB smoke: PASS")
}

async function loadEnvLocal(): Promise<void> {
  try {
    const raw = await readFile(resolve(process.cwd(), ".env.local"), "utf-8")
    for (const line of raw.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eq = trimmed.indexOf("=")
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (value && process.env[key] === undefined) process.env[key] = value
    }
  } catch {
    // `--env-file=.env.local` is the preferred path; this is a fallback.
  }
}

function assertRequiredEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key])
  if (missing.length > 0) {
    throw new Error(`Missing required env: ${missing.join(", ")}`)
  }
}

function checkPrismaDrift(label: "DATABASE_URL" | "DATABASE_URL2", url: string) {
  const env = { ...process.env, DATABASE_URL: url }
  const res = spawnSync(
    "./node_modules/.bin/prisma",
    [
      "migrate",
      "diff",
      "--from-schema",
      "prisma/schema.prisma",
      "--to-config-datasource",
      "--exit-code",
    ],
    { cwd: process.cwd(), env, encoding: "utf-8" },
  )
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim()
  if (
    (res.status !== 0 || !output.includes("No difference detected")) &&
    !isAllowedManualDiff(output)
  ) {
    throw new Error(
      `${label} drift check failed (exit ${res.status ?? "null"}):\n${output}`,
    )
  }
  const note = output.includes("No difference detected")
    ? "No difference detected."
    : "Only allowed manual PostgreSQL/vector index delta."
  console.log(`OK drift ${label}: ${note}`)
}

function isAllowedManualDiff(output: string): boolean {
  const meaningful = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false
      if (line.startsWith("◇ injected env")) return false
      if (line.startsWith("Loaded Prisma config")) return false
      if (line.startsWith("[+] Added extensions")) return false
      if (line.startsWith("[*] Changed the `")) return false
      return true
    })
  const allowed = new Set([
    "- plpgsql",
    "[+] Added index on columns (embedding)",
  ])
  return meaningful.length > 0 && meaningful.every((line) => allowed.has(line))
}

async function checkVectorExtension(client: pg.Client) {
  const res = await client.query<{ installed: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_extension WHERE extname = 'vector'
     ) AS installed`,
  )
  if (!res.rows[0]?.installed) {
    throw new Error("DATABASE_URL2 is missing pgvector extension")
  }
  console.log("OK pgvector extension installed")
}

async function checkHnswIndexes(client: pg.Client) {
  for (const corpus of CORPORA) {
    const res = await client.query<{ indexname: string }>(
      `SELECT indexname
         FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = $1
          AND indexdef ILIKE '%USING hnsw%'
          AND indexdef ILIKE '%embedding%'`,
      [corpus.table],
    )
    if (res.rowCount === 0) {
      throw new Error(`${corpus.table} is missing an HNSW embedding index`)
    }
    console.log(`OK HNSW ${corpus.table}: ${res.rows.map((r) => r.indexname).join(", ")}`)
  }
}

async function pickAccountId(client: pg.Client): Promise<string> {
  const res = await client.query<{ accountId: string }>(
    `SELECT "accountId"
       FROM "User"
      WHERE role IN ('OWNER', 'DEVELOPER')
      ORDER BY role DESC, email
      LIMIT 1`,
  )
  const accountId = res.rows[0]?.accountId
  if (!accountId) throw new Error("No OWNER/DEVELOPER user found for account scoping")
  return accountId
}

async function checkCorpusHealth(client: pg.Client) {
  for (const corpus of CORPORA) {
    const stats = await client.query<{
      count: number
      dims: number[]
      minScore: number | null
      maxScore: number | null
      accountCount: number
      ownerCount: number
    }>(
      `
      SELECT COUNT(*)::int AS count,
             COALESCE(array_agg(DISTINCT vector_dims(embedding)), ARRAY[]::int[]) AS dims,
             MIN(1 - (embedding <=> embedding))::float8 AS "minScore",
             MAX(1 - (embedding <=> embedding))::float8 AS "maxScore",
             COUNT(DISTINCT "accountId")::int AS "accountCount",
             COUNT(DISTINCT ${corpus.ownerScoped ? `"ownerId"` : `"accountId"`})::int AS "ownerCount"
        FROM "${corpus.table}"`,
    )
    const row = stats.rows[0]
    if (!row || row.count <= 0) throw new Error(`${corpus.table} has no rows`)
    if (row.dims.length !== 1 || row.dims[0] !== 1536) {
      throw new Error(`${corpus.table} has invalid embedding dimensions: ${row.dims.join(", ")}`)
    }
    if (row.minScore !== 1 || row.maxScore !== 1) {
      throw new Error(`${corpus.table} self-similarity scores are invalid`)
    }
    if (row.accountCount <= 0) throw new Error(`${corpus.table} has no account scope`)
    if (corpus.ownerScoped && row.ownerCount <= 0) {
      throw new Error(`${corpus.table} has no owner scope`)
    }

    const orphans = await countQuery(client, corpus.orphanSql)
    if (orphans !== 0) throw new Error(`${corpus.table} has ${orphans} orphaned embedding rows`)

    const scopeProblems = await countQuery(client, corpus.scopeSql)
    if (scopeProblems !== 0) {
      throw new Error(`${corpus.table} has ${scopeProblems} account/store scope violations`)
    }

    console.log(
      `OK corpus ${corpus.table}: rows=${row.count} accounts=${row.accountCount} dims=${row.dims.join(",")}`,
    )
  }
}

async function checkRawRetrieval(client: pg.Client, accountId: string) {
  for (const corpus of CORPORA) {
    const lit = toVectorLiteral(await embed(corpus.query))
    const res = await client.query<{ id: string; score: number }>(corpus.directSql, [
      lit,
      accountId,
    ])
    if (res.rowCount === 0) throw new Error(`${corpus.table} returned no scoped vector hits`)
    const scores = res.rows.map((r) => Number(r.score))
    const badScore = scores.find((score) => !Number.isFinite(score) || score < -1 || score > 1)
    if (badScore !== undefined) {
      throw new Error(`${corpus.table} returned invalid vector score: ${badScore}`)
    }
    console.log(
      `OK retrieval ${corpus.table}: ${res.rowCount} hit(s), top score=${scores[0].toFixed(4)}`,
    )
  }
}

async function countQuery(client: pg.Client, sql: string): Promise<number> {
  const res = await client.query<{ count: number }>(sql)
  return Number(res.rows[0]?.count ?? 0)
}

main().catch((err) => {
  console.error("Vector DB smoke: FAIL")
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
