import { describe, expect, it } from "vitest"

import { summarizeLegs } from "@/lib/rotation-health"

import {
  buildLegSpecs,
  jwtFromAuthHeader,
  jwtFromBody,
  looksLikeLiveJwt,
  MIN_TOKEN_LIFETIME_S,
  rankCandidates,
  redactUrl,
  secondsLeft,
  type OtterLegs,
} from "../../scripts/refresh-otter-jwt"

/**
 * Which legs a run is allowed to fail. Pinned because these are judgment calls,
 * not mechanics — and because the bug they replace (2026-08-13) was precisely a
 * failed leg that the script decided didn't matter.
 */

function legs(over: Partial<OtterLegs> = {}): OtterLegs {
  return { envLocal: "ok", vercel: "ok", github: "ok", redeploy: "ok", ...over }
}

function verdict(over: Partial<OtterLegs> = {}, opts = { isCI: false, allowPartial: false }) {
  return summarizeLegs(buildLegSpecs(legs(over), opts))
}

const LOCAL = { isCI: false, allowPartial: false }
const CI = { isCI: true, allowPartial: false }

describe("buildLegSpecs", () => {
  it("passes when every leg landed", () => {
    expect(verdict().ok).toBe(true)
  })

  it("fails when the GitHub leg dies — the 78-day frozen-secret bug", () => {
    // Previously: console.error, bare return, exit 0, workflow reports success.
    const v = verdict({ github: "failed" }, CI)
    expect(v.ok).toBe(false)
    expect(v.problems).toEqual([{ leg: "github", status: "failed" }])
  })

  it("fails when the GitHub credential is simply absent", () => {
    // A missing GH_PAT/GH_TOKEN is "skipped", which used to exit 0 — on an
    // unattended daily cron that is indistinguishable from success.
    expect(verdict({ github: "skipped" }, CI).ok).toBe(false)
  })

  it("fails when the Vercel leg dies", () => {
    expect(verdict({ vercel: "failed" }, CI).ok).toBe(false)
  })

  it("does not require .env.local in CI — there is no file to write", () => {
    const v = verdict({ envLocal: "skipped" }, CI)
    expect(v.ok).toBe(true)
    expect(v.lines.join("\n")).toContain("not required")
  })

  it("does require .env.local locally", () => {
    expect(verdict({ envLocal: "failed" }, LOCAL).ok).toBe(false)
  })

  it("never fails the run on a missed redeploy", () => {
    // Deliberate: getOtterJwt() falls back to a live sign-in when the deployed
    // env var is stale, so a failed redeploy is not an outage. It is still
    // reported, so a log reader sees it.
    const v = verdict({ redeploy: "failed" }, CI)
    expect(v.ok).toBe(true)
    expect(v.lines.join("\n")).toContain("Vercel redeploy")
    expect(v.lines.join("\n")).toContain("FAILED")
  })

  it("--allow-partial drops every requirement", () => {
    const all: OtterLegs = {
      envLocal: "failed",
      vercel: "failed",
      github: "failed",
      redeploy: "failed",
    }
    expect(summarizeLegs(buildLegSpecs(all, { isCI: false, allowPartial: true })).ok).toBe(true)
  })

  it("reports every failed store, not just the first", () => {
    const v = verdict({ vercel: "failed", github: "failed" }, CI)
    expect(v.problems.map((p) => p.leg)).toEqual(["vercel", "github"])
  })

  it("lists all four legs in the summary regardless of outcome", () => {
    const text = verdict().lines.join("\n")
    for (const label of [".env.local", "Vercel", "GitHub Actions", "Vercel redeploy"]) {
      expect(text).toContain(label)
    }
  })
})

/**
 * Token pickers for the sign-in. Since 2026-11-06 about every other nightly
 * run landed on Otter's new single sign-on page (iam.cloudkitchens.com),
 * which never calls the old /api/users/sign_in endpoint the script waited
 * for. The script now takes a token from wherever one turns up and lets
 * verifyToken() decide, so these only have to recognise a token's shape.
 */

const NOW = Date.UTC(2026, 10, 17, 20, 0, 0)

