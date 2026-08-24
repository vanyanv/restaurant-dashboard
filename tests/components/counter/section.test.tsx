// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { Section } from "@/components/counter/surface/section"
import { ready, stale, loading, failed, empty, notComputed } from "@/lib/counter/section-data"

const body = (d: { n: number }) => <p>value {d.n}</p>

describe("Section", () => {
  it("renders its children only when data is present", () => {
    render(<Section title="Net sales" data={ready({ n: 7 })}>{body}</Section>)
    expect(screen.getByText("value 7")).toBeTruthy()
  })

  it("renders the skeleton while loading, and never calls children", () => {
    const spy = vi.fn(body)
    render(<Section title="Net sales" data={loading()}>{spy}</Section>)
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
    expect(spy).not.toHaveBeenCalled()
  })

  it("renders the failure without touching the rest of the page", () => {
    render(<Section title="Net sales" data={failed("sync timed out", "retrySync")}>{body}</Section>)
    expect(screen.getByRole("alert")).toBeTruthy()
    expect(screen.queryByText(/value/)).toBeNull()
  })

  it("renders the empty reason it was given", () => {
    render(<Section title="Net sales" data={empty("pre_open")}>{body}</Section>)
    expect(screen.getByText(/not trading yet/i)).toBeTruthy()
  })

  it("renders owed work by name", () => {
    render(<Section title="Leak ledger" data={notComputed("clock-in/out leak ledger")}>{body}</Section>)
    expect(screen.getByText(/clock-in\/out leak ledger/)).toBeTruthy()
  })

  it("stale renders the banner AND the data — the figures are still real", () => {
    render(
      <Section title="Net sales" data={stale({ n: 7 }, new Date(2026, 7, 24, 9, 0))}>{body}</Section>,
    )
    expect(screen.getByRole("status").textContent).toMatch(/last good/i)
    expect(screen.getByText("value 7")).toBeTruthy()
  })

  it("shows the title in every state, so a reader knows what failed", () => {
    for (const d of [ready({ n: 1 }), loading(), failed("x", "y"), empty("no_match"), notComputed("z")]) {
      const { unmount } = render(<Section title="Net sales" data={d}>{body}</Section>)
      expect(screen.getByRole("heading", { name: "Net sales" })).toBeTruthy()
      unmount()
    }
  })

  it("shows meta only when there is data to describe", () => {
    const { unmount } = render(
      <Section title="Net sales" meta="last 30 days" data={ready({ n: 1 })}>{body}</Section>,
    )
    expect(screen.getByText("last 30 days")).toBeTruthy()
    unmount()
    render(<Section title="Net sales" meta="last 30 days" data={loading()}>{body}</Section>)
    expect(screen.queryByText("last 30 days")).toBeNull()
  })

  it("offers Ask about this only when there is an answer to ask about", () => {
    const { unmount } = render(
      <Section title="Net sales" askAbout data={ready({ n: 1 })}>{body}</Section>,
    )
    expect(screen.getByRole("button", { name: /ask about this/i })).toBeTruthy()
    unmount()
    render(<Section title="Net sales" askAbout data={loading()}>{body}</Section>)
    expect(screen.queryByRole("button", { name: /ask about this/i })).toBeNull()
  })

  it("asks about the section by its own title unless told otherwise", () => {
    render(<Section title="Net sales" askAbout data={ready({ n: 1 })}>{body}</Section>)
    expect(screen.getByRole("button", { name: /ask about this/i }))
      .toHaveAttribute("data-ask-about", "Net sales")
  })
})
