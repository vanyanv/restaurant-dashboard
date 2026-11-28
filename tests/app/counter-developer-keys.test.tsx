// @vitest-environment jsdom
/**
 * The developer portal's Keys tab. The only screen in the app that shows a
 * secret, so what is pinned here is mostly what must NOT happen: no value
 * before the password, none left after the lock or the five minutes, none in
 * storage, an attribute or the address, and one flat message for a refused
 * password.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import "../setup/dialog-shim"

vi.mock("@/lib/counter/actions/developer", () => ({
  unlockKeys: vi.fn(),
  revealKey: vi.fn(),
  exportEnvFile: vi.fn(),
  lockKeys: vi.fn(),
}))

import { exportEnvFile, lockKeys, revealKey, unlockKeys } from "@/lib/counter/actions/developer"
import type { DeveloperKeyRow, DeveloperKeys } from "@/lib/counter/adapters/developer"
import { KeysPanel } from "@/app/dashboard/(counter)/admin/developer/developer-keys"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const SECRET = "sk-live-THE-REAL-VALUE-123"
const PASSWORD = "correct horse battery"

const row = (name: string, over: Partial<DeveloperKeyRow> = {}): DeveloperKeyRow => ({
  name,
  connectionName: "OpenAI",
  icon: "openai",
  secret: true,
  setHere: true,
  vercel: { type: "encrypted", targets: ["production", "preview", "development"] },
  github: false,
  state: "ok",
  canReveal: true,
  ...over,
})

function keysOf(rows: DeveloperKeyRow[], over: Partial<DeveloperKeys> = {}): DeveloperKeys {
  const counts = { ok: 0, missing: 0, unused: 0, githubOnly: 0, notNeededHere: 0 }
  for (const r of rows) counts[r.state]++
  return { rows, counts, vercelStatus: { ok: true }, valuesAvailable: true, ...over }
}

const BASIC = [
  row("OPENAI_API_KEY"),
  row("SHOP_API_URL", { connectionName: "Shop site", icon: "shop", secret: false, setHere: false, state: "missing", canReveal: false, vercel: null }),
  row("PREDICTHQ_API_TOKEN", { connectionName: "PredictHQ", icon: "events", setHere: false, state: "githubOnly", canReveal: false, vercel: null, github: true }),
  row("GROQ_API_KEY", { connectionName: null, icon: "key", setHere: false, state: "unused", canReveal: false }),
  row("OTTER_JWT", { connectionName: "Otter", icon: "orders", setHere: false, state: "notNeededHere", canReveal: false, vercel: null, localNote: "Only for a one-off import." }),
]

const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString()

function rowOf(name: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-key-row="${name}"]`)
  if (!el) throw new Error(`no row for ${name}`)
  return el
}

const dialog = () => document.querySelector("dialog")

/** Types the password into the open dialog and submits it. */
function unlockWith(password: string) {
  const d = dialog()!
  const input = d.querySelector<HTMLInputElement>('input[type="password"]')!
  fireEvent.change(input, { target: { value: password } })
  // jsdom's FormData reads the live value, as the component does.
  input.value = password
  fireEvent.submit(d.querySelector("form")!)
}

