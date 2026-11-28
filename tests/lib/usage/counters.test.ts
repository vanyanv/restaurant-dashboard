import { beforeEach, describe, expect, it, vi } from "vitest"
import { resetMeterForTest, setDefaultSource, takePending } from "@/lib/usage/meter"
import { withUsageCount } from "@/lib/usage/prisma-count"
import { countedRedis } from "@/lib/usage/redis-count"
import { countS3 } from "@/lib/usage/s3-count"

const taken = () =>
  Object.fromEntries(
    (takePending()?.rows ?? []).filter((r) => r[2] !== "cpuMs").map((r) => [`${r[1]}/${r[2]}`, r[3]]),
  )

beforeEach(() => resetMeterForTest())

describe("withUsageCount", () => {
  /** Stands in for a Prisma client: `$extends` hands back what it was given. */
  const fakeClient = () => {
    let hook: (p: { args: unknown; query: (a: unknown) => Promise<unknown> }) => Promise<unknown>
    const client = {
      $extends(ext: { query: { $allOperations: typeof hook } }) {
        hook = ext.query.$allOperations
        return client
      },
      run: (query: (a: unknown) => Promise<unknown>) => hook({ args: { a: 1 }, query }),
    }
    return client
  }

  it("counts each query under the current source and passes the result through", async () => {
    setDefaultSource("sync")
    const client = withUsageCount(fakeClient())
    await expect(client.run(async (args) => ({ got: args }))).resolves.toEqual({ got: { a: 1 } })
    await client.run(async () => 1)
    expect(taken()).toEqual({ "sync/dbQueries": 2 })
  })

  it("counts a query that throws, and throws the same error", async () => {
    const client = withUsageCount(fakeClient())
    const boom = new Error("boom")
    await expect(client.run(async () => { throw boom })).rejects.toBe(boom)
    expect(taken()).toEqual({ "other/dbQueries": 1 })
  })
})

describe("countedRedis", () => {
  const fakeRedis = () => {
    const pipe = (n: { n: number }) => ({
      set() { n.n++; return this },
      get() { n.n++; return this },
      length: () => n.n,
      exec: vi.fn(async () => ["ok"]),
    })
    return {
      name: "upstash",
      get: vi.fn(async function (this: { name: string }, key: string) { return `${this.name}:${key}` }),
      pipeline: () => pipe({ n: 0 }),
      multi: () => pipe({ n: 0 }),
    }
  }

  it("counts one per command and keeps `this`", async () => {
    const redis = countedRedis(fakeRedis() as never) as unknown as ReturnType<typeof fakeRedis>
    await expect(redis.get("k")).resolves.toBe("upstash:k")
    expect(taken()).toEqual({ "other/redisCommands": 1 })
  })

  it("counts a pipeline's commands when it runs, not before", async () => {
    const redis = countedRedis(fakeRedis() as never) as unknown as ReturnType<typeof fakeRedis>
    const p = redis.pipeline()
    p.set().get().set()
    expect(takePending()).toBeNull()
    await expect(p.exec()).resolves.toEqual(["ok"])
    expect(taken()).toEqual({ "other/redisCommands": 3 })
  })

  it("counts a transaction the same way", async () => {
    const redis = countedRedis(fakeRedis() as never) as unknown as ReturnType<typeof fakeRedis>
    const m = redis.multi()
    m.set().set()
    await m.exec()
    expect(taken()).toEqual({ "other/redisCommands": 2 })
  })

  it("passes plain properties through and wraps once", () => {
    const raw = fakeRedis()
    const redis = countedRedis(raw as never) as unknown as ReturnType<typeof fakeRedis>
    expect(redis.name).toBe("upstash")
    expect(redis.get).toBe(redis.get)
    expect(countedRedis(raw as never)).toBe(redis)
  })
})

describe("countS3", () => {
  const fakeS3 = () => {
    let mw: (next: (a: unknown) => Promise<unknown>) => (a: unknown) => Promise<unknown>
    return {
      middlewareStack: { add: (m: typeof mw) => { mw = m } },
      send: (next: (a: unknown) => Promise<unknown>) => mw(next)({}),
    }
  }

  it("counts each R2 call", async () => {
    const s3 = fakeS3()
    countS3(s3 as never)
    await expect(s3.send(async () => "out")).resolves.toBe("out")
    expect(taken()).toEqual({ "other/out:r2": 1 })
  })

  it("counts a refused call and rethrows it", async () => {
    const s3 = fakeS3()
    countS3(s3 as never)
    const err = Object.assign(new Error("slow down"), { $metadata: { httpStatusCode: 503 } })
    await expect(s3.send(async () => { throw err })).rejects.toBe(err)
    const notFound = Object.assign(new Error("nope"), { $metadata: { httpStatusCode: 404 } })
    await expect(s3.send(async () => { throw notFound })).rejects.toBe(notFound)
    expect(taken()).toEqual({ "other/out:r2": 2, "other/out:r2:refused": 1 })
  })
})
