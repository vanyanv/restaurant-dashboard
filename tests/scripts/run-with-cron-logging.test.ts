import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

const SCRIPT = path.resolve(__dirname, "../../.github/scripts/run-with-cron-logging.sh")
const tmpDirs: string[] = []

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

/**
 * Run the wrapper around a command that fails its first `failures` attempts.
 * Returns the exit code plus how many attempts actually happened.
 */
function run(failures: number, env: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cron-retry-"))
  tmpDirs.push(dir)
  const counter = path.join(dir, "attempts")
  const fake = path.join(dir, "flaky.sh")
  fs.writeFileSync(
    fake,
    `#!/usr/bin/env bash\n` +
      `echo x >> "${counter}"\n` +
      `n=$(wc -l < "${counter}")\n` +
      `if [ "$n" -le ${failures} ]; then echo "attempt $n failing" >&2; exit 7; fi\n` +
      `echo "attempt $n ok"\n`,
    { mode: 0o755 },
  )

  let code = 0
  try {
    execFileSync("bash", [SCRIPT, fake], {
      env: {
        ...process.env,
        LOG_FILE: path.join(dir, "cron.log"),
        GITHUB_OUTPUT: path.join(dir, "gh-output"),
        GITHUB_STEP_SUMMARY: "",
        CRON_RETRY_DELAY: "0",
        ...env,
      },
      stdio: "pipe",
    })
  } catch (err) {
    code = (err as { status: number }).status
  }
  const attempts = fs.existsSync(counter)
    ? fs.readFileSync(counter, "utf8").trim().split("\n").length
    : 0
  const ghOutput = fs.readFileSync(path.join(dir, "gh-output"), "utf8")
  return { code, attempts, ghOutput, log: fs.readFileSync(path.join(dir, "cron.log"), "utf8") }
}

describe("run-with-cron-logging retry", () => {
  it("runs once and succeeds when the command is healthy", () => {
    const r = run(0)
    expect(r.code).toBe(0)
    expect(r.attempts).toBe(1)
  })

  it("does not retry by default — existing workflows keep their behavior", () => {
    const r = run(99)
    expect(r.code).toBe(7)
    expect(r.attempts).toBe(1)
  })

  it("recovers from a transient failure when retries are enabled", () => {
    const r = run(1, { CRON_RETRIES: "2" })
    expect(r.code).toBe(0)
    expect(r.attempts).toBe(2)
  })

  it("gives up after CRON_RETRIES extra attempts and propagates the exit code", () => {
    const r = run(99, { CRON_RETRIES: "2" })
    expect(r.code).toBe(7)
    expect(r.attempts).toBe(3)
  })

  /**
   * The workflow reads steps.cron.outputs.status to label the incident issue.
   * A retried-then-failed run must report the real failure, not the first try.
   */
  it("reports the final status to GITHUB_OUTPUT", () => {
    expect(run(99, { CRON_RETRIES: "1" }).ghOutput).toContain("status=7")
    expect(run(1, { CRON_RETRIES: "1" }).ghOutput).toContain("status=0")
  })

  it("keeps every attempt in the log so the incident shows the whole story", () => {
    const r = run(1, { CRON_RETRIES: "2" })
    expect(r.log).toContain("attempt 1 failing")
    expect(r.log).toContain("attempt 2 ok")
  })
})
