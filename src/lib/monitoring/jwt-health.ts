/**
 * JWT / refresh-token health for the monitoring command bridge.
 *
 * Otter: short-lived JWT (~minutes) auto-rotated daily by `refresh-otter-jwt.yml`.
 * Harri: long-lived Cognito refresh token (~30d) rotated MANUALLY because
 *        Harri's pool requires a Google reCAPTCHA token on every sign-in
 *        (see scripts/refresh-harri-jwt.ts).
 *
 * Both tokens are JWTs with a standard `exp` claim, so we can read days-to-
 * expiry without making any network calls. If decoding fails we fall back
 * to "unknown" rather than guessing.
 */

import { unstable_cache } from "next/cache"
import { prisma } from "@/lib/prisma"

export type TokenProvider = "otter" | "harri"

export type TokenHealth = {
  provider: TokenProvider
  envVar: string
  hasToken: boolean
  expiresAt: Date | null
  /** Days until expiry. Negative if already expired. Null if undecodable. */
  daysLeft: number | null
  /** Most recent successful JobRun touching this provider, for cross-check. */
  lastSuccessAt: Date | null
}

function decodeExpSeconds(token: string | undefined | null): number | null {
  if (!token) return null
  const parts = token.split(".")
  if (parts.length < 2) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString())
    return typeof payload.exp === "number" ? payload.exp : null
  } catch {
    return null
  }
}

async function lastSuccess(jobNamePrefix: string): Promise<Date | null> {
  const row = await prisma.jobRun.findFirst({
    where: { jobName: { startsWith: jobNamePrefix }, status: "SUCCESS" },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true },
  })
  return row?.startedAt ?? null
}

async function tokenHealth(
  provider: TokenProvider,
  envVar: string,
  jobPrefix: string
): Promise<TokenHealth> {
  const token = process.env[envVar]
  const exp = decodeExpSeconds(token)
  const lastSuccessAt = await lastSuccess(jobPrefix)
  if (!token) {
    return {
      provider,
      envVar,
      hasToken: false,
      expiresAt: null,
      daysLeft: null,
      lastSuccessAt,
    }
  }
  if (exp === null) {
    return {
      provider,
      envVar,
      hasToken: true,
      expiresAt: null,
      daysLeft: null,
      lastSuccessAt,
    }
  }
  const expiresAt = new Date(exp * 1000)
  const daysLeft = Math.floor((exp * 1000 - Date.now()) / (24 * 60 * 60 * 1000))
  return { provider, envVar, hasToken: true, expiresAt, daysLeft, lastSuccessAt }
}

// JobRun.jobName uses dots (e.g. "otter.metrics.sync") — the prior "otter-" /
// "harri-" prefixes never matched, so lastSync was always null. Use the dot
// form so the lookup actually finds the most recent successful run.
async function getAllTokenHealthUncached(): Promise<TokenHealth[]> {
  return Promise.all([
    tokenHealth("otter", "OTTER_JWT", "otter."),
    tokenHealth("harri", "HARRI_REFRESH_TOKEN", "harri."),
  ])
}

// unstable_cache JSON-serializes, so Dates in the cached payload come back
// as strings. Cache an ISO-shape internally and rehydrate Dates in the
// exported wrapper so callers keep getting real Date instances.
type TokenHealthSerialized = Omit<TokenHealth, "expiresAt" | "lastSuccessAt"> & {
  expiresAt: string | null
  lastSuccessAt: string | null
}

const getAllTokenHealthCached = unstable_cache(
  async (): Promise<TokenHealthSerialized[]> => {
    const rows = await getAllTokenHealthUncached()
    return rows.map((r) => ({
      ...r,
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
      lastSuccessAt: r.lastSuccessAt ? r.lastSuccessAt.toISOString() : null,
    }))
  },
  ["monitoring:token-health"],
  { revalidate: 60, tags: ["monitoring:tokens"] },
)

export async function getAllTokenHealth(): Promise<TokenHealth[]> {
  const rows = await getAllTokenHealthCached()
  return rows.map((r) => ({
    ...r,
    expiresAt: r.expiresAt ? new Date(r.expiresAt) : null,
    lastSuccessAt: r.lastSuccessAt ? new Date(r.lastSuccessAt) : null,
  }))
}

/**
 * Fold the per-token rows into a single tone for the system-health pill.
 * danger if any token is missing/expired/<=3 days.
 * warn   if any token has <=14 days left or is undecodable.
 * ok     otherwise.
 */
export function summarizeTokenTone(rows: TokenHealth[]): "ok" | "warn" | "danger" {
  let tone: "ok" | "warn" = "ok"
  for (const r of rows) {
    if (!r.hasToken) return "danger"
    if (r.daysLeft !== null && r.daysLeft <= 3) return "danger"
    if (r.daysLeft === null || r.daysLeft <= 14) tone = "warn"
  }
  return tone
}
