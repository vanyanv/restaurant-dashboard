// @vitest-environment jsdom
/**
 * `.say` — the verdict, prototype line 4245.
 */
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Say } from "@/components/counter/surface/say"

describe("Say", () => {
  it("is the prototype's .say: a state chip, the sentence, and the way to the thing that is wrong", () => {
    const { container } = render(
      <Say
        tone="warn"
        headline="Ahead, with one problem"
        action={{ label: "Show me which items", href: "/dashboard/cogs" }}
      >
        Volume is fine. <b>Food cost is 31.4% against a 30.0% plan</b>.
      </Say>,
    )
    const say = container.querySelector(".say") as HTMLElement
    expect([...say.children].map((c) => c.tagName)).toEqual(["SPAN", "P", "A"])
    expect(say.querySelector(".state")?.textContent).toBe("Ahead, with one problem")
    expect(say.querySelector("p b")?.textContent).toBe(
      "Food cost is 31.4% against a 30.0% plan",
    )
    expect(screen.getByRole("link", { name: "Show me which items" }).getAttribute("href")).toBe(
      "/dashboard/cogs",
    )
  })

  it("a good verdict carries NO modifier — .state's own rule is already the good wash", () => {
    // `is-good` matches no rule in counter-components.css; emitting it would
    // paint nothing and look like a warn chip that failed to warn.
    const { container } = render(<Say headline="On plan">Nothing to do.</Say>)
    expect(container.querySelector(".state")?.className).toBe("state")
  })

  it("warn and bad get theirs", () => {
    expect(
      render(<Say tone="warn" headline="x">y</Say>).container.querySelector(".state")?.className,
    ).toBe("state is-warn")
    expect(
      render(<Say tone="bad" headline="x">y</Say>).container.querySelector(".state")?.className,
    ).toBe("state is-bad")
  })

  it("does not compose the sentence — the caller decides which figure carries it", () => {
    // The prose is the one place on a Counter page where a sentence carries a
    // number. Which number that is, is a judgement about the day.
    const { container } = render(
      <Say headline="On plan">
        Ground beef is <b>18% up in three weeks</b>.
      </Say>,
    )
    expect(container.querySelector("p")?.textContent).toBe(
      "Ground beef is 18% up in three weeks.",
    )
  })

  it("offers no .linkact when there is nowhere to go", () => {
    const { container } = render(<Say headline="On plan">Nothing to do.</Say>)
    expect(container.querySelector(".linkact")).toBeNull()
    expect([...(container.querySelector(".say") as HTMLElement).children].map((c) => c.tagName)).toEqual([
      "SPAN",
      "P",
    ])
  })
})
