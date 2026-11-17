// Phone pages show a few of an adapter's sections. A load only those
// sections read must run; a load only the hidden ones read must not.

import { describe, it, expect, vi } from "vitest"
import { chooseSections, lazy } from "@/lib/counter/adapters/types"

describe("lazy", () => {
  it("does no work until something waits on it, then does it once", async () => {
    const work = vi.fn(async () => 7)
    const p = lazy(work)
    await Promise.resolve()
    expect(work).not.toHaveBeenCalled()
    expect(await p).toBe(7)
    expect(await Promise.all([p, p])).toEqual([7, 7])
    expect(work).toHaveBeenCalledTimes(1)
  })

  it("turns a throw while starting into a rejection", async () => {
    const p = lazy<number>(() => {
      throw new Error("boom")
    })
    await expect(p).rejects.toThrow("boom")
    await expect(p.catch(() => 1)).resolves.toBe(1)
  })
})

describe("chooseSections", () => {
  const build = () => {
    const shared = vi.fn(async () => 1)
    const deskOnly = vi.fn(async () => 2)
    const sharedP = lazy(shared)
    const deskP = lazy(deskOnly)
    const all = {
      head: lazy(() => sharedP.then((n) => n + 10)),
      desk: lazy(() => Promise.all([sharedP, deskP]).then(([a, b]) => a + b)),
    }
    return { all, shared, deskOnly }
  }

  it("starts only the chosen sections and the loads they read", async () => {
    const { all, shared, deskOnly } = build()
    const picked = chooseSections(all, ["head"] as const)
    expect(Object.keys(picked)).toEqual(["head"])
    expect(await picked.head).toBe(11)
    expect(shared).toHaveBeenCalledTimes(1)
    expect(deskOnly).not.toHaveBeenCalled()
  })

  it("starts everything at once when no list is given", async () => {
    const { all, shared, deskOnly } = build()
    const same = chooseSections(all)
    expect(same).toBe(all)
    await new Promise((r) => setTimeout(r, 0))
    expect(shared).toHaveBeenCalledTimes(1)
    expect(deskOnly).toHaveBeenCalledTimes(1)
  })
})
