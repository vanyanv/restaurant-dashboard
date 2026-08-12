import { describe, expect, it } from "vitest"

import {
  CRITICAL_AGE_DAYS,
  TOKEN_LIFETIME_DAYS,
  WARN_AGE_DAYS,
  classifyTokenAge,
  summarizeRotation,
  type LegName,
  type LegStatus,
} from "@/lib/harri-rotation-health"

const NOW = new Date("2026-08-12T23:00:00.000Z")

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString()
}

describe("classifyTokenAge", () => {
  it("reports ok with runway for a freshly landed token", () => {
    const v = classifyTokenAge(daysAgo(0.2), NOW)
    expect(v.level).toBe("ok")
    expect(v.ageDays).toBeCloseTo(0.2, 5)
    expect(v.daysUntilExpiry).toBeCloseTo(TOKEN_LIFETIME_DAYS - 0.2, 5)
  })

  it("warns once rotation has not landed for WARN_AGE_DAYS", () => {
    expect(classifyTokenAge(daysAgo(WARN_AGE_DAYS - 0.01), NOW).level).toBe("ok")
    expect(classifyTokenAge(daysAgo(WARN_AGE_DAYS), NOW).level).toBe("warn")
  })

  it("escalates to critical at CRITICAL_AGE_DAYS, while the token is still alive", () => {
    expect(classifyTokenAge(daysAgo(CRITICAL_AGE_DAYS - 0.01), NOW).level).toBe("warn")
    const crit = classifyTokenAge(daysAgo(CRITICAL_AGE_DAYS), NOW)
    expect(crit.level).toBe("critical")
    // The whole point: we alert with runway left, not after the outage.
    expect(crit.daysUntilExpiry).toBeGreaterThan(0)
  })

  it("would have caught the 2026-08-12 incident with days to spare", () => {
    // The GitHub secret was frozen at 2026-07-26T03:47Z because the GitHub leg
    // had been failing silently for three weeks. Cognito still reported the
    // token healthy, so the old heartbeat stayed green until the outage.
    const landed = "2026-07-26T03:47:08Z"
    const at = (iso: string) => classifyTokenAge(landed, new Date(iso))

    // Aug 12 — the day we actually found it by hand. Nothing alarming yet.
    expect(at("2026-08-12T08:00:00Z").level).toBe("ok")
    // Aug 16 — 21d. First nudge, still 9 days of runway.
    expect(at("2026-08-16T08:00:00Z").level).toBe("warn")
    // Aug 21 — 26d. Opens an incident, 4 days before the token dies.
    const crit = at("2026-08-21T08:00:00Z")
    expect(crit.level).toBe("critical")
    expect(crit.daysUntilExpiry).toBeGreaterThan(3)
    expect(crit.message).toContain("rotate-harri-token.sh")
    // Aug 25 — expiry. Without the alert, this is where the syncs start failing.
    expect(at("2026-08-25T08:00:00Z").daysUntilExpiry).toBeLessThanOrEqual(0)
  })

  it("treats an unparseable timestamp as critical rather than silently passing", () => {
    const v = classifyTokenAge("not-a-date", NOW)
    expect(v.level).toBe("critical")
    expect(Number.isNaN(v.ageDays)).toBe(true)
  })

  it("handles a token already past its lifetime", () => {
    const v = classifyTokenAge(daysAgo(35), NOW)
    expect(v.level).toBe("critical")
    expect(v.daysUntilExpiry).toBeLessThan(0)
  })
})

describe("summarizeRotation", () => {
  const allRequired: LegName[] = ["envLocal", "vercel", "github"]

  function legs(over: Partial<Record<LegName, LegStatus>> = {}): Record<LegName, LegStatus> {
    return { envLocal: "ok", vercel: "ok", github: "ok", ...over }
  }

  it("passes when every required leg landed", () => {
    const v = summarizeRotation(legs(), allRequired)
    expect(v.ok).toBe(true)
    expect(v.problems).toEqual([])
  })

  it("fails the run when a required leg failed — the actual 2026-08-12 bug", () => {
    const v = summarizeRotation(legs({ github: "failed" }), allRequired)
    expect(v.ok).toBe(false)
    expect(v.problems).toEqual([{ leg: "github", status: "failed" }])
  })

  it("treats a skipped required leg as a failure, not a shrug", () => {
    // GH_TOKEN simply absent used to log "Skipped" and still exit 0.
    const v = summarizeRotation(legs({ github: "skipped" }), allRequired)
    expect(v.ok).toBe(false)
    expect(v.problems).toEqual([{ leg: "github", status: "skipped" }])
  })

  it("ignores legs that are not required (CI does not write .env.local)", () => {
    const v = summarizeRotation(legs({ envLocal: "skipped" }), ["vercel", "github"])
    expect(v.ok).toBe(true)
    expect(v.lines.join("\n")).toContain("not required")
  })

  it("reports every problem, not just the first", () => {
    const v = summarizeRotation(legs({ vercel: "failed", github: "failed" }), allRequired)
    expect(v.ok).toBe(false)
    expect(v.problems.map((p) => p.leg)).toEqual(["vercel", "github"])
  })

  it("names each leg in the summary so a log reader can see what landed", () => {
    const text = summarizeRotation(legs({ github: "failed" }), allRequired).lines.join("\n")
    expect(text).toContain(".env.local")
    expect(text).toContain("Vercel")
    expect(text).toContain("GitHub Actions")
    expect(text).toContain("FAILED")
  })
})
