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
function run(failures: number, env: Record<string, string> = {}, failCode = 7) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cron-retry-"))
  tmpDirs.push(dir)
  const counter = path.join(dir, "attempts")
  const fake = path.join(dir, "flaky.sh")
  fs.writeFileSync(
    fake,
    `#!/usr/bin/env bash\n` +
      `echo x >> "${counter}"\n` +
      // BSD `wc -l` left-pads its count ("       1"); GNU does not. The numeric
      // test below tolerates the padding but the echoed text does not, so a
      // macOS run logged "attempt        1 failing" and only the log
      // assertion failed. Strip it here rather than loosen the assertion.
      `n=$(wc -l < "${counter}" | tr -d "[:space:]")\n` +
      `if [ "$n" -le ${failures} ]; then echo "attempt $n failing" >&2; exit ${failCode}; fi\n` +
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

  /**
   * 124 is curl-cron-json.sh's "our --max-time ran out": the server may still
   * be running the request (the COGS sweep's 295s against a 300s
   * maxDuration), so a retry would start a second run beside it.
   */
  it("never retries a client-side timeout (exit 124)", () => {
    const r = run(99, { CRON_RETRIES: "2" }, 124)
    expect(r.code).toBe(124)
    expect(r.attempts).toBe(1)
    expect(r.log).toContain("not retried")
  })
})

describe("curl-cron-json.sh", () => {
  const CURL_SCRIPT = path.resolve(__dirname, "../../.github/scripts/curl-cron-json.sh")
  function curlExit(fakeCurlCode: number): { code: number; stderr: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-curl-"))
    tmpDirs.push(dir)
    fs.writeFileSync(path.join(dir, "curl"), `#!/usr/bin/env bash\nexit ${fakeCurlCode}\n`, { mode: 0o755 })
    try {
      execFileSync("bash", [CURL_SCRIPT, "POST", "https://example.invalid/api/cron/x"], {
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CRON_SECRET: "s", CRON_MAX_TIME: "5" },
        stdio: "pipe",
      })
      return { code: 0, stderr: "" }
    } catch (err) {
      const e = err as { status: number; stderr: Buffer }
      return { code: e.status, stderr: e.stderr.toString() }
    }
  }

  it("turns curl's own timeout (28) into the never-retried 124", () => {
    const r = curlExit(28)
    expect(r.code).toBe(124)
    expect(r.stderr).toContain("not retried")
  })

  it("keeps a connection error's own code, which stays retryable", () => {
    expect(curlExit(7).code).toBe(7)
  })
})
