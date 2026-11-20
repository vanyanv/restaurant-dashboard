/**
 * Refuses destructive local database commands against anything but a local
 * Postgres.
 *
 * `npm run db:reset` is `prisma db push --force-reset` followed by the seed:
 * it drops every table. The shell's DATABASE_URL on a working machine often
 * points at the Neon PRODUCTION database (the app reads the same variable),
 * and `prisma.config.ts` falls back to `.env.local`, which may too. Nothing
 * stopped a reset from wiping production. This does:
 *
 *   - the DATABASE_URL host must be localhost / 127.0.0.1 / ::1, or
 *   - ALLOW_DB_RESET=I_UNDERSTAND must be set explicitly.
 *
 * `prisma/seed.ts` runs the same check, and additionally refuses a database
 * that already holds real users (anyone but the demo owner) unless the same
 * override is set: seeding writes demo stores under every OWNER it finds.
 *
 * Usage: `tsx scripts/db-guard.ts` (exits 1 with the reason when refused).
 * Never prints the URL itself, only its host.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const DB_RESET_OVERRIDE = "I_UNDERSTAND"
export const DEMO_USER_EMAIL = "demo@restaurantos.com"

type Env = Record<string, string | undefined>

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])

export function dbHost(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname || null
  } catch {
    return null
  }
}

export function isLocalDatabaseUrl(url: string | undefined): boolean {
  const host = dbHost(url)
  return host !== null && LOCAL_HOSTS.has(host)
}

export function hasResetOverride(env: Env = process.env): boolean {
  return env.ALLOW_DB_RESET === DB_RESET_OVERRIDE
}

/** Null when allowed; otherwise the reason to print. */
export function refuseNonLocal(
  url: string | undefined,
  env: Env = process.env,
): string | null {
  if (hasResetOverride(env)) return null
  if (!url) return "DATABASE_URL is not set."
  if (isLocalDatabaseUrl(url)) return null
  const host = dbHost(url) ?? "an unparseable URL"
  return (
    `Refusing: DATABASE_URL points at ${host}, not a local Postgres. This command ` +
    `drops or overwrites data. Point DATABASE_URL at localhost, or set ` +
    `ALLOW_DB_RESET=${DB_RESET_OVERRIDE} if you really mean that database.`
  )
}

/** Null when allowed; otherwise the reason to print. */
export function refuseRealUsers(
  otherUserCount: number,
  env: Env = process.env,
): string | null {
  if (hasResetOverride(env) || otherUserCount === 0) return null
  return (
    `Refusing to seed: the database already has ${otherUserCount} user(s) besides ` +
    `${DEMO_USER_EMAIL}, so it holds a real account. Set ` +
    `ALLOW_DB_RESET=${DB_RESET_OVERRIDE} to seed it anyway.`
  )
}

/** The URL `prisma.config.ts` would use: the environment, else `.env.local`. */
export function resolveDatabaseUrl(cwd: string = process.cwd()): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const file = path.join(cwd, ".env.local")
  if (!fs.existsSync(file)) return undefined
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/)
    if (m) return m[1].replace(/^["']|["']$/g, "")
  }
  return undefined
}

const invokedDirectly =
  !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  const reason = refuseNonLocal(resolveDatabaseUrl())
  if (reason) {
    console.error(reason)
    process.exit(1)
  }
}
