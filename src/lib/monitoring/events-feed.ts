/**
 * Whether the local-events feed (PredictHQ) is connected.
 *
 * PredictHQ is a paid feed and the owner switched it off on 2026-11-20: no
 * key renewal, no replacement. The nightly sync (`ml/external_signal_sync.py`)
 * calls it only with a token AND `EVENTS_PROVIDER_ENABLED=1`; this reads the
 * same flag so every view that reports event freshness says "not connected"
 * instead of reading the switched-off feed as stale or failing.
 *
 * To turn events back on, set `EVENTS_PROVIDER_ENABLED=1` in BOTH places: the
 * GitHub repository variable (for the sync) and the Vercel env (for the app).
 */
type Env = Record<string, string | undefined>

export const EVENTS_PROVIDER = "predicthq"

export const EVENTS_NOT_CONNECTED = "not connected" as const

export function eventsFeedConnected(env: Env = process.env): boolean {
  return env.EVENTS_PROVIDER_ENABLED === "1"
}
