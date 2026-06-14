/**
 * fetch with an AbortController-based timeout. A hung upstream (Yelp, Microsoft
 * Graph, Harri auth, …) otherwise blocks the calling cron indefinitely. Lifted
 * from the inline pattern in src/lib/otter.ts so every integration shares it.
 *
 * Throws an Error whose message contains "timed out" when the request outlasts
 * `timeoutMs`; passes any other fetch rejection through unchanged.
 */
export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = 30_000,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