let writeText: ReturnType<typeof vi.fn>
let setItem: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  asMock(unlockKeys).mockReset().mockImplementation(async () => ({ ok: true, expiresAt: inAnHour() }))
  asMock(revealKey).mockReset().mockImplementation(async () => ({ ok: true, value: SECRET }))
  asMock(exportEnvFile).mockReset()
  asMock(lockKeys).mockReset().mockResolvedValue({ ok: true })
  writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
  setItem = vi.spyOn(Storage.prototype, "setItem")
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("Keys tab: locked until the password", () => {
  it("shows names and where each lives, and no value, before anything is pressed", () => {
    render(<KeysPanel keys={keysOf(BASIC)} />)
    expect(within(rowOf("OPENAI_API_KEY")).getByText("OpenAI")).toBeTruthy()
    expect(within(rowOf("OPENAI_API_KEY")).getByText("Vercel")).toBeTruthy()
    expect(within(rowOf("PREDICTHQ_API_TOKEN")).getByText("GitHub")).toBeTruthy()
    expect(document.body.textContent).not.toContain(SECRET)
    expect(revealKey).not.toHaveBeenCalled()
    expect(dialog()).toBeNull()
  })

  it("asks for the password first, then reveals, and says until when", async () => {
    render(<KeysPanel keys={keysOf(BASIC)} />)
    fireEvent.click(screen.getByRole("button", { name: "Reveal OPENAI_API_KEY" }))

    // The dialog is a real modal, and nothing was asked of the server yet.
    expect(dialog()?.open).toBe(true)
    expect(revealKey).not.toHaveBeenCalled()

    unlockWith(PASSWORD)
    await waitFor(() => expect(rowOf("OPENAI_API_KEY").textContent).toContain(SECRET))
    expect(unlockKeys).toHaveBeenCalledWith(PASSWORD)
    expect(revealKey).toHaveBeenCalledWith("OPENAI_API_KEY")
    expect(dialog()).toBeNull()
    expect(screen.getByText(/^Unlocked until \d{1,2}:\d{2} (am|pm)$/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Lock now" })).toBeTruthy()
  })

  it("says one flat thing for a refused password and keeps nothing of what was typed", async () => {
    asMock(unlockKeys).mockResolvedValue({ ok: false })
    const logs = ["log", "info", "warn", "error", "debug"].map((m) => vi.spyOn(console, m as "log").mockImplementation(() => {}))
    render(<KeysPanel keys={keysOf(BASIC)} />)
    fireEvent.click(screen.getByRole("button", { name: "Reveal OPENAI_API_KEY" }))
    unlockWith(PASSWORD)

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("That didn't work. Check the password and try again."))
    expect(dialog()?.open).toBe(true)
    expect(dialog()!.querySelector<HTMLInputElement>("input")!.value).toBe("")
    expect(revealKey).not.toHaveBeenCalled()
    expect(document.body.innerHTML).not.toContain(PASSWORD)
    for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain(PASSWORD)
  })

  it("says the same thing when the unlock call itself throws", async () => {
    asMock(unlockKeys).mockRejectedValue(new Error("offline"))
    render(<KeysPanel keys={keysOf(BASIC)} />)
    fireEvent.click(screen.getByRole("button", { name: "Reveal OPENAI_API_KEY" }))
    unlockWith(PASSWORD)
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("That didn't work. Check the password and try again."))
  })

  it("closing the dialog asks nothing of the server", () => {
    render(<KeysPanel keys={keysOf(BASIC)} />)
    fireEvent.click(screen.getByRole("button", { name: "Copy OPENAI_API_KEY" }))
    fireEvent.click(within(dialog()!).getByRole("button", { name: "Cancel" }))
    expect(dialog()).toBeNull()
    expect(unlockKeys).not.toHaveBeenCalled()
    expect(revealKey).not.toHaveBeenCalled()
  })
})

