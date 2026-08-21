import { describe, expect, it } from "vitest"

import {
  classifyGitHubToken,
  PAT_REMEDIATION,
  resolveGitHubCredential,
} from "@/lib/github-credential"

/**
 * The rotation chain has now broken three times on the same root cause: the
 * credential that writes Actions secrets was a `gho_` token copied out of the
 * `gh` CLI, which GitHub rotates and expires on its own schedule. Two of these
 * scripts literally recommended that (`gh auth token` works), so the fix kept
 * re-introducing the bug it was fixing.
 *
 * Shape classification is the cheap guard: a rotating token is detectable the
 * moment it is read, months before it 401s at 3am.
 */

describe("classifyGitHubToken", () => {
  it("accepts a classic PAT", () => {
    const c = classifyGitHubToken("ghp_" + "a".repeat(36))
    expect(c.shape).toBe("classic-pat")
    expect(c.durable).toBe(true)
    expect(c.warning).toBeNull()
  })

  it("accepts a fine-grained PAT", () => {
    const c = classifyGitHubToken("github_pat_" + "a".repeat(60))
    expect(c.shape).toBe("fine-grained-pat")
    expect(c.durable).toBe(true)
    expect(c.warning).toBeNull()
  })

  it("flags a gh-CLI OAuth token — the token that keeps dying", () => {
    const c = classifyGitHubToken("gho_" + "a".repeat(36))
    expect(c.shape).toBe("oauth-cli")
    expect(c.durable).toBe(false)
    expect(c.warning).toMatch(/gh auth token/)
    expect(c.warning).toMatch(/rotate/i)
  })

  it("flags short-lived app and user-to-server tokens", () => {
    expect(classifyGitHubToken("ghs_" + "a".repeat(36)).durable).toBe(false)
    expect(classifyGitHubToken("ghu_" + "a".repeat(36)).durable).toBe(false)
  })

  it("does not guess about an unrecognized shape", () => {
    const c = classifyGitHubToken("something-else")
    expect(c.shape).toBe("unknown")
    // Unknown is not assumed broken — it just cannot be vouched for.
    expect(c.durable).toBe(true)
    expect(c.warning).toBeNull()
  })

  it("never echoes the secret back in its warning", () => {
    const secret = "gho_" + "z".repeat(36)
    expect(classifyGitHubToken(secret).warning ?? "").not.toContain(secret)
  })
})

describe("resolveGitHubCredential", () => {
  const PAT = "ghp_" + "a".repeat(36)
  const CLI = "gho_" + "b".repeat(36)

  it("returns null when nothing is configured", () => {
    expect(resolveGitHubCredential({})).toBeNull()
  })

  it("treats an empty value as unconfigured, not as a token", () => {
    // `GH_TOKEN=` is a real shape in .env.local and must fall through.
    expect(resolveGitHubCredential({ GH_TOKEN: "", GH_PAT: "" })).toBeNull()
    expect(resolveGitHubCredential({ GH_PAT: "", GH_TOKEN: PAT })?.token).toBe(PAT)
  })

  it("prefers GH_PAT, the name CI already uses", () => {
    expect(resolveGitHubCredential({ GH_PAT: PAT, GH_TOKEN: CLI })?.token).toBe(PAT)
  })

  it("trims whitespace picked up from .env parsing", () => {
    expect(resolveGitHubCredential({ GH_PAT: `  ${PAT}\n` })?.token).toBe(PAT)
  })

  it("carries the shape warning through to the caller", () => {
    expect(resolveGitHubCredential({ GH_TOKEN: CLI })?.durable).toBe(false)
  })
})

describe("PAT_REMEDIATION", () => {
  it("points at the PAT settings page", () => {
    expect(PAT_REMEDIATION).toMatch(/github\.com\/settings\/tokens/)
    expect(PAT_REMEDIATION).toMatch(/GH_PAT/)
  })

  it("names `gh auth token` only to forbid it", () => {
    // The old remediation text recommended it, which is how a rotating gho_
    // token got into .env.local in the first place. It may still appear — but
    // only inside the prohibition.
    for (const line of PAT_REMEDIATION.split("\n")) {
      if (line.includes("gh auth token")) expect(line).toMatch(/Do NOT use/)
    }
    expect(PAT_REMEDIATION).toMatch(/Do NOT use `gh auth token`/)
  })
})
