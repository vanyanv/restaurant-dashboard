/**
 * Shared persistence for the Harri Cognito refresh token.
 *
 * One place that knows how to push a rotated `HARRI_REFRESH_TOKEN` to every
 * place that reads it: `.env.local` (local dev), the Vercel project env, and
 * the GitHub Actions repo secret. Used by both the manual rotation tool
 * (`scripts/refresh-harri-jwt.ts`) and the runtime rotation-capture in
 * `src/lib/harri.ts` (`refreshAccessToken`).
 *
 * Every target is best-effort and self-contained: a failure to reach Vercel or
 * GitHub logs and returns `false` rather than throwing, so a labor-sync run is
 * never taken down by a secret-store hiccup.
 */
import fs from "fs"
import path from "path"
import sodium from "libsodium-wrappers"

const GH_REPO = process.env.HARRI_GH_REPO || "vanyanv/restaurant-dashboard"

// Resolved per-call (not at import) so it always tracks the current working dir.
function envPath(): string {
  return path.resolve(process.cwd(), ".env.local")
}

export type PersistCredentials = { email?: string; password?: string }

export type PersistTargets = {
  /** Persist to `.env.local` (skip in CI). Default: only when not in CI. */
  writeEnvLocal?: boolean
  credentials?: PersistCredentials
}

export type PersistResult = { envLocal: boolean; vercel: boolean; github: boolean }

// --- .env.local --------------------------------------------------------------

export function updateEnvLocalToken(refreshToken: string, key = "HARRI_REFRESH_TOKEN"): boolean {
  try {
    const file = envPath()
    let content = ""
    if (fs.existsSync(file)) content = fs.readFileSync(file, "utf-8")
    const lines = content.split("\n").filter((line) => !line.trim().startsWith(`${key}=`))
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop()
    lines.push(`${key}=${refreshToken}`, "")
    fs.writeFileSync(file, lines.join("\n"), "utf-8")
    return true
  } catch (err) {
    console.error(`  [token-store] .env.local write failed:`, err)
    return false
  }
}

// --- Vercel ------------------------------------------------------------------

async function upsertVercelEnv(
  projectId: string,
  token: string,
  existing: Array<{ id: string; key: string }>,
  key: string,
  value: string | undefined,
): Promise<void> {
  if (!value) return
  const current = existing.find((e) => e.key === key)
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
  if (current) {
    await fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${current.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ value }),
    })
    return
  }
  await fetch(`https://api.vercel.com/v10/projects/${projectId}/env`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      key,
      value,
      type: "encrypted",
      target: ["production", "preview", "development"],
    }),
  })
}

async function persistVercel(refreshToken: string, creds: PersistCredentials): Promise<boolean> {
  const token = process.env.VERCEL_TOKEN
  const projectId = process.env.VERCEL_PROJECT_ID
  if (!token || !projectId) return false
  try {
    const listRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!listRes.ok) return false
    const existing = (((await listRes.json()) as { envs?: unknown }).envs ?? []) as Array<{
      id: string
      key: string
    }>
    await upsertVercelEnv(projectId, token, existing, "HARRI_REFRESH_TOKEN", refreshToken)
    await upsertVercelEnv(projectId, token, existing, "HARRI_EMAIL", creds.email)
    await upsertVercelEnv(projectId, token, existing, "HARRI_PASSWORD", creds.password)
    return true
  } catch (err) {
    console.error("  [token-store] Vercel update failed:", err)
    return false
  }
}

// --- GitHub Actions secret ---------------------------------------------------

async function putGhSecret(
  token: string,
  publicKey: { key: string; key_id: string },
  name: string,
  value: string,
): Promise<void> {
  await sodium.ready
  const binKey = sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL)
  const encrypted = sodium.crypto_box_seal(sodium.from_string(value), binKey)
  const encryptedB64 = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL)
  await fetch(`https://api.github.com/repos/${GH_REPO}/actions/secrets/${name}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ encrypted_value: encryptedB64, key_id: publicKey.key_id }),
  })
}

async function persistGitHub(refreshToken: string, creds: PersistCredentials): Promise<boolean> {
  // Needs a PAT with repo scope — the default Actions GITHUB_TOKEN cannot write
  // secrets. Accept either GH_PAT or GH_TOKEN.
  const token = process.env.GH_PAT || process.env.GH_TOKEN
  if (!token) return false
  try {
    const keyRes = await fetch(
      `https://api.github.com/repos/${GH_REPO}/actions/secrets/public-key`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    )
    if (!keyRes.ok) return false
    const publicKey = (await keyRes.json()) as { key: string; key_id: string }
    await putGhSecret(token, publicKey, "HARRI_REFRESH_TOKEN", refreshToken)
    if (creds.email) await putGhSecret(token, publicKey, "HARRI_EMAIL", creds.email)
    if (creds.password) await putGhSecret(token, publicKey, "HARRI_PASSWORD", creds.password)
    return true
  } catch (err) {
    console.error("  [token-store] GitHub secret update failed:", err)
    return false
  }
}

/**
 * Push a rotated refresh token to every configured store. Best-effort: returns
 * which targets succeeded; never throws.
 */
export async function persistHarriRefreshToken(
  refreshToken: string,
  opts: PersistTargets = {},
): Promise<PersistResult> {
  const creds = opts.credentials ?? {
    email: process.env.HARRI_EMAIL,
    password: process.env.HARRI_PASSWORD,
  }
  const writeEnvLocal = opts.writeEnvLocal ?? !process.env.CI

  const envLocal = writeEnvLocal ? updateEnvLocalToken(refreshToken) : false
  const [vercel, github] = await Promise.all([
    persistVercel(refreshToken, creds),
    persistGitHub(refreshToken, creds),
  ])
  return { envLocal, vercel, github }
}