describe("Keys tab: a value does not outlive its unlock", () => {
  async function revealed() {
    render(<KeysPanel keys={keysOf(BASIC)} />)
    fireEvent.click(screen.getByRole("button", { name: "Reveal OPENAI_API_KEY" }))
    unlockWith(PASSWORD)
    await waitFor(() => expect(rowOf("OPENAI_API_KEY").textContent).toContain(SECRET))
  }

  it("clears every value when the time runs out, and is locked again", async () => {
    asMock(unlockKeys).mockImplementation(async () => ({ ok: true, expiresAt: new Date(Date.now() + 150).toISOString() }))
    await revealed()
    await waitFor(() => expect(document.body.textContent).not.toContain(SECRET), { timeout: 3000 })
    expect(screen.queryByText(/Unlocked until/)).toBeNull()
    expect(screen.getByRole("status").textContent).toMatch(/Locked again/)

    // Locked means the password again, not a quiet second reveal.
    asMock(revealKey).mockClear()
    fireEvent.click(screen.getByRole("button", { name: "Reveal OPENAI_API_KEY" }))
    expect(dialog()?.open).toBe(true)
    expect(revealKey).not.toHaveBeenCalled()
  })

  it("Lock now clears the values and tells the server", async () => {
    await revealed()
    fireEvent.click(screen.getByRole("button", { name: "Lock now" }))
    expect(document.body.textContent).not.toContain(SECRET)
    expect(lockKeys).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Unlocked until/)).toBeNull()
  })

  it("Hide takes one value off the screen", async () => {
    await revealed()
    fireEvent.click(screen.getByRole("button", { name: "Hide OPENAI_API_KEY" }))
    expect(document.body.textContent).not.toContain(SECRET)
  })

  it("is gone when the panel is unmounted and mounted again (leaving the tab)", async () => {
    await revealed()
    cleanup()
    render(<KeysPanel keys={keysOf(BASIC)} />)
    expect(document.body.textContent).not.toContain(SECRET)
    expect(screen.queryByText(/Unlocked until/)).toBeNull()
  })

  it("never writes a value to storage, an attribute or the address", async () => {
    const before = window.location.href
    await revealed()
    fireEvent.click(screen.getByRole("button", { name: "Copy OPENAI_API_KEY" }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SECRET))

    expect(setItem).not.toHaveBeenCalled()
    expect(JSON.stringify({ ...localStorage })).not.toContain(SECRET)
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(SECRET)
    expect(window.location.href).toBe(before)
    const attributes = [...document.querySelectorAll("*")].flatMap((el) => [...el.attributes].map((a) => a.value))
    expect(attributes.filter((v) => v.includes(SECRET))).toEqual([])
  })
})

describe("Keys tab: what the server refuses, in words", () => {
  async function unlockedThen(code: string) {
    render(<KeysPanel keys={keysOf(BASIC)} />)
    fireEvent.click(screen.getByRole("button", { name: "Reveal OPENAI_API_KEY" }))
    unlockWith(PASSWORD)
    await waitFor(() => expect(rowOf("OPENAI_API_KEY").textContent).toContain(SECRET))
    fireEvent.click(screen.getByRole("button", { name: "Hide OPENAI_API_KEY" }))
    asMock(revealKey).mockResolvedValue({ ok: false, code })
    fireEvent.click(screen.getByRole("button", { name: "Reveal OPENAI_API_KEY" }))
  }

  it("locked: drops what it holds and asks for the password again", async () => {
    await unlockedThen("locked")
    await waitFor(() => expect(dialog()?.open).toBe(true))
    expect(screen.queryByText(/Unlocked until/)).toBeNull()
    expect(document.body.textContent).not.toContain(SECRET)
  })

  it.each([
    ["forbidden", /Only a developer can see key values/],
    ["unknown", /can't be shown here/],
    ["notSet", /isn't set on this server/],
    ["withheld", /never shown\. Make your own for local work/],
    ["something-new", /That didn't work\. Try again/],
  ])("%s", async (code, words) => {
    await unlockedThen(code)
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(words))
    expect(dialog()).toBeNull()
    expect(document.body.textContent).not.toContain(SECRET)
  })

  it("a thrown call reads as a failed one, not a crash", async () => {
    render(<KeysPanel keys={keysOf(BASIC)} />)
    asMock(revealKey).mockRejectedValue(new Error("offline"))
    fireEvent.click(screen.getByRole("button", { name: "Reveal OPENAI_API_KEY" }))
    unlockWith(PASSWORD)
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Couldn't reach the server/))
  })
})

describe("Keys tab: copy", () => {
  it("copies one key after the password, with a tick on the button", async () => {
    render(<KeysPanel keys={keysOf(BASIC)} />)
    fireEvent.click(screen.getByRole("button", { name: "Copy OPENAI_API_KEY" }))
    unlockWith(PASSWORD)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SECRET))
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy OPENAI_API_KEY" }).textContent).toBe("✓ Copied"))
    // Copying alone does not put the value on screen.
    expect(document.body.textContent).not.toContain(SECRET)
  })

  it("shows the value to select when the browser will not copy", async () => {
    writeText.mockRejectedValue(new Error("denied"))
    render(<KeysPanel keys={keysOf(BASIC)} />)
    fireEvent.click(screen.getByRole("button", { name: "Copy OPENAI_API_KEY" }))
    unlockWith(PASSWORD)
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Couldn't copy from here/))
    expect(rowOf("OPENAI_API_KEY").querySelector("[data-revealed]")?.textContent).toBe(SECRET)
  })

  it("copies the whole file, offers it as a download, and names what it could not write", async () => {
    asMock(exportEnvFile).mockResolvedValue({
      ok: true,
      filename: ".env.local",
      text: `OPENAI_API_KEY=${SECRET}\n`,
      count: 1,
      skipped: ["R2_PRIVATE_KEY", "ODD_ONE"],
    })
    const createObjectURL = vi.fn(() => "blob:made")
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})

    render(<KeysPanel keys={keysOf(BASIC)} />)
    fireEvent.click(screen.getByRole("button", { name: "Copy all as .env.local" }))
    expect(exportEnvFile).not.toHaveBeenCalled()
    unlockWith(PASSWORD)

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`OPENAI_API_KEY=${SECRET}\n`))
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Copied 1 key as \.env\.local/))
    const note = screen.getByText(/couldn't be written to the file/).closest("p")!
    expect(note.textContent).toContain("R2_PRIVATE_KEY, ODD_ONE")
    expect(document.body.textContent).not.toContain(SECRET)

    fireEvent.click(screen.getByRole("button", { name: "Download .env.local" }))
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(clicked).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:made"))
    // The made address is not left in the page.
    expect(document.querySelector('a[href^="blob:"]')).toBeNull()
  })

  it("a refused export says why", async () => {
    asMock(exportEnvFile).mockResolvedValue({ ok: false, code: "forbidden" })
    render(<KeysPanel keys={keysOf(BASIC)} />)
    fireEvent.click(screen.getByRole("button", { name: "Copy all as .env.local" }))
    unlockWith(PASSWORD)
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Only a developer/))
  })
})

