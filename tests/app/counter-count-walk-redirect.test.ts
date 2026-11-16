/**
 * `/dashboard/count?store=X&walk=1` and `/m/count?store=X&walk=1`.
 *
 * Inventory used to open on the count, and the store picker opened it on the
 * next item with `?walk=1`. Inventory now opens on the Overview and the count
 * lives at `…/count/walk`, so a link saved from then would land on the
 * Overview with a parameter nothing reads. Both pages send it on to the walk.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  // The real `redirect` throws to stop the render; so does this one.
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`) }),
  shelf: vi.fn(() => ({ shelf: Promise.resolve({ status: "empty" }) })),
}))
vi.mock("next/navigation", () => ({ redirect: h.redirect }))
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => ({ user: { role: "OWNER", accountId: "acct_ours" } })) }))
vi.mock("@/lib/auth", () => ({ authOptions: {}, hasOwnerAccess: () => true }))
vi.mock("@/lib/counter/adapters/inventory-shelf", () => ({ getInventoryShelfSectionPromises: h.shelf }))
vi.mock("@/app/dashboard/(counter)/count/overview-client", () => ({ OverviewClient: () => null }))

import DeskPage from "@/app/dashboard/(counter)/count/page"
import PhonePage from "@/app/(mobile)/m/(counter)/count/page"

beforeEach(() => {
  h.redirect.mockClear()
  h.shelf.mockClear()
})

describe.each([
  ["/dashboard/count", DeskPage],
  ["/m/count", PhonePage],
] as const)("%s", (base, Page) => {
  it("sends an old count link on to the walk, with its store", async () => {
    await expect(Page({ searchParams: Promise.resolve({ store: "store_a", walk: "1" }) })).rejects.toThrow(`REDIRECT ${base}/walk?store=store_a&walk=1`)
    // Nothing is loaded for a page that is not going to render.
    expect(h.shelf).not.toHaveBeenCalled()
  })

  it("sends one with no store to the walk's store picker", async () => {
    await expect(Page({ searchParams: Promise.resolve({ walk: "1" }) })).rejects.toThrow(`REDIRECT ${base}/walk?walk=1`)
  })

  it("encodes the store rather than pasting it into the query", async () => {
    await expect(Page({ searchParams: Promise.resolve({ store: "a b&c", walk: "1" }) })).rejects.toThrow(`REDIRECT ${base}/walk?store=a+b%26c&walk=1`)
  })

  it("is the Overview for every other link, for the store asked for", async () => {
    await Page({ searchParams: Promise.resolve({ store: "store_a" }) })
    expect(h.redirect).not.toHaveBeenCalled()
    expect(h.shelf).toHaveBeenCalledWith({ accountId: "acct_ours", storeId: "store_a" })
  })
})
