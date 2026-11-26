import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Pool } from "pg"
import { attachDatabasePool } from "@vercel/functions"
import { DEFAULT_POOL_IDLE_MS, poolIdleMs } from "@/lib/pg-pool-idle"

// `poolIdleMs(undefined)` falls back to the environment, so a machine that
// sets the override must not change what "the default" means in these tests.
beforeEach(() => {
  vi.stubEnv("DATABASE_POOL_IDLE_MS", "")
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe("poolIdleMs", () => {
  it("reads DATABASE_POOL_IDLE_MS when called with nothing", () => {
    vi.stubEnv("DATABASE_POOL_IDLE_MS", "5000")
    expect(poolIdleMs()).toBe(5_000)
  })

  it("is 2 seconds unless overridden", () => {
    expect(DEFAULT_POOL_IDLE_MS).toBe(2_000)
    expect(poolIdleMs(undefined)).toBe(2_000)
    expect(poolIdleMs("")).toBe(2_000)
    expect(poolIdleMs("  ")).toBe(2_000)
  })

  it("takes a whole number of milliseconds from the override", () => {
    expect(poolIdleMs("5000")).toBe(5_000)
    expect(poolIdleMs("100")).toBe(100)
    expect(poolIdleMs("60000")).toBe(60_000)
  })

  it("ignores an override that would turn the timeout off or is not a sane number", () => {
    // 0 means "never close an idle client" to node-postgres.
    expect(poolIdleMs("0")).toBe(2_000)
    expect(poolIdleMs("-1")).toBe(2_000)
    expect(poolIdleMs("99")).toBe(2_000)
    expect(poolIdleMs("60001")).toBe(2_000)
    expect(poolIdleMs("1500.5")).toBe(2_000)
    expect(poolIdleMs("2s")).toBe(2_000)
  })
})

describe("the pool's idle timeout", () => {
  it("is what node-postgres defaults to 10 s when nothing sets it", () => {
    // The default this change replaces. If node-postgres ever changes it,
    // the docblock in pg-pool-idle.ts is describing history.
    const pool = new Pool({ connectionString: "postgresql://u:p@localhost:1/db" })
    expect((pool as unknown as { options: { idleTimeoutMillis: number } }).options.idleTimeoutMillis).toBe(10_000)
  })

  it("is read by attachDatabasePool from options.idleTimeoutMillis", () => {
    const pool = new Pool({
      connectionString: "postgresql://u:p@localhost:1/db",
      idleTimeoutMillis: poolIdleMs(undefined),
    })
    expect((pool as unknown as { options: { idleTimeoutMillis: number } }).options.idleTimeoutMillis).toBe(2_000)
  })

  it("is set on the one pool in src/lib/prisma.ts", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/prisma.ts"), "utf8")
    expect(source).toMatch(/idleTimeoutMillis:\s*poolIdleMs\(\)/)
  })
})

/**
 * The mechanism itself, against the real `@vercel/functions`: each time a
 * client goes back to the pool, the instance is held (`waitUntil`) for the
 * pool's idle timeout plus 100 ms. This is what made the idle timeout a bill.
 */
describe("how long attachDatabasePool holds a Vercel instance after a query", () => {
  const CONTEXT = Symbol.for("@vercel/request-context")
  const g = globalThis as unknown as Record<symbol, unknown>

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    delete g[CONTEXT]
  })

  async function heldForMs(idleTimeoutMillis: number | undefined): Promise<number> {
    vi.useFakeTimers()
    vi.stubEnv("VERCEL_URL", "example.vercel.app")
    vi.stubEnv("VERCEL_REGION", "iad1")
    const held: Promise<unknown>[] = []
    g[CONTEXT] = { get: () => ({ waitUntil: (p: Promise<unknown>) => held.push(p) }) }

    const pool = new Pool({
      connectionString: "postgresql://u:p@localhost:1/db",
      ...(idleTimeoutMillis === undefined ? {} : { idleTimeoutMillis }),
    })
    attachDatabasePool(pool)
    pool.emit("release", undefined, {})
    expect(held).toHaveLength(1)

    let done = false
    void held[0].then(() => {
      done = true
    })
    let elapsed = 0
    while (!done && elapsed < 30_000) {
      await vi.advanceTimersByTimeAsync(50)
      elapsed += 50
    }
    return elapsed
  }

  it("was 10.1 s with node-postgres's default", async () => {
    expect(await heldForMs(undefined)).toBe(10_100)
  })

  it("is 2.1 s with this app's setting", async () => {
    expect(await heldForMs(poolIdleMs(undefined))).toBe(2_100)
  })
})
