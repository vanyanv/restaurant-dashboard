import { describe, expect, it } from "vitest"
import {
  buildIncidentIssueBody,
  findExistingIncidentIssue,
  summarizeCronFailure,
  tailLogLines,
} from "@/lib/monitoring/github-incidents"

describe("github incident helpers", () => {
  it("builds an issue body with run metadata and a capped log tail", () => {
    const logText = Array.from({ length: 8 }, (_, i) => `line-${i + 1}`).join("\n")

    const body = buildIncidentIssueBody({
      workflowName: "DB Snapshot",
      runUrl: "https://github.com/acme/app/actions/runs/123",
      startedAt: "2026-05-08T18:00:00Z",
      exitCode: "22",
      commitSha: "abcdef123456",
      logText,
      maxLogLines: 3,
    })

    expect(body).toContain("## DB Snapshot failed")
    expect(body).toContain("- Run: https://github.com/acme/app/actions/runs/123")
    expect(body).toContain("- Started: 2026-05-08T18:00:00Z")
    expect(body).toContain("- Exit code: 22")
    expect(body).toContain("- Commit: abcdef123456")
    expect(body).not.toContain("line-5")
    expect(body).toContain("line-6")
    expect(body).toContain("line-8")
  })

  it("finds an existing open incident by exact title and label", () => {
    const issues = [
      { number: 1, title: "[Auto] DB Snapshot failing", labels: [{ name: "other" }] },
      { number: 2, title: "[Auto] DB Snapshot failing", labels: [{ name: "cron-failure" }] },
      { number: 3, title: "[Auto] COGS Sweep failing", labels: [{ name: "cron-failure" }] },
    ]

    expect(findExistingIncidentIssue(issues, "[Auto] DB Snapshot failing", "cron-failure")).toBe(2)
    expect(findExistingIncidentIssue(issues, "[Auto] Missing failing", "cron-failure")).toBeNull()
  })

  it("preserves non-2xx response bodies in cron failure summaries", () => {
    const summary = summarizeCronFailure({
      command: "curl POST /api/cron/db",
      exitCode: 22,
      httpStatus: 500,
      responseBody: '{"error":"database unavailable"}',
      stderr: "curl: (22) The requested URL returned error: 500",
    })

    expect(summary).toContain("curl POST /api/cron/db")
    expect(summary).toContain("exit code 22")
    expect(summary).toContain("HTTP 500")
    expect(summary).toContain('{"error":"database unavailable"}')
    expect(summary).toContain("curl: (22)")
  })

  it("tails logs by line count", () => {
    expect(tailLogLines("a\nb\nc\nd", 2)).toBe("c\nd")
    expect(tailLogLines("a\nb", 5)).toBe("a\nb")
  })
})