function fakeJwt(expSeconds: number): string {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url")
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub: "u1", exp: expSeconds })}.c2lnbmF0dXJl`
}

const LIVE = fakeJwt(NOW / 1000 + 3600)
const EXPIRED = fakeJwt(NOW / 1000 - 60)

describe("looksLikeLiveJwt", () => {
  it("accepts a three-part token whose exp is ahead", () => {
    expect(looksLikeLiveJwt(LIVE, NOW)).toBe(true)
  })
  it("refuses an expired token, a non-token and a non-string", () => {
    expect(looksLikeLiveJwt(EXPIRED, NOW)).toBe(false)
    expect(looksLikeLiveJwt("not.a.jwt!", NOW)).toBe(false)
    expect(looksLikeLiveJwt("abc", NOW)).toBe(false)
    expect(looksLikeLiveJwt(undefined, NOW)).toBe(false)
    expect(looksLikeLiveJwt(42, NOW)).toBe(false)
  })
  it("refuses a token with no exp", () => {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url")
    expect(looksLikeLiveJwt(`${enc({})}.${enc({ sub: "u" })}.x`, NOW)).toBe(false)
  })
})

describe("jwtFromAuthHeader", () => {
  it("reads a Bearer header, the way the old sign-in answered", () => {
    expect(jwtFromAuthHeader(`Bearer ${LIVE}`, NOW)).toBe(LIVE)
    expect(jwtFromAuthHeader(`bearer ${LIVE}`, NOW)).toBe(LIVE)
  })
  it("ignores missing, expired and non-token headers", () => {
    expect(jwtFromAuthHeader(undefined, NOW)).toBeNull()
    expect(jwtFromAuthHeader(`Bearer ${EXPIRED}`, NOW)).toBeNull()
    expect(jwtFromAuthHeader("Basic dXNlcjpwYXNz", NOW)).toBeNull()
  })
})

describe("jwtFromBody", () => {
  it("reads accessToken (old sign-in body) and access_token (OAuth token exchange)", () => {
    expect(jwtFromBody({ accessToken: LIVE }, NOW)).toBe(LIVE)
    expect(jwtFromBody({ access_token: LIVE, token_type: "Bearer" }, NOW)).toBe(LIVE)
  })
  it("ignores bodies without a live token", () => {
    expect(jwtFromBody(null, NOW)).toBeNull()
    expect(jwtFromBody([LIVE], NOW)).toBeNull()
    expect(jwtFromBody({ accessToken: EXPIRED }, NOW)).toBeNull()
    expect(jwtFromBody({ refresh_token: "opaque" }, NOW)).toBeNull()
  })
})

describe("redactUrl", () => {
  it("keeps host and path, drops one-time codes in the query", () => {
    expect(
      redactUrl("https://iam.cloudkitchens.com/login/?splash=generic&oauth2_authorize_request_id=abc"),
    ).toBe("iam.cloudkitchens.com/login/")
    expect(redactUrl("https://manager.tryotter.com/callback?code=secret#x")).toBe(
      "manager.tryotter.com/callback",
    )
  })
  it("never throws on junk", () => {
    expect(redactUrl("not a url")).toBe("(unparseable url)")
  })
})

describe("rankCandidates", () => {
  const DAY = fakeJwt(NOW / 1000 + 24 * 3600)
  const TWO_DAYS = fakeJwt(NOW / 1000 + 48 * 3600)
  const ONE_HOUR = fakeJwt(NOW / 1000 + 3600)

  it("drops tokens that would die before the next nightly run", () => {
    expect(rankCandidates([ONE_HOUR], NOW)).toEqual([])
    expect(MIN_TOKEN_LIFETIME_S).toBeGreaterThanOrEqual(12 * 3600)
  })
  it("tries the longest-lived token first", () => {
    expect(rankCandidates([ONE_HOUR, DAY, TWO_DAYS], NOW)).toEqual([TWO_DAYS, DAY])
  })
  it("reads the time left from exp", () => {
    expect(secondsLeft(DAY, NOW)).toBe(24 * 3600)
    expect(secondsLeft("junk", NOW)).toBeNull()
  })
})
