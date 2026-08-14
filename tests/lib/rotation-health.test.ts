import { describe, expect, it } from "vitest"

import { summarizeLegs, type LegSpec } from "@/lib/rotation-health"

/**
 * Leg accounting shared by every credential rotation (Harri, Otter, whatever
 * comes next). The rules exist because of the 2026-08-12 incident and its twin,
 * found 2026-08-13: a rotation leg that 401s, logs the error, and lets the
 * script exit 0 anyway. See src/lib/rotation-health.ts.
 */

function leg(over: Partial<LegSpec> & Pick<LegSpec, "name">): LegSpec {
  return { label: over.name, status: "ok", required: true, ...over }
}

function allOk(): LegSpec[] {
  return [
    leg({ name: "envLocal", label: ".env.local" }),
    leg({ name: "vercel", label: "Vercel" }),
    leg({ name: "github", label: "GitHub Actions" }),
  ]
}

function withStatus(name: string, status: LegSpec["status"], legs = allOk()): LegSpec[] {
  return legs.map((l) => (l.name === name ? { ...l, status } : l))
}

describe("summarizeLegs", () => {
  it("passes when every required leg landed", () => {
    const v = summarizeLegs(allOk())
    expect(v.ok).toBe(true)
    expect(v.problems).toEqual([])
  })

  it("fails the run when a required leg failed", () => {
    const v = summarizeLegs(withStatus("github", "failed"))
    expect(v.ok).toBe(false)
    expect(v.problems).toEqual([{ leg: "github", status: "failed" }])
  })

  it("treats a skipped required leg as a failure, not a shrug", () => {
    // A missing credential used to print "Skipped" and still exit 0 —
    // indistinguishable from success on an unattended timer, where the exit
    // code is the only signal that escapes.
    const v = summarizeLegs(withStatus("github", "skipped"))
    expect(v.ok).toBe(false)
    expect(v.problems).toEqual([{ leg: "github", status: "skipped" }])
  })

  it("ignores legs that are not required (CI has no .env.local to write)", () => {
    const legs = allOk().map((l) =>
      l.name === "envLocal" ? { ...l, status: "skipped" as const, required: false } : l
    )
    const v = summarizeLegs(legs)
    expect(v.ok).toBe(true)
    expect(v.lines.join("\n")).toContain("not required")
  })

  it("reports every problem, not just the first", () => {
    const v = summarizeLegs(withStatus("github", "failed", withStatus("vercel", "failed")))
    expect(v.ok).toBe(false)
    expect(v.problems.map((p) => p.leg)).toEqual(["vercel", "github"])
  })

  it("names each leg in the summary so a log reader can see what landed", () => {
    const text = summarizeLegs(withStatus("github", "failed")).lines.join("\n")
    expect(text).toContain(".env.local")
    expect(text).toContain("Vercel")
    expect(text).toContain("GitHub Actions")
    expect(text).toContain("FAILED")
  })

  it("preserves leg order in the summary rather than sorting by status", () => {
    const text = summarizeLegs(allOk()).lines.join("\n")
    expect(text.indexOf(".env.local")).toBeLessThan(text.indexOf("Vercel"))
    expect(text.indexOf("Vercel")).toBeLessThan(text.indexOf("GitHub Actions"))
  })

  it("supports rotations with legs beyond the standard three", () => {
    // Otter has a fourth step — redeploying Vercel so the new JWT actually
    // takes effect in the running production deployment.
    const legs = [...allOk(), leg({ name: "redeploy", label: "Vercel redeploy", status: "failed" })]
    const v = summarizeLegs(legs)
    expect(v.ok).toBe(false)
    expect(v.problems).toEqual([{ leg: "redeploy", status: "failed" }])
    expect(v.lines.join("\n")).toContain("Vercel redeploy")
  })

  it("an empty required set makes any outcome pass (--allow-partial)", () => {
    const legs = allOk().map((l) => ({ ...l, status: "failed" as const, required: false }))
    expect(summarizeLegs(legs).ok).toBe(true)
  })
})
