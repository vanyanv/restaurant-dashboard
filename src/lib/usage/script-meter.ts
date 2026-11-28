/**
 * Usage counting for a script run by GitHub Actions. A script has no Next
 * tracer, so: the whole process is the `sync` source, outside calls are
 * counted by a wrapper on the global `fetch`, and the counts are sent once as
 * the process ends. Database queries and Redis commands are counted by the
 * same wrappers the app uses.
 *
 * Imports nothing from `next/*`.
 */
import { spawnSync } from "node:child_process"
import { PENDING_KEY } from "./flush"
import { serviceOfHost } from "./hosts"
import { count, setDefaultSource, takePending } from "./meter"

let installed: (() => void) | null = null

function hostOf(input: unknown): string | null {
  try {
    if (typeof input === "string") return new URL(input).hostname
    if (input instanceof URL) return input.hostname
    const url = (input as { url?: unknown })?.url
    return typeof url === "string" ? new URL(url).hostname : null
  } catch {
    return null
  }
}

const quoted = (value: string): string => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`

/**
 * Sends the counts as the process ends: one Redis command.
 *
 * Synchronous on purpose. Most scripts end with `process.exit()`, which skips
 * `beforeExit` and waits for no promise, and wrapping `process.exit` to wait
 * would let the code after it keep running. So this runs in the `exit` event
 * and blocks on `curl` for at most two seconds. The token goes to curl on
 * stdin, not on its command line. Any failure is dropped.
 */
export function flushAtExitSync(): void {
  try {
    const url = process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return
    const payload = takePending()
    if (!payload) return
    const body = JSON.stringify(["RPUSH", PENDING_KEY, JSON.stringify(payload)])
    const config = [
      `url = ${quoted(url)}`,
      `header = ${quoted(`Authorization: Bearer ${token}`)}`,
      `header = "Content-Type: application/json"`,
      `data-raw = ${quoted(body)}`,
    ].join("\n")
    spawnSync("curl", ["-s", "-o", "/dev/null", "-m", "2", "-K", "-"], { input: config, timeout: 3000 })
  } catch {
    // Dropped.
  }
}

/** Returns a function that undoes it (tests). Installs once. */
export function installScriptMeter(): () => void {
  if (installed) return installed
  setDefaultSource("sync")

  const innerFetch = globalThis.fetch
  const countedFetch: typeof fetch = async (input, init) => {
    const host = hostOf(input)
    const service = host ? serviceOfHost(host) : null
    if (service) count("sync", `out:${service}`)
    try {
      const response = await innerFetch(input, init)
      if (service && (response.status === 429 || response.status >= 500)) {
        count("sync", `out:${service}:refused`)
      }
      return response
    } catch (error) {
      if (service) count("sync", `out:${service}:refused`)
      throw error
    }
  }
  globalThis.fetch = countedFetch

  process.once("exit", flushAtExitSync)

  installed = () => {
    globalThis.fetch = innerFetch
    process.off("exit", flushAtExitSync)
    setDefaultSource("other")
    installed = null
  }
  return installed
}
