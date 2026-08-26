// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { Tag, StatusPill } from "@/components/counter"

describe("Tag", () => {
  it.each([
    ["good", "mtag good"],
    ["bad", "mtag bad"],
    ["warn", "mtag warn"],
  ])("renders tone %s as %s", (tone, expected) => {
    const { container } = render(<Tag tone={tone as "good" | "bad" | "warn"}>Holding</Tag>)
    expect(container.firstElementChild?.className).toBe(expected)
  })

  it("renders a toneless tag as a bare .mtag", () => {
    const { container } = render(<Tag>Acknowledged</Tag>)
    expect(container.firstElementChild?.className).toBe("mtag")
  })
})

describe("StatusPill", () => {
  // The prototype reuses the invoice pill classes for alert severity. The map
  // is CRITICAL->REJECTED, WATCH->REVIEW, INFO->APPROVED, and it is not
  // guessable from the names — assert it.
  it.each([
    ["CRITICAL", "Critical", "statuspill REJECTED"],
    ["WATCH", "Warning", "statuspill REVIEW"],
    ["INFO", "Info", "statuspill APPROVED"],
  ])("renders %s as %s", (severity, label, expected) => {
    const { container } = render(<StatusPill severity={severity as "CRITICAL" | "WATCH" | "INFO"} />)
    expect(container.firstElementChild?.className).toBe(expected)
    expect(container.firstElementChild?.textContent).toBe(label)
  })
})
