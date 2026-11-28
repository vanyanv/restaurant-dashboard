import "server-only"

/**
 * The NAMES of the environment variables Vercel holds for this project, with
 * each one's type and where it applies. Never a value.
 *
 * `GET /v10/projects/{idOrName}/env` (checked against Vercel's REST reference
 * on 2026-11-27). The request never passes `decrypt`, so Vercel sends
 * ciphertext for encrypted variables and nothing readable for sensitive ones,
 * and this module drops the `value` field anyway: what it returns is built
 * field by field from the name, the type and the targets only.
 *
 * Never throws. A missing token, a refusal, a slow answer and a shape it does
 * not recognise all come back as `unavailable` with a short reason the page
 * can print.
 */

export type VercelEnvType = "plain" | "encrypted" | "sensitive"
export type VercelEnvTarget = "production" | "preview" | "development"

export interface VercelEnvRow {
  name: string
  type: VercelEnvType
  targets: VercelEnvTarget[]
}

export type VercelEnvResult =
  | { ok: true; rows: VercelEnvRow[] }
  | { ok: false; reason: "not set up" | "couldn't reach Vercel" }

const TIMEOUT_MS = 3_000
const TARGET_ORDER: VercelEnvTarget[] = ["production", "preview", "development"]

/**
 * Vercel's five types folded to the three the page shows.
 *
 * `secret` is the older kind Vercel has been moving to `sensitive` (its
 * reference describes `sunsetSecretId` as marking "variables that have been
 * migrated from type secret to sensitive"), so it reads as sensitive here.
 * `visibility` is Vercel's newer config/secret mark and, in its words, is
 * "authoritative" when set: `secret` there means sensitive whatever `type`
 * says. `config`, or no mark at all, falls back to the type.
 */
function typeOf(raw: unknown, visibility: unknown): VercelEnvType {
  if (visibility === "secret") return "sensitive"
  if (raw === "sensitive" || raw === "secret") return "sensitive"
  if (raw === "plain" || raw === "system") return "plain"
  return "encrypted"
}

/** `target` is an array or one string; anything else (a custom environment) is left out. */
function targetsOf(raw: unknown): VercelEnvTarget[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []
  return TARGET_ORDER.filter((t) => list.includes(t))
}

const TYPE_RANK: Record<VercelEnvType, number> = { plain: 0, encrypted: 1, sensitive: 2 }

export async function listVercelEnv(
  env: Record<string, string | undefined> = process.env,
): Promise<VercelEnvResult> {
  const token = env.VERCEL_TOKEN?.trim()
  const projectId = env.VERCEL_PROJECT_ID?.trim()
  if (!token || !projectId) return { ok: false, reason: "not set up" }

  const teamId = env.VERCEL_TEAM_ID?.trim()
  const url =
    `https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}/env` +
    (teamId ? `?teamId=${encodeURIComponent(teamId)}` : "")

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return { ok: false, reason: "couldn't reach Vercel" }

    const body = (await res.json()) as { envs?: unknown } | null
    const envs = body?.envs
    if (!Array.isArray(envs)) return { ok: false, reason: "couldn't reach Vercel" }

    // One name can have several entries (a value per target). Fold them into
    // one row: every target it applies to, and the most protected type.
    const byName = new Map<string, VercelEnvRow>()
    for (const entry of envs) {
      if (entry === null || typeof entry !== "object") continue
      const e = entry as Record<string, unknown>
      if (typeof e.key !== "string" || e.key === "") continue
      const type = typeOf(e.type, e.visibility)
      const targets = targetsOf(e.target)
      const seen = byName.get(e.key)
      if (!seen) {
        byName.set(e.key, { name: e.key, type, targets })
        continue
      }
      seen.targets = TARGET_ORDER.filter((t) => seen.targets.includes(t) || targets.includes(t))
      if (TYPE_RANK[type] > TYPE_RANK[seen.type]) seen.type = type
    }
    return { ok: true, rows: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)) }
  } catch {
    return { ok: false, reason: "couldn't reach Vercel" }
  }
}
