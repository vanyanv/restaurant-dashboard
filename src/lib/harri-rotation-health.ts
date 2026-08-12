/**
 * Health rules for the Harri refresh-token rotation chain.
 *
 * Context (incident 2026-08-12): the weekly rotation pushed a fresh token to
 * `.env.local` and Vercel but failed the GitHub leg with `401 Bad credentials`
 * for three straight weeks — and still printed "Done!" and exited 0. The daily
 * heartbeat stayed green the whole time, because it only ever asked "is the
 * token alive today?". It never asked "can we still renew it?". A token can be
 * perfectly alive and already doomed; that was exactly the state we were in.
 *
 * Cognito does NOT rotate refresh tokens for this pool — a REFRESH_TOKEN_AUTH
 * call returns only AccessToken/IdToken (verified 2026-08-12). So the 30-day
 * clock runs from *issuance*, not last use, and a real browser login is the
 * only way to renew. That makes "how long since rotation last landed in CI"
 * the number that actually predicts an outage.
 *
 * Pure functions only — no network, no fs — so the rules are unit-testable
 * without a Harri login.
 */

/** Cognito refresh-token lifetime for Harri's pool (days). */
export const TOKEN_LIFETIME_DAYS = 30
/** Start warning once rotation hasn't landed in this many days. */
export const WARN_AGE_DAYS = 21
/** Hard-fail (open an incident) at this age — leaves ~4 days of runway. */
export const CRITICAL_AGE_DAYS = 26

const MS_PER_DAY = 86_400_000

export type HealthLevel = "ok" | "warn" | "critical"

export type AgeVerdict = {
  /** Days since the token last landed in the GitHub Actions secret. */
  ageDays: number
  /** Days remaining before the 30-day Cognito expiry. Negative = already dead. */
  daysUntilExpiry: number
  level: HealthLevel
  message: string
}

/**
 * Classify the age of the last successfully-landed token.
 *
 * We use the GitHub Actions secret's `updated_at` as the issuance proxy: the
 * refresh token itself is opaque (not a JWT), so it carries no readable expiry.
 * That timestamp is also the more useful signal — it measures the last time the
 * *whole rotation chain* succeeded, which is the thing that breaks.
 */
export function classifyTokenAge(updatedAt: string | Date, now: Date = new Date()): AgeVerdict {
  const stamp = updatedAt instanceof Date ? updatedAt : new Date(updatedAt)
  if (Number.isNaN(stamp.getTime())) {
    return {
      ageDays: Number.NaN,
      daysUntilExpiry: Number.NaN,
      level: "critical",
      message: `cannot parse secret timestamp ${JSON.stringify(String(updatedAt))} — unable to tell how close the token is to expiry`,
    }
  }

  const ageDays = (now.getTime() - stamp.getTime()) / MS_PER_DAY
  const daysUntilExpiry = TOKEN_LIFETIME_DAYS - ageDays
  const age = ageDays.toFixed(1)
  const left = daysUntilExpiry.toFixed(1)

  if (ageDays >= CRITICAL_AGE_DAYS) {
    return {
      ageDays,
      daysUntilExpiry,
      level: "critical",
      message: `token in GitHub Actions is ${age}d old (~${left}d before the ${TOKEN_LIFETIME_DAYS}d Cognito expiry). Rotation has not landed in CI since ${stamp.toISOString()} — run scripts/rotate-harri-token.sh and confirm the GitHub leg reports ok.`,
    }
  }
  if (ageDays >= WARN_AGE_DAYS) {
    return {
      ageDays,
      daysUntilExpiry,
      level: "warn",
      message: `token in GitHub Actions is ${age}d old (~${left}d of runway). Still valid, but rotation should land soon — the weekly timer has had chances and hasn't taken them.`,
    }
  }
  return {
    ageDays,
    daysUntilExpiry,
    level: "ok",
    message: `token in GitHub Actions is ${age}d old (~${left}d of runway).`,
  }
}

// --- rotation leg accounting -------------------------------------------------

export type LegStatus = "ok" | "skipped" | "failed"
export type LegName = "envLocal" | "vercel" | "github"

export const LEG_LABELS: Record<LegName, string> = {
  envLocal: ".env.local",
  vercel: "Vercel",
  github: "GitHub Actions",
}

export type RotationVerdict = {
  /** True only when every required leg landed. Drives the process exit code. */
  ok: boolean
  /** Required legs that did not land, with the reason baked into the status. */
  problems: Array<{ leg: LegName; status: LegStatus }>
  /** Human-readable summary, one line per leg. */
  lines: string[]
}

/**
 * Decide whether a rotation actually succeeded.
 *
 * The old script treated "skipped" and "failed" alike — both just logged and
 * carried on to print "Done!". Both are now failures when the leg is required,
 * because an unattended weekly rotation has nobody reading the log: the only
 * signal that escapes is the exit code.
 */
export function summarizeRotation(
  legs: Record<LegName, LegStatus>,
  required: LegName[],
): RotationVerdict {
  const requiredSet = new Set(required)
  const problems: Array<{ leg: LegName; status: LegStatus }> = []
  const lines: string[] = []

  for (const leg of Object.keys(LEG_LABELS) as LegName[]) {
    const status = legs[leg]
    const isRequired = requiredSet.has(leg)
    if (isRequired && status !== "ok") problems.push({ leg, status })
    const mark = status === "ok" ? "ok" : status === "skipped" ? "SKIPPED" : "FAILED"
    const suffix = isRequired ? "" : " (not required)"
    lines.push(`  ${LEG_LABELS[leg].padEnd(16)} ${mark}${suffix}`)
  }

  return { ok: problems.length === 0, problems, lines }
}