describe("Keys tab: rows with no value say why", () => {
  it("words each state and offers no Reveal or Copy on it", () => {
    render(<KeysPanel keys={keysOf(BASIC)} />)
    const says = (name: string) => rowOf(name).textContent
    expect(says("SHOP_API_URL")).toContain("Not set on this server")
    expect(says("PREDICTHQ_API_TOKEN")).toContain("Kept in GitHub, which never shows a saved secret")
    expect(says("GROQ_API_KEY")).toContain("Vercel holds it, nothing in the code reads it")
    expect(says("OTTER_JWT")).toContain("Only for a one-off import.")
    for (const name of ["SHOP_API_URL", "PREDICTHQ_API_TOKEN", "GROQ_API_KEY", "OTTER_JWT"]) {
      expect(within(rowOf(name)).queryAllByRole("button")).toEqual([])
    }
    expect(within(rowOf("SHOP_API_URL")).getByText("Missing")).toBeTruthy()
    expect(within(rowOf("GROQ_API_KEY")).getByText("Used by nothing")).toBeTruthy()
  })

  it("a key that is never shown says so and has no buttons", () => {
    render(<KeysPanel keys={keysOf([row("NEXTAUTH_SECRET", { connectionName: "Sign-in", icon: "signin", canReveal: false, neverShown: true })])} />)
    expect(rowOf("NEXTAUTH_SECRET").textContent).toContain("Never shown. Make your own for local work.")
    expect(within(rowOf("NEXTAUTH_SECRET")).queryAllByRole("button")).toEqual([])
  })

  it("a setting that is not a secret is not masked, and still goes through the password", () => {
    render(<KeysPanel keys={keysOf([row("R2_BUCKET_NAME", { secret: false })])} />)
    expect(rowOf("R2_BUCKET_NAME").textContent).toContain("Not a secret")
    fireEvent.click(screen.getByRole("button", { name: "Copy R2_BUCKET_NAME" }))
    expect(dialog()?.open).toBe(true)
    expect(revealKey).not.toHaveBeenCalled()
  })
})

