import { describe, expect, it, vi } from "vitest"
import { withPrismaRetry } from "@/lib/prisma-retry"

function err(code: string, message = code) {
  const e = new Error(message) as Error & { code?: string }
  e.code = code
  return e
}

describe("withPrismaRetry", () => {
  it("retries a transient connection error and then succeeds", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(err("ETIMEDOUT", "Invalid `prisma.jobRun.create()` ... ETIMEDOUT"))
      .mockResolvedValueOnce("ok")

    const result = await withPrismaRetry(fn, { baseMs: 0 })

    expect(result).toBe("ok")
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("retries known transient Prisma connection codes (P1001/P1002/P1008/P1017)", async () => {
    for (const code of ["P1001", "P1002", "P1008", "P1017", "ECONNRESET"]) {
      const fn = vi
        .fn<() => Promise<number>>()
        .mockRejectedValueOnce(err(code))
        .mockResolvedValueOnce(42)
      await expect(withPrismaRetry(fn, { baseMs: 0 })).resolves.toBe(42)
      expect(fn).toHaveBeenCalledTimes(2)
    }
  })

  it("does NOT retry a normal query error", async () => {
    const fn = vi.fn<() => Promise<never>>().mockRejectedValue(err("P2002", "Unique constraint failed"))

    await expect(withPrismaRetry(fn, { baseMs: 0 })).rejects.toThrow("Unique constraint failed")
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("gives up after the retry budget on a persistent transient error", async () => {
    const fn = vi.fn<() => Promise<never>>().mockRejectedValue(err("ETIMEDOUT"))

    await expect(withPrismaRetry(fn, { baseMs: 0, retries: 3 })).rejects.toThrow("ETIMEDOUT")
    expect(fn).toHaveBeenCalledTimes(3)
  })
})
