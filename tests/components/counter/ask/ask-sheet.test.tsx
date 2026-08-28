// @vitest-environment jsdom
/**
 * `AskSheet` against the prototype's own `.masksheet`, emitted inline inside
 * `P.overview.phone()` (`docs/counter/counter-prototype.html` line 4375).
 *
 * The differences from `AskBar` are the reason this is a second component and
 * not a variant prop, so each one is asserted here rather than described.
 */
import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { AskSheet } from "@/components/counter/ask/ask-sheet"

/** Two chips as the phone builds them: a question, and the address that answers it. */
const CHIPS = [
  { question: "Why is food cost over?", href: "/m/ask?q=Why+is+food+cost+over%3F" },
  { question: "Prep for Saturday?", href: "/m/ask?q=Prep+for+Saturday%3F" },
]

describe("AskSheet — the phone's way into Ask", () => {
  it("emits .masksheet with the row first and the chips after", () => {
    const { container } = render(
      <AskSheet prompt="Ask about today" href="/m/ask" suggestions={CHIPS} />,
    )
    const sheet = container.firstElementChild!
    expect(sheet.className).toBe("masksheet")
    expect([...sheet.children].map((c) => c.getAttribute("class"))).toEqual(["row", "sugs"])
  })

  it("puts the glyph before the prompt, as .masksheet .row svg is written for", () => {
    const { container } = render(<AskSheet prompt="Ask about this range" href="/m/ask" />)
    const row = container.querySelector(".row")!
    expect([...row.children].map((c) => c.tagName.toLowerCase())).toEqual(["svg", "span"])
    expect(row.querySelector(".ph")!.textContent).toBe("Ask about this range")
  })

  it("carries NO ⌘K hint — a phone has no command key and the sheet has no kbd rule", () => {
    const { container } = render(<AskSheet prompt="Ask about today" href="/m/ask" />)
    expect(container.querySelector("kbd")).toBeNull()
  })

  it("labels no chip SUGGESTED — the desk's .sk is not on this surface", () => {
    const { container } = render(
      <AskSheet prompt="Ask" href="/m/ask" suggestions={CHIPS} />,
    )
    expect(container.querySelector(".sk")).toBeNull()
  })

  it("navigates, and every chip carries its OWN question to Ask", () => {
    // `PhoneShell` does listen for `data-askabout` now — it pushes `/m/ask`.
    // These are links outright rather than attributes, so each chip's
    // destination is in the address bar and in anything the reader shares,
    // and the chip that asks about food cost lands on food cost rather than
    // on an empty box.
    const { container } = render(
      <AskSheet prompt="Ask about today" href="/m/ask" suggestions={[CHIPS[0]]} />,
    )
    expect(container.querySelector("[data-askabout]")).toBeNull()
    expect([...container.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
      "/m/ask",
      "/m/ask?q=Why+is+food+cost+over%3F",
    ])
  })

  it("draws no .sugs at all when there are no suggestions", () => {
    const { container } = render(<AskSheet prompt="Ask about today" href="/m/ask" />)
    expect(container.querySelector(".sugs")).toBeNull()
  })

  it("gives every chip the class the sheet styles", () => {
    const { container } = render(
      <AskSheet prompt="Ask" href="/m/ask" suggestions={CHIPS} />,
    )
    expect([...container.querySelectorAll(".sugs > *")].map((c) => c.getAttribute("class"))).toEqual([
      "sug",
      "sug",
    ])
  })
})
