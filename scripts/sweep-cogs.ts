// scripts/sweep-cogs.ts
//
// The COGS sweep, run on the GitHub Actions runner instead of on Vercel.
//
//   npx tsx scripts/sweep-cogs.ts [lookbackDays] [--force] [--store-id=<id>]
//
// cogs-sweep.yml runs it with 3 days twice a day; cogs-refresh.yml with 30
// days once a week. Until 2026-11-26 both workflows called
// /api/cron/cogs/stores and then /api/cron/cogs/sweep once per store, which
// put the app's most processor-heavy job on the Vercel Hobby plan's 4 hours of
// Active CPU a month. This runs the same two functions those endpoints run
// (`src/lib/cogs-sweep-job.ts`), so the store list, the source-change skip,
// the JobRun rows and the cache retirement are unchanged.
//
// Stores are swept one after another. One store failing does not stop the
// rest; the script exits 1 at the end if any did, so the workflow goes red
// and opens its incident issue.

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  const content = fs.readFileSync(envPath, "utf-8")
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[key]) {
      process.env[key] = val
    }
  }
}

export const DEFAULT_LOOKBACK_DAYS = 3

export type SweepArgs = {
  lookbackDays: number
  force: boolean
  storeId: string | null
}

/**
 * `[lookbackDays] [--force] [--store-id=<id>]`. Throws on a lookback that is
 * not a whole number from 1 to 365, and on any argument it does not know: a
 * workflow input typed wrong should stop the run, not quietly sweep the
 * default window.
 */
export function parseArgs(argv: string[]): SweepArgs {
  // An argument this does not know is an error too. Otherwise `-3` reads as a
  // flag, is ignored, and the run sweeps the default window without a word.
  const unknown = argv.find(
    (a) => a.startsWith("-") && a !== "--force" && !a.startsWith("--force=") && !a.startsWith("--store-id="),
  )
  if (unknown !== undefined) {
    throw new Error(`unknown argument "${unknown}" (lookbackDays must be a whole number from 1 to 365)`)
  }
  const positional = argv.filter((a) => !a.startsWith("-"))
  const raw = positional[0]
  let lookbackDays = DEFAULT_LOOKBACK_DAYS
  if (raw !== undefined && raw !== "") {
    lookbackDays = Number(raw)
    if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 365) {
      throw new Error(`lookbackDays must be a whole number from 1 to 365, got "${raw}"`)
    }
  }
  // `--force` and `--force=true` both force; `--force=false` (what the
  // workflow passes when its input is left alone) does not.
  const forceArg = argv.find((a) => a === "--force" || a.startsWith("--force="))
  const force = forceArg === "--force" || forceArg === "--force=true"
  const storeArg = argv.find((a) => a.startsWith("--store-id="))
  const storeId = storeArg ? storeArg.slice("--store-id=".length) || null : null
  return { lookbackDays, force, storeId }
}

export type SweepStoreOutcome =
  | { ok: true; storeId: string; storeName: string; skipped: boolean; rowsChanged: number; durationMs: number }
  | { ok: false; storeId: string; storeName: string; error: string; durationMs: number }

export type SweepDeps = {
  listStores: (opts: { force: boolean }) => Promise<{ stores: { id: string; name: string }[] }>
  sweepStore: (opts: {
    storeId: string
    lookbackDays: number
    force: boolean
  }) => Promise<{ storeName: string; skipped: boolean; rowsChanged: number }>
  log?: (line: string) => void
  now?: () => number
}

/**
 * Sweeps every store on the list, one at a time, and carries on past a store
 * that fails. With `storeId` set, sweeps only that store (and fails if it is
 * not on the list, so a typo cannot pass as "nothing to do").
 */
export async function sweepStores(args: SweepArgs, deps: SweepDeps): Promise<SweepStoreOutcome[]> {
  const log = deps.log ?? console.log
  const now = deps.now ?? Date.now
  const { stores } = await deps.listStores({ force: args.force })
  const targets = args.storeId ? stores.filter((s) => s.id === args.storeId) : stores
  if (args.storeId && targets.length === 0) {
    throw new Error(
      `Store ${args.storeId} is not on the sweep list (inactive, unknown, or empty without --force)`,
    )
  }
  log(`Sweeping ${targets.length} store(s), last ${args.lookbackDays} day(s), force=${args.force}`)

  const outcomes: SweepStoreOutcome[] = []
  for (const store of targets) {
    const started = now()
    try {
      const r = await deps.sweepStore({
        storeId: store.id,
        lookbackDays: args.lookbackDays,
        force: args.force,
      })
      const outcome: SweepStoreOutcome = {
        ok: true,
        storeId: store.id,
        storeName: r.storeName,
        skipped: r.skipped,
        rowsChanged: r.rowsChanged,
        durationMs: now() - started,
      }
      outcomes.push(outcome)
      log(JSON.stringify({ ...r, durationMs: outcome.durationMs }))
    } catch (err) {
      const outcome: SweepStoreOutcome = {
        ok: false,
        storeId: store.id,
        storeName: store.name,
        error: err instanceof Error ? err.message : String(err),
        durationMs: now() - started,
      }
      outcomes.push(outcome)
      log(JSON.stringify(outcome))
    }
  }
  return outcomes
}

/** The last line of the run, and whether the process should exit 0. */
export function summarizeSweep(outcomes: SweepStoreOutcome[]): { ok: boolean; line: string } {
  const failed = outcomes.filter((o) => !o.ok)
  const skipped = outcomes.filter((o) => o.ok && o.skipped).length
  const swept = outcomes.length - failed.length - skipped
  const line =
    `COGS sweep: ${swept} swept, ${skipped} skipped (no source change), ${failed.length} failed` +
    (failed.length > 0 ? `: ${failed.map((o) => o.storeName).join(", ")}` : "")
  return { ok: failed.length === 0, line }
}

async function main(): Promise<number> {
  loadEnvLocal()
  const args = parseArgs(process.argv.slice(2))

  const { listCogsSweepStores, runCogsSweepForStore } = await import("../src/lib/cogs-sweep-job")
  const { warnIfNoRedis } = await import("../src/lib/cache/redis")
  const { prisma } = await import("../src/lib/prisma")
  // Without Redis the sweep's writes cannot retire saved figures.
  warnIfNoRedis("sweep-cogs")

  try {
    const outcomes = await sweepStores(args, {
      listStores: ({ force }) => listCogsSweepStores({ force, triggeredBy: "github-actions" }),
      sweepStore: (opts) => runCogsSweepForStore({ ...opts, triggeredBy: "github-actions" }),
    })
    const summary = summarizeSweep(outcomes)
    console.log(summary.line)
    return summary.ok ? 0 : 1
  } finally {
    await prisma.$disconnect()
  }
}

// Only sweep when invoked as a script, so a test can import the helpers.
const invokedDirectly =
  !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error("COGS sweep failed:", err)
      process.exit(1)
    },
  )
}
