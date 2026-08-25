// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { AskSurface } from "@/components/counter/ask/ask-surface"
import { NAV_GROUPS } from "@/lib/counter/nav"
import { PRESETS } from "@/lib/counter/date-range"
import type { SwitchableStore } from "@/components/counter/shell/store-switcher"

const props = {
  pathname: "/dashboard/pnl",
  params: new URLSearchParams("range=d7&store=hollywood"),
  storeName: "Hollywood",
  today: new Date(2026, 7, 24),
}

const STORES: SwitchableStore[] = [
  { id: "hollywood", name: "Hollywood", stage: "trading" },
  { id: "glendale", name: "Glendale", stage: "warming_up" },
  { id: "vannuys", name: "Van Nuys", stage: "pre_open" },
]

const openWith = (key: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(document, { key, ...init })

const wrap = () => document.querySelector<HTMLElement>("[data-cmdk]")!
const dialog = () => document.querySelector<HTMLElement>(".cmdk")!
const input = () => screen.getByRole("textbox", { name: /ask/i }) as HTMLInputElement
const rows = () => Array.from(wrap().querySelectorAll<HTMLElement>(".cmdk__row"))
const visibleRows = () => rows().filter((r) => !r.hidden)
const rowByLabel = (label: string) =>
  rows().find((r) => r.querySelector("span")?.textContent === label)!
const type = (value: string) => fireEvent.change(input(), { target: { value } })

describe("AskSurface", () => {
  /* ------------------------------------------------------------ the port */

  it("portals to document.body, so no containing block on the page can trap it", () => {
    // `.cmdkwrap` is position:absolute (counter-components.css:1231). `.appwrap`
    // is position:relative and `.ct-root` is a container-type element — either
    // would become its containing block and shrink the scrim off the rail and
    // the topbar. Measured in a real browser at 212/48.25; here we assert the
    // structural fact that prevents it.
    const { container } = render(<AskSurface {...props} />)
    expect(wrap().parentElement).toBe(document.body)
    expect(container.contains(wrap())).toBe(false)
  })

  it("carries the token alias layer with it, because the portal leaves .ct-root behind", () => {
    // Every `.cmdk*` rule reads --surface / --line / --mono, which are declared
    // on `.ct-root` (counter-components.css:21). Outside it they resolve to
    // nothing and the palette renders unstyled.
    render(<AskSurface {...props} />)
    expect(wrap().classList.contains("ct-root")).toBe(true)
    expect(wrap().classList.contains("cmdkwrap")).toBe(true)
  })

  it("emits the prototype's own class names, not utilities", () => {
    render(<AskSurface {...props} />)
    openWith("k", { metaKey: true })
    for (const cls of [
      ".cmdk",
      ".cmdk__in",
      ".cmdk__ctx",
      ".cmdk__mid",
      ".cmdk__list",
      ".cmdk__row",
      ".cmdk__k",
      ".cmdk__foot",
      ".cmdk__row .hint",
    ]) {
      expect(wrap().querySelector(cls), cls).not.toBeNull()
    }
  })

  it("stays mounted when closed and hides with the hidden ATTRIBUTE", () => {
    // `.cmdkwrap[hidden]{display:none}` is a rule in the ported sheet. Render
    // it conditionally and that rule — plus `.cmdk__row[hidden]` and
    // `.cmdk__k[hidden]`, which the filter depends on — is dead.
    render(<AskSurface {...props} />)
    expect(wrap()).not.toBeNull()
    expect(wrap().hidden).toBe(true)
    openWith("k", { metaKey: true })
    expect(wrap().hidden).toBe(false)
  })

  /* --------------------------------------------------------- opening it */

  it("is closed until asked for", () => {
    render(<AskSurface {...props} />)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("opens on Cmd+K", () => {
    render(<AskSurface {...props} />)
    openWith("k", { metaKey: true })
    expect(screen.getByRole("dialog", { name: /ask/i })).toBeTruthy()
  })

  it("opens on Ctrl+K too, because not every reader is on a Mac", () => {
    render(<AskSurface {...props} />)
    openWith("k", { ctrlKey: true })
    expect(screen.getByRole("dialog", { name: /ask/i })).toBeTruthy()
  })

  it("does NOT open on a bare k, which would fire while typing", () => {
    render(<AskSurface {...props} />)
    openWith("k")
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("toggles shut on a second Cmd+K, as cmdkOpen(w.hidden) does", () => {
    render(<AskSurface {...props} />)
    openWith("k", { metaKey: true })
    openWith("k", { metaKey: true })
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  /* ------------------------------------------------------- note 43's line */

  it("says what it is answering about before anything is typed", () => {
    render(<AskSurface {...props} />)
    openWith("k", { metaKey: true })
    const ctx = wrap().querySelector(".cmdk__ctx")!
    expect(ctx.textContent).toContain("Asking about")
    expect(ctx.querySelector("b")!.textContent).toBe("P&L")
    expect(ctx.textContent).toContain("Hollywood")
    expect(ctx.textContent).toContain("Last 7 days")
  })

  it("names the store in the placeholder and the range in the footer", () => {
    render(<AskSurface {...props} />)
    openWith("k", { metaKey: true })
    expect(input().placeholder).toBe("Ask about Hollywood, or jump to anything…")
    expect(wrap().querySelector(".cmdk__foot")!.textContent).toContain("Reading Last 7 days")
  })

  it("prints the shortcut only where it works", () => {
    // Note 46: two surfaces printed ⌘K and nothing opened.
    render(<AskSurface {...props} />)
    openWith("k", { metaKey: true })
    expect(screen.getByText(/esc to close/i)).toBeTruthy()
  })

  /* ------------------------------------------------------------ the rows */

  it("offers every destination the rail offers, and no other", () => {
    render(<AskSurface {...props} />)
    openWith("k", { metaKey: true })
    const items = NAV_GROUPS.flatMap((g) => g.items)
    const hrefs = rows()
      .filter((r) => r.tagName === "A")
      .map((r) => r.getAttribute("href"))
    expect(hrefs).toEqual(items.map((i) => i.href))
  })

  it("draws Switch store from the same list the rail's switcher gets", () => {
    render(<AskSurface {...props} stores={STORES} onSelectStore={vi.fn()} />)
    openWith("k", { metaKey: true })
    expect(rowByLabel("All stores")).toBeTruthy()
    expect(rowByLabel("Glendale").querySelector(".hint")!.textContent).toBe("Warming up")
    expect(rowByLabel("Van Nuys").querySelector(".hint")!.textContent).toBe("Pre-open")
  })

  it("draws Change the range from PRESETS, marking the current one", () => {
    render(<AskSurface {...props} presetId="d7" onSelectPreset={vi.fn()} />)
    openWith("k", { metaKey: true })
    expect(rowByLabel("Last 7 days").querySelector(".hint")!.textContent).toBe("Current")
    expect(rowByLabel("Yesterday").querySelector(".hint")!.textContent).toBe("Range")
    for (const p of PRESETS) expect(rowByLabel(p.name), p.name).toBeTruthy()
  })

  it("draws no group for a thing it cannot change", () => {
    // A palette row that changes nothing is note 46's defect in miniature.
    render(<AskSurface {...props} />)
    openWith("k", { metaKey: true })
    const captions = Array.from(wrap().querySelectorAll(".cmdk__k")).map((k) => k.textContent)
    expect(captions).toEqual(["Go to"])
  })

  /* ------------------------------------------------------------ filtering */

  it("filters against data-t, not the rendered text", () => {
    render(<AskSurface {...props} />)
    openWith("k", { metaKey: true })
    // Upper case in, lower case key: this only matches if the comparison is
    // against `data-t` (which is lowercased) rather than the label.
    type("INVOICES")
    const shown = visibleRows().filter((r) => r.hasAttribute("data-askfree") === false)
    expect(shown.map((r) => r.getAttribute("data-t"))).toEqual(["invoices"])
  })

  it("hides filtered rows with the hidden attribute rather than unmounting them", () => {
    render(<AskSurface {...props} />)
    openWith("k", { metaKey: true })
    const before = rows().length
    type("invoices")
    expect(rows().length).toBe(before)
    expect(rowByLabel("Vendors").hidden).toBe(true)
  })

  it("hides a group heading once nothing is left under it", () => {
    // "A group heading with nothing under it is a heading for nothing."
    render(<AskSurface {...props} stores={STORES} onSelectStore={vi.fn()} />)
    openWith("k", { metaKey: true })
    const heading = (text: string) =>
      Array.from(wrap().querySelectorAll<HTMLElement>(".cmdk__k")).find(
        (k) => k.textContent === text,
      )!
    expect(heading("Switch store").hidden).toBe(false)
    type("invoices")
    expect(heading("Switch store").hidden).toBe(true)
    expect(heading("Go to").hidden).toBe(false)
  })

  it("offers the typed question itself once there is something to ask", () => {
    render(<AskSurface {...props} />)
    openWith("k", { metaKey: true })
    const free = () => wrap().querySelector<HTMLElement>("[data-askfree]")!
    expect(free().hidden).toBe(true)
    type("wh")
    expect(free().hidden).toBe(true)
    type("why")
    expect(free().hidden).toBe(false)
    type("why is prime cost up")
    expect(free().querySelector("span")!.textContent).toBe("why is prime cost up")
    expect(free().getAttribute("data-t")).toBe("why is prime cost up")
  })

  /* ------------------------------------------------------------ keyboard */

  it("marks the first row, and the arrows move the mark", () => {
    render(<AskSurface {...props} />)
    openWith("k", { metaKey: true })
    const marked = () => wrap().querySelector<HTMLElement>(".cmdk__row.on")!
    expect(marked()).toBe(visibleRows()[0])
    fireEvent.keyDown(document, { key: "ArrowDown" })
    expect(marked()).toBe(visibleRows()[1])
    fireEvent.keyDown(document, { key: "ArrowUp" })
    expect(marked()).toBe(visibleRows()[0])
    // Wraps, as `((i % n) + n) % n` does.
    fireEvent.keyDown(document, { key: "ArrowUp" })
    expect(marked()).toBe(visibleRows()[visibleRows().length - 1])
  })

  it("puts the mark back on the top row after every filter", () => {
    // `cmdkMark(0)` at the end of `cmdkFilter`, and the prototype's own bug
    // note for why: "a row that the filter hid kept its mark and Enter opened
    // something nobody could see."
    render(<AskSurface {...props} />)
    openWith("k", { metaKey: true })
    fireEvent.keyDown(document, { key: "ArrowDown" })
    fireEvent.keyDown(document, { key: "ArrowDown" })
    expect(wrap().querySelector(".cmdk__row.on")).toBe(visibleRows()[2])
    // One character, so the free row stays hidden and ten destinations match —
    // enough rows left that a stale index would still land on a real one.
    type("s")
    const marked = wrap().querySelector<HTMLElement>(".cmdk__row.on")!
    expect(marked.hidden).toBe(false)
    expect(marked).toBe(visibleRows()[0])
  })

  it("Enter activates the marked row", () => {
    const onSelectPreset = vi.fn()
    render(<AskSurface {...props} presetId="d7" onSelectPreset={onSelectPreset} />)
    openWith("k", { metaKey: true })
    type("month-to-date")
    // Row 0 is the free row — "the first row is always the question you
    // actually typed" — so the preset is one down from it.
    fireEvent.keyDown(document, { key: "ArrowDown" })
    fireEvent.keyDown(document, { key: "Enter" })
    expect(onSelectPreset).toHaveBeenCalledWith("mtd")
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("Enter on the free row reports the question and the context it was asked in", () => {
    const onSubmit = vi.fn()
    render(<AskSurface {...props} onSubmit={onSubmit} />)
    openWith("k", { metaKey: true })
    type("why is prime cost up")
    fireEvent.keyDown(document, { key: "Enter" })
    expect(onSubmit).toHaveBeenCalledWith(
      "why is prime cost up",
      expect.objectContaining({ page: "P&L", store: "Hollywood", range: "Last 7 days" }),
    )
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("switches store from the palette", () => {
    const onSelectStore = vi.fn()
    render(<AskSurface {...props} stores={STORES} onSelectStore={onSelectStore} />)
    openWith("k", { metaKey: true })
    fireEvent.click(rowByLabel("Glendale"))
    expect(onSelectStore).toHaveBeenCalledWith("glendale")
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("closes on Escape", () => {
    render(<AskSurface {...props} />)
    openWith("k", { metaKey: true })
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  /* --------------------------------------------------------------- focus */

  it("focuses the input on open, so the reader can just type", () => {
    render(<AskSurface {...props} />)
    openWith("k", { metaKey: true })
    expect(document.activeElement).toBe(input())
  })

  it("gives focus back to whatever opened it", () => {
    render(
      <>
        <button data-askabout="Prime cost">Ask about this</button>
        <AskSurface {...props} />
      </>,
    )
    const trigger = screen.getByText("Ask about this")
    trigger.focus()
    fireEvent.click(trigger)
    expect(document.activeElement).toBe(input())
    fireEvent.keyDown(document, { key: "Escape" })
    expect(document.activeElement).toBe(trigger)
  })

  it("traps Tab inside the dialog while it is open", () => {
    render(
      <>
        <button>outside</button>
        <AskSurface {...props} />
      </>,
    )
    openWith("k", { metaKey: true })
    const focusable = Array.from(
      dialog().querySelectorAll<HTMLElement>("input, button, a[href]"),
    ).filter((el) => !el.hidden && el.closest("[hidden]") === null)
    const last = focusable[focusable.length - 1]

    last.focus()
    fireEvent.keyDown(document, { key: "Tab" })
    expect(document.activeElement).toBe(focusable[0])

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  /* ------------------------------------------------------- the delegation */

  it("opens pre-filled when a section asks about itself", () => {
    // Note 55: the Ask about this button carries its own question, so the
    // surface does not have to guess what the reader meant.
    render(
      <>
        <button data-askabout="Prime cost">Ask about this</button>
        <AskSurface {...props} />
      </>,
    )
    fireEvent.click(screen.getByText("Ask about this"))
    expect(screen.getByRole("dialog", { name: /ask/i })).toBeTruthy()
    expect(input().value).toContain("Prime cost")
  })

  it("PRE-FILLS from a suggestion row instead of discarding the question (F-R10)", () => {
    const onSubmit = vi.fn()
    render(
      <>
        <button data-askabout="">Ask the numbers</button>
        <AskSurface
          {...props}
          suggestions={["Why is food cost over plan?"]}
          onSubmit={onSubmit}
        />
      </>,
    )
    // Opened from a real trigger, so "focus went back to the opener" is
    // observable if the row closes the palette on its way past.
    const trigger = screen.getByText("Ask the numbers")
    trigger.focus()
    fireEvent.click(trigger)
    const suggestion = rowByLabel("Why is food cost over plan?")
    expect(suggestion.getAttribute("data-askabout")).toBe("Why is food cost over plan?")
    fireEvent.click(suggestion)
    // Still open, question in the input — not navigated away, not submitted.
    expect(screen.getByRole("dialog", { name: /ask/i })).toBeTruthy()
    expect(input().value).toBe("Why is food cost over plan?")
    expect(onSubmit).not.toHaveBeenCalled()
    // And the palette never CLOSED on the way past. A row that acts and then
    // closes, only for the delegation to reopen it, throws focus back to
    // whatever opened the palette — leaving the reader looking at a question
    // they now have to click into before they can edit it.
    expect(document.activeElement).toBe(input())
  })

  it("does not re-aim the focus restore when a row inside it is clicked", () => {
    render(
      <>
        <button data-askabout="">Ask the numbers</button>
        <AskSurface {...props} suggestions={["Why is food cost over plan?"]} />
      </>,
    )
    const trigger = screen.getByText("Ask the numbers")
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.click(rowByLabel("Why is food cost over plan?"))
    fireEvent.keyDown(document, { key: "Escape" })
    expect(document.activeElement).toBe(trigger)
  })
})
