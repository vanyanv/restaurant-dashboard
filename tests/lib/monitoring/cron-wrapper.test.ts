import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"

const wrapper = path.resolve(process.cwd(), ".github/scripts/run-with-cron-logging.sh")

describe("run-with-cron-logging.sh", () => {
  it("writes logs and reports status 0 for a successful command", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cron-wrapper-"))
    try {
      const logFile = path.join(dir, "success.log")
      const outputFile = path.join(dir, "github-output")
      const summaryFile = path.join(dir, "summary.md")
      const result = spawnSync("bash", [wrapper, "bash", "-lc", "echo hello"], {
        env: {
          ...process.env,
          LOG_FILE: logFile,
          GITHUB_OUTPUT: outputFile,
          GITHUB_STEP_SUMMARY: summaryFile,
        },
        encoding: "utf-8",
      })

      expect(result.status).toBe(0)
      expect(readFileSync(logFile, "utf-8")).toContain("hello")
      expect(readFileSync(outputFile, "utf-8")).toContain("status=0")
      expect(readFileSync(summaryFile, "utf-8")).toContain("Cron command succeeded")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("preserves the command exit code and stderr in the log", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cron-wrapper-"))
    try {
      const logFile = path.join(dir, "failure.log")
      const outputFile = path.join(dir, "github-output")
      const result = spawnSync("bash", [wrapper, "bash", "-lc", "echo nope >&2; exit 7"], {
        env: {
          ...process.env,
          LOG_FILE: logFile,
          GITHUB_OUTPUT: outputFile,
        },
        encoding: "utf-8",
      })

      expect(result.status).toBe(7)
      expect(readFileSync(logFile, "utf-8")).toContain("nope")
      expect(readFileSync(outputFile, "utf-8")).toContain("status=7")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