describe("Keys tab: when something is not available", () => {
  it("says Vercel could not be reached, in words, and drops the Unused filter", () => {
    render(
      <KeysPanel
        keys={keysOf(BASIC.map((r) => ({ ...r, vercel: null })), { vercelStatus: { ok: false, reason: "couldn't reach Vercel" } })}
      />,
    )
    expect(screen.getByText("Couldn't reach Vercel").closest("p")!.textContent).toContain("where each key lives is unknown")
    expect(screen.queryByRole("button", { name: /^Unused/ })).toBeNull()
    expect(screen.queryByText("Vercel")).toBeNull()
    expect(document.querySelector(".cu-answer")!.textContent).toBe("5 keys in all. 1 is missing on this server.")
  })

  it("says so when Vercel is not connected at all", () => {
    render(<KeysPanel keys={keysOf(BASIC, { vercelStatus: { ok: false, reason: "not set up" } })} />)
    expect(screen.getByText("Vercel isn't connected on this server")).toBeTruthy()
  })

  it("with values switched off: no Reveal, no Copy, no Copy all, no dialog, and it says why", () => {
    // The server sends every row as not revealable when values are off.
    const off = BASIC.map((r) => ({ ...r, canReveal: false }))
    render(<KeysPanel keys={keysOf(off, { valuesAvailable: false, valuesOffReason: "notSetUp" })} />)
    expect(screen.getByText("Showing values is switched off").closest("p")!.textContent).toContain(
      "until the DEVELOPER_PORTAL_ACCOUNT_ID setting is added on the server",
    )
    expect(screen.queryByRole("button", { name: /Reveal|Copy/ })).toBeNull()
    expect(dialog()).toBeNull()
    // Names, where they live and what is missing still show.
    expect(within(rowOf("OPENAI_API_KEY")).getByText("Vercel")).toBeTruthy()
    expect(within(rowOf("SHOP_API_URL")).getByText("Missing")).toBeTruthy()
  })
})

describe("Keys tab: another account", () => {
  it("says values can't be shown, without naming the setting", () => {
    const off = BASIC.map((r) => ({ ...r, canReveal: false }))
    render(<KeysPanel keys={keysOf(off, { valuesAvailable: false, valuesOffReason: "otherAccount" })} />)
    const note = screen.getByText("Values can't be shown on this account.").closest("p")!
    expect(note.textContent).not.toContain("DEVELOPER_PORTAL_ACCOUNT_ID")
    expect(screen.queryByRole("button", { name: /Reveal|Copy/ })).toBeNull()
  })
})

describe("Keys tab: the list stops", () => {
  const many = Array.from({ length: 12 }, (_, i) => row(`KEY_${i}`, i < 2 ? { state: "missing", canReveal: false, setHere: false } : {}))

  it("shows seven, then Show all N", () => {
    render(<KeysPanel keys={keysOf(many)} />)
    expect(document.querySelectorAll("[data-key-row]")).toHaveLength(7)
    fireEvent.click(screen.getByRole("button", { name: "Show all 12" }))
    expect(document.querySelectorAll("[data-key-row]")).toHaveLength(12)
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }))
    expect(document.querySelectorAll("[data-key-row]")).toHaveLength(7)
  })

  it("filters by state, with the count on each chip", () => {
    render(<KeysPanel keys={keysOf(many)} />)
    expect(screen.getByRole("button", { name: "All 12" }).getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: "Missing 2" }))
    expect([...document.querySelectorAll("[data-key-row]")].map((el) => el.getAttribute("data-key-row"))).toEqual(["KEY_0", "KEY_1"])
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "GitHub only 0" }))
    expect(screen.getByText("Nothing here.")).toBeTruthy()
  })
})
