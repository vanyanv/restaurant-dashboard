// @vitest-environment jsdom
/**
 * `.askbar` — prototype line 4302.
 *
 * The point of this file is the last block: the bar is NOT a second Ask
 * surface. Every click it takes is handled by the one `AskSurface` already
 * mounted in `AppShell`.
 */
import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { AskBar } from "@/components/counter/ask/ask-bar"
import { AskSurface } from "@/components/counter/ask/ask-surface"

const SUGS = [
  "Why is food cost 2.4 points over plan?",
  "What should I prep for Saturday?",
  "Did the ground beef price stick?",
]

describe("AskBar", () => {
  it("is the prototype's .askbar: the input row, then the suggestion chips", () => {
    const { container } = render(
      <AskBar placeholder="Ask anything about Hollywood, today or any range…" suggestions={SUGS} />,
    )
    const bar = container.querySelector(".askbar") as HTMLElement
    expect([...bar.children].map((c) => c.className)).toEqual(["askbar__in", "sugs"])
  })

  it("the input row is glyph, placeholder, shortcut", () => {
    const { container } = render(<AskBar placeholder="Ask anything about Hollywood…" />)
    const input = container.querySelector(".askbar__in") as HTMLElement
    expect(input.tagName).toBe("BUTTON")
    expect(input.getAttribute("type")).toBe("button")
    expect([...input.children].map((c) => c.tagName)).toEqual(["svg", "SPAN", "KBD"])
    expect(input.querySelector(".ph")?.textContent).toBe("Ask anything about Hollywood…")
    expect(input.querySelector("kbd")?.textContent).toBe("⌘K")
  })

  it("labels the ROW, not every chip — only the first suggestion carries .sk", () => {
    const { container } = render(<AskBar placeholder="…" suggestions={SUGS} />)
    const chips = [...container.querySelectorAll(".sug")]
    expect(chips).toHaveLength(3)
    expect(chips.map((c) => c.querySelector(".sk")?.textContent ?? null)).toEqual([
      "Suggested",
      null,
      null,
    ])
    expect(chips[0].textContent).toBe("SuggestedWhy is food cost 2.4 points over plan?")
    expect(chips[1].textContent).toBe("What should I prep for Saturday?")
  })

  it("draws no .sugs at all when there is nothing to suggest", () => {
    const { container } = render(<AskBar placeholder="…" />)
    expect(container.querySelector(".sugs")).toBeNull()
    expect(container.querySelector(".askbar")?.children).toHaveLength(1)
  })

  it("carries no dead hooks: the prototype's data-cmdopen and data-goto are replaced, not copied", () => {
    const { container } = render(<AskBar placeholder="…" suggestions={SUGS} />)
    expect(container.querySelector("[data-cmdopen]")).toBeNull()
    expect(container.querySelector("[data-goto]")).toBeNull()
  })
})

describe("AskBar + AskSurface — one surface, not two", () => {
  function mount() {
    return render(
      <>
        <AskSurface
          pathname="/dashboard"
          params={new URLSearchParams()}
          storeName="Hollywood"
          today={new Date(2026, 7, 25)}
        />
        <AskBar placeholder="Ask anything about Hollywood…" suggestions={SUGS} />
      </>,
    )
  }

  it("the bar opens the EXISTING ⌘K surface, with an empty question", () => {
    const { container } = mount()
    expect(screen.queryByRole("dialog")).toBeNull()
    fireEvent.click(container.querySelector(".askbar__in") as HTMLElement)
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("")
  })

  it("a suggestion pre-fills the same surface with that question", () => {
    const { container } = mount()
    fireEvent.click(container.querySelectorAll(".sug")[2] as HTMLElement)
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
      "Did the ground beef price stick?",
    )
    // One dialog, not two: the bar renders no surface of its own.
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
  })

  it("a suggestion is delegated, so the bar needs no handler and stays a server component", () => {
    const { container } = render(<AskBar placeholder="…" suggestions={SUGS} />)
    expect([...container.querySelectorAll(".sug")].map((c) => c.getAttribute("data-askabout"))).toEqual(
      SUGS,
    )
    expect(container.querySelector(".askbar__in")?.getAttribute("data-askabout")).toBe("")
  })
})
