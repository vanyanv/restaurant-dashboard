import { getRedis } from "@/lib/cache/redis"

/**
 * What the live Cache panel can show.
 *
 * `keys` is reliable on Upstash REST via `DBSIZE`.
 *
 * `memoryBytes` / `commandsToday` are NOT obtainable via the @upstash/redis
 * REST client — Upstash's serverless gateway doesn't expose `INFO` and blocks
 * `EVAL "redis.call('INFO')"`. To surface those, configure a separate
 * UPSTASH_EMAIL + UPSTASH_API_KEY pair and we'll add a Management-API path in
 * a follow-up. Until then they render as "—" in the UI.
 *
 * `available.keys` / `available.memory` / `available.commands` tell the panel
 * which cells to render vs. mask.
 */
export type RedisLive = {
  available: {
    keys: boolean
    memory: boolean
    commands: boolean
  }
  keys: number
  memoryBytes: number | null
  memoryMaxBytes: number | null
  memoryPct: number | null
  commandsToday: number | null
  commandsLimit: number | null
  commandsPct: number | null
}

const DEFAULT_DAILY_CMD_LIMIT = Number(process.env.UPSTASH_DAILY_COMMAND_LIMIT ?? 500_000)

const UNAVAILABLE: RedisLive = {
  available: { keys: false, memory: false, commands: false },
  keys: 0,
  memoryBytes: null, memoryMaxBytes: null, memoryPct: null,
  commandsToday: null, commandsLimit: DEFAULT_DAILY_CMD_LIMIT, commandsPct: null,
}

export async function getRedisLive(): Promise<RedisLive> {
  const r = getRedis()
  if (!r) return UNAVAILABLE

  const keys = await r.dbsize().catch(() => null)
  if (keys === null) return UNAVAILABLE

  return {
    available: { keys: true, memory: false, commands: false },
    keys: Number(keys),
    memoryBytes: null, memoryMaxBytes: null, memoryPct: null,
    commandsToday: null, commandsLimit: DEFAULT_DAILY_CMD_LIMIT, commandsPct: null,
  }
}
