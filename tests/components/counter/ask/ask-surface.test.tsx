// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { AskSurface } from "@/components/counter/ask/ask-surface"

const props = {
  pathname: "/dashboard/pnl",
  params: new URLSearchParams("range=d7&store=hollywood"),
  storeName: "Hollywood",
  today: new Date(2026, 7, 24),
}

const openWith = (key: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(document, { key, ...init })

describe("AskSurface", () => {
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

  it("says what it is answering about before anything is typed", () => {
    render(<AskSurface {...props} />)
    openWith("k", { metaKey: true })
    expect(screen.getByText("Answering about P&L · Hollywood · Last 7 days")).toBeTruthy()
  })

  it("focuses the input on open, so the reader can just type", () => {
    render(<AskSurface {...props} />)
    openWith("k", { metaKey: true })
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: /ask/i }))
  })

  it("closes on Escape", () => {
    render(<AskSurface {...props} />)
    openWith("k", { metaKey: true })
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("opens pre-filled when a section asks about itself", () => {
    // Note 55: the Ask about this button carries its own question, so the
    // surface does not have to guess what the reader meant.
    render(
      <>
        <button data-ask-about="Prime cost">Ask about this</button>
        <AskSurface {...props} />
      </>,
    )
    fireEvent.click(screen.getByText("Ask about this"))
    expect(screen.getByRole("dialog", { name: /ask/i })).toBeTruthy()
    expect((screen.getByRole("textbox", { name: /ask/i }) as HTMLInputElement).value)
      .toContain("Prime cost")
  })

  it("reports the question and the context it was asked in", () => {
    const onSubmit = vi.fn()
    render(<AskSurface {...props} onSubmit={onSubmit} />)
    openWith("k", { metaKey: true })
    const input = screen.getByRole("textbox", { name: /ask/i })
    fireEvent.change(input, { target: { value: "why is prime cost up" } })
    fireEvent.submit(input.closest("form")!)
    expect(onSubmit).toHaveBeenCalledWith(
      "why is prime cost up",
      expect.objectContaining({ page: "P&L", store: "Hollywood", range: "Last 7 days" }),
    )
  })

  it("prints the shortcut only where it works", () => {
    // Note 46: two surfaces printed ⌘K and nothing opened. Fourteen rules of
    // dead CSS behind an advertised shortcut is worse than never mentioning it.
    render(<AskSurface {...props} />)
    openWith("k", { metaKey: true })
    expect(screen.getByText(/esc/i)).toBeTruthy()
  })
})
