import { getRedis } from "@/lib/cache/redis"

export type RedisLive = {
  available: boolean
  keys: number
  memoryBytes: number
  memoryMaxBytes: number
  memoryPct: number
  commandsToday: number
  commandsLimit: number
  commandsPct: number
}

const DEFAULT_DAILY_CMD_LIMIT = Number(process.env.UPSTASH_DAILY_COMMAND_LIMIT ?? 500_000)

/**
 * Pull DBSIZE + memory + command counters from Upstash. Best-effort — any field
 * that fails parsing returns 0. If Upstash isn't configured, returns
 * { available: false } and zeros so the panel can render an empty state.
 */
export async function getRedisLive(): Promise<RedisLive> {
  const r = getRedis()
  if (!r) {
    return {
      available: false,
      keys: 0,
      memoryBytes: 0, memoryMaxBytes: 0, memoryPct: 0,
      commandsToday: 0, commandsLimit: DEFAULT_DAILY_CMD_LIMIT, commandsPct: 0,
    }
  }

  const [keys, info] = await Promise.all([
    r.dbsize().catch(() => 0),
    r.eval<string[], string>(`return redis.call('INFO')`, [], []).catch(() => ""),
  ])

  const used = parseInfoNumber(info, "used_memory")
  const max = parseInfoNumber(info, "maxmemory") || (256 * 1024 * 1024) // free-tier default
  const cmds = parseInfoNumber(info, "total_commands_processed")

  return {
    available: true,
    keys: Number(keys ?? 0),
    memoryBytes: used,
    memoryMaxBytes: max,
    memoryPct: max > 0 ? (used / max) * 100 : 0,
    commandsToday: cmds,
    commandsLimit: DEFAULT_DAILY_CMD_LIMIT,
    commandsPct: DEFAULT_DAILY_CMD_LIMIT > 0 ? (cmds / DEFAULT_DAILY_CMD_LIMIT) * 100 : 0,
  }
}

function parseInfoNumber(info: string, key: string): number {
  const match = info.match(new RegExp(`^${key}:(\\d+)`, "m"))
  return match ? Number(match[1]) : 0
}
