// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Dispatch } from "@/components/counter/surface/dispatch"

describe("Dispatch", () => {
  it("is the prototype's .dispatch: toned spans, a spacer, and an optional way in", () => {
    const { container } = render(
      <Dispatch
        items={[
          { tone: "hot", text: "3 need you" },
          { tone: "quiet", text: "1,284 orders trading" },
        ]}
        action={{ label: "Open the queue", href: "/dashboard/alerts" }}
      />,
    )
    const line = container.querySelector(".dispatch") as HTMLElement
    expect([...line.children].map((c) => c.className)).toEqual([
      "hot", "sep", "quiet", "spacer", "go",
    ])
    expect(screen.getByRole("link", { name: "Open the queue" }).getAttribute("href")).toBe(
      "/dashboard/alerts",
    )
  })

  it("puts a separator BETWEEN items and never before the first or after the last", () => {
    const { container } = render(
      <Dispatch
        items={[
          { tone: "quiet", text: "one" },
          { tone: "quiet", text: "two" },
          { tone: "quiet", text: "three" },
        ]}
      />,
    )
    const line = container.querySelector(".dispatch") as HTMLElement
    expect([...line.children].map((c) => c.className)).toEqual([
      "quiet", "sep", "quiet", "sep", "quiet", "spacer",
    ])
  })

  it("renders a single item with no separator at all", () => {
    const { container } = render(<Dispatch items={[{ tone: "quiet", text: "only" }]} />)
    expect(container.querySelectorAll(".dispatch .sep")).toHaveLength(0)
  })

  it("offers no .go when there is nowhere to go — a link that goes nowhere is worse than none", () => {
    const { container } = render(<Dispatch items={[{ tone: "quiet", text: "only" }]} />)
    expect(container.querySelector(".go")).toBeNull()
  })

  it("hides the separators from a screen reader — they are punctuation, not content", () => {
    const { container } = render(
      <Dispatch items={[{ tone: "hot", text: "one" }, { tone: "quiet", text: "two" }]} />,
    )
    expect(container.querySelector(".sep")?.getAttribute("aria-hidden")).toBe("true")
  })
})
