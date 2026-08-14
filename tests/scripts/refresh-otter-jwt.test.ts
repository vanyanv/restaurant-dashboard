import { describe, expect, it } from "vitest"

import { summarizeLegs } from "@/lib/rotation-health"

import { buildLegSpecs, type OtterLegs } from "../../scripts/refresh-otter-jwt"

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
