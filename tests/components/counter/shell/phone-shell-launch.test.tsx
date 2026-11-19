// @vitest-environment jsdom
/**
 * Home-screen launch: the phone frame must paint before the database answers.
 *
 * `src/app/(mobile)/m/(counter)/layout.tsx` hands `PhoneShell` the store list
 * as a PROMISE. While it is pending the page content and the top bar are
 * already on screen; only the store button's label waits. Before this, the
 * layout awaited the list and a sleeping Neon compute held the whole response,
 * which an owner saw as ten seconds of black screen.
 */
import { describe, it, expect, vi } from "vitest"
import { act, render, screen } from "@testing-library/react"
import { readFileSync } from "node:fs"
import path from "node:path"

let search = ""
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/m",
  useSearchParams: () => new URLSearchParams(search),
}))

import { PhoneShell } from "@/components/counter"

const STORES = [
  { id: "s1", name: "Hollywood", stage: "trading" as const },
  { id: "s2", name: "Glendale", stage: "trading" as const },
]

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe("PhoneShell with a store list still on its way", () => {
  it("paints the page and top bar first, then the picked store's name", async () => {
    search = "store=s2"
    const list = deferred<typeof STORES>()
    // Rendered inside an async act so React's retry after the promise settles
    // is flushed (a bare `render` leaves a suspended `use()` pending forever
    // under React 19's act environment).
    await act(async () => {
      render(
        <PhoneShell stores={list.promise}>
          <p>page body</p>
        </PhoneShell>,
      )
    })
    expect(screen.getByText("page body")).toBeTruthy()
    // A picked store is not "All stores" while its name is unknown.
    expect(screen.getByRole("button", { name: /^Store/ })).toBeTruthy()

    await act(async () => list.resolve(STORES))
    expect(await screen.findByRole("button", { name: /Glendale/ })).toBeTruthy()
  })

  it("reads All stores at once when no store is picked", () => {
    search = ""
    render(
      <PhoneShell stores={deferred<typeof STORES>().promise}>
        <p>page body</p>
      </PhoneShell>,
    )
    expect(screen.getByRole("button", { name: /All stores/ })).toBeTruthy()
  })
})

describe("the phone layouts do not wait on the database", () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8")

  it("the /m frame reads the session cookie, not getServerSession", () => {
    const src = read("src/app/(mobile)/m/layout.tsx")
    expect(src).not.toMatch(/getServerSession\(/)
    expect(src).toMatch(/readSessionToken\(\)/)
  })

  it("the Counter phone layout does not await the store list", () => {
    const src = read("src/app/(mobile)/m/(counter)/layout.tsx")
    expect(src).not.toMatch(/await\s+getOverviewStores/)
  })
})
