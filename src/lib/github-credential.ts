/**
 * Resolving and vetting the GitHub credential that the rotation scripts use to
 * write Actions secrets.
 *
 * Why this exists: the Harri/Otter rotation chain has broken three times on the
 * same root cause, not on three different ones. `updateGitHub()` needs a token
 * that can write repo secrets, the built-in GITHUB_TOKEN cannot do that, and so
 * a human pastes something into GH_PAT / GH_TOKEN. Twice that something was a
 * `gho_` token from `gh auth token` — which is the CLI's own OAuth session,
 * rotated and expired by GitHub on its own schedule. It works the day you paste
 * it and 401s weeks later at 3am, at which point rotation silently stops
 * reaching CI and a secret quietly freezes (OTTER_JWT sat frozen for 78 days
 * that way, and again from 2026-05-27).
 *
 * Two of the scripts actively recommended `gh auth token` in their own
 * remediation text, so the documented fix re-introduced the bug.
 *
 * Token shape is knowable at read time, so check it at read time.
 */

export type GitHubTokenShape =
  | "classic-pat"
  | "fine-grained-pat"
  | "oauth-cli"
  | "app-installation"
  | "user-to-server"
  | "unknown"

export interface GitHubCredential {
  token: string
  shape: GitHubTokenShape
  /** False when this kind of token rotates or expires out from under CI. */
  durable: boolean
  /** Operator-facing warning, or null when the shape is fine. Never contains the token. */
  warning: string | null
}

/** The correct way to mint a credential for this job. Referenced by every 401 path. */
export const PAT_REMEDIATION =
  "Mint a personal access token at https://github.com/settings/tokens with `repo` scope\n" +
  "  (classic) or Actions: read/write (fine-grained), then set it BOTH places:\n" +
  "    gh secret set GH_PAT --body '<token>'      # what the workflows read\n" +
  "    GH_PAT=<token>                             # in .env.local, for local runs\n" +
  "  Do NOT use `gh auth token` — that is the CLI's own OAuth session, which GitHub\n" +
  "  rotates and expires; it is why this chain has broken before."

const ROTATING =
  "this is a `gh auth token`-style CLI OAuth session, not a personal access token.\n" +
  "  GitHub will rotate and expire it out from under CI, and rotation will start\n" +
  "  failing silently when it does."

export function classifyGitHubToken(token: string): GitHubCredential {
  const t = token.trim()

  if (t.startsWith("github_pat_")) {
    return { token: t, shape: "fine-grained-pat", durable: true, warning: null }
  }
  if (t.startsWith("ghp_")) {
    return { token: t, shape: "classic-pat", durable: true, warning: null }
  }
  if (t.startsWith("gho_")) {
    return {
      token: t,
      shape: "oauth-cli",
      durable: false,
      warning: `GH_PAT/GH_TOKEN looks like a \`gho_\` token — ${ROTATING}\n  ${PAT_REMEDIATION}`,
    }
  }
  if (t.startsWith("ghs_")) {
    return {
      token: t,
      shape: "app-installation",
      durable: false,
      warning:
        "GH_PAT/GH_TOKEN looks like a `ghs_` GitHub App installation token, which expires\n" +
        `  within the hour.\n  ${PAT_REMEDIATION}`,
    }
  }
  if (t.startsWith("ghu_")) {
    return {
      token: t,
      shape: "user-to-server",
      durable: false,
      warning:
        "GH_PAT/GH_TOKEN looks like a `ghu_` user-to-server token, which is short-lived\n" +
        `  and refresh-bound.\n  ${PAT_REMEDIATION}`,
    }
  }
  // Enterprise instances and future prefixes exist. Unrecognized is not the
  // same as wrong — say nothing rather than cry wolf on a working credential.
  return { token: t, shape: "unknown", durable: true, warning: null }
}

/**
 * Pick the GitHub credential out of an env-ish bag.
 *
 * GH_PAT wins because that is the name the workflows already read, so local
 * runs and CI resolve to the same secret. A set-but-empty value is treated as
 * unconfigured — `GH_TOKEN=` is a real shape in .env.local and must fall
 * through to the next candidate rather than counting as a token.
 */
export function resolveGitHubCredential(
  ...sources: Array<Record<string, string | undefined>>
): GitHubCredential | null {
  for (const key of ["GH_PAT", "GH_TOKEN"] as const) {
    for (const source of sources) {
      const raw = source?.[key]
      if (raw && raw.trim()) return classifyGitHubToken(raw)
    }
  }
  return null
}
