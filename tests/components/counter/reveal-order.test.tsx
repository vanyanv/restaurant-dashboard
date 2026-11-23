import { describe, expect, it } from "vitest"
import { createRevealChain, revealKeyFor } from "@/components/counter/surface/reveal-order"

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe("createRevealChain", () => {
  it("holds a quick section until the slow one above it arrives", async () => {
    const chain = createRevealChain()
    const slow = deferred<string>()
    const quick = deferred<string>()
    const top = chain.gate(slow.promise)
    const below = chain.gate(quick.promise)

    let shown = ""
    below.then((v) => (shown = v))
    quick.resolve("channels")
    await tick()
    expect(shown).toBe("")

    slow.resolve("hero")
    await expect(top).resolves.toBe("hero")
    await expect(below).resolves.toBe("channels")
  })

  it("hands back the source itself when nothing above is waiting", () => {
    const chain = createRevealChain()
    const first = Promise.resolve(1)
    expect(chain.gate(first)).toBe(first)
  })

  it("returns the same promise for the same source on a re-render", () => {
    const chain = createRevealChain()
    const a = deferred<number>()
    const b = deferred<number>()
    chain.gate(a.promise)
    const once = chain.gate(b.promise)
    expect(chain.gate(b.promise)).toBe(once)
  })

  it("does not let a failed section above hold the rest back", async () => {
    const chain = createRevealChain()
    const bad = deferred<number>()
    const good = deferred<number>()
    const top = chain.gate(bad.promise)
    top.catch(() => {})
    const below = chain.gate(good.promise)
    bad.reject(new Error("down"))
    good.resolve(2)
    await expect(below).resolves.toBe(2)
  })

  it("does not wait on a section that already arrived", async () => {
    const chain = createRevealChain()
    const done = Promise.resolve(1) as Promise<number> & { status?: string; value?: number }
    done.status = "fulfilled"
    done.value = 1
    chain.gate(done)
    const next = Promise.resolve(2)
    expect(chain.gate(next)).toBe(next)
  })
})

describe("flight-style thenables", () => {
  it("chains a thenable whose then returns undefined and calls back synchronously", async () => {
    // The shape React's flight client hands a client component: not a
    // Promise, `then` returns nothing.
    const callbacks: Array<(v: string) => void> = []
    let settled: string | undefined
    const flight = {
      then(onOk: (v: string) => void) {
        if (settled !== undefined) onOk(settled)
        else callbacks.push(onOk)
      },
    } as unknown as Promise<string>
    const chain = createRevealChain()
    expect(() => chain.gate(flight)).not.toThrow()
    const below = chain.gate(Promise.resolve("next"))
    settled = "top"
    callbacks.forEach((cb) => cb("top"))
    await expect(below).resolves.toBe("next")
  })
})

describe("revealKeyFor", () => {
  it("ignores the open tab and the order of the query", () => {
    expect(revealKeyFor("/dashboard", new URLSearchParams("store=a&tab=trends&range=7d"))).toBe(
      revealKeyFor("/dashboard", new URLSearchParams("range=7d&store=a")),
    )
  })
  it("changes with the store", () => {
    expect(revealKeyFor("/m", new URLSearchParams("store=a"))).not.toBe(revealKeyFor("/m", new URLSearchParams("store=b")))
  })
})
