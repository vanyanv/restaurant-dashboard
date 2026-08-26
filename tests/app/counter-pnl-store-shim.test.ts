/**
 * `/dashboard/pnl/<id>` after the rebuild.
 *
 * The Counter P&L takes its store from `?store=`, so the per-store route is
 * gone as a PAGE — but it is a URL owners have bookmarked, the phone's P&L
 * links to it, the Overview's store cards link to it, and two server actions
 * call `revalidatePath` on it. A 404 there would be a regression dressed up as
 * a rebuild, so it survives as a shim until Phase F removes the shims
 * together. This is the test that says so.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect, vi, beforeEach } from "vitest"

// `vi.hoisted`, because `vi.mock`'s factory runs before any module-level
// `const` in this file has been initialised.
const { permanentRedirect } = vi.hoisted(() => ({ permanentRedirect: vi.fn() }))
vi.mock("next/navigation", () => ({ permanentRedirect }))

import StorePnlRedirect from "@/app/dashboard/pnl/[storeId]/page"

beforeEach(() => permanentRedirect.mockClear())

describe("/dashboard/pnl/[storeId]", () => {
  it("sends a bookmarked per-store URL to the one P&L, scoped by ?store=", async () => {
    // `?store=` is what `writeCounterParams` writes and `readCounterParams`
    // reads — the same param the rail's store switcher sets.
    await StorePnlRedirect({ params: Promise.resolve({ storeId: "hollywood" }) })
    expect(permanentRedirect).toHaveBeenCalledWith("/dashboard/pnl?store=hollywood")
  })

  it("encodes the id rather than pasting it into a query string", async () => {
    await StorePnlRedirect({ params: Promise.resolve({ storeId: "a b&c=d" }) })
    expect(permanentRedirect).toHaveBeenCalledWith("/dashboard/pnl?store=a%20b%26c%3Dd")
  })

  it("is a redirect and nothing else — no second copy of the owner gate to drift", () => {
    // `/dashboard/pnl` gates on `hasOwnerAccess` one line after the session
    // check. A shim that gated too would be the same decision written twice,
    // and the store id is deliberately not validated here either: the adapter
    // answers a store the account does not own with the `no_match` empty
    // state, which explains itself where a 404 does not.
    const src = readFileSync(
      join(process.cwd(), "src/app/dashboard/pnl/[storeId]/page.tsx"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")
    expect(src).toContain("permanentRedirect")
    expect(src).not.toMatch(/@\/lib\/auth|@\/lib\/prisma|@\/app\/actions/)
    expect(src).not.toContain("notFound")
  })
})
