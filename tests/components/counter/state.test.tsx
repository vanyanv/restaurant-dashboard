// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { Skeleton } from "@/components/counter/state/skeleton"
import { Failed } from "@/components/counter/state/failed"
import { Empty } from "@/components/counter/state/empty"
import { StaleBanner } from "@/components/counter/state/stale"
import { Owed } from "@/components/counter/state/owed"

describe("Skeleton", () => {
  it("renders the shape of what is coming, and says so to a screen reader", () => {
    const { container } = render(<Skeleton rows={3} />)
    expect(container.querySelectorAll("[data-skeleton-row]")).toHaveLength(3)
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
  })
})

describe("Failed", () => {
  it("names the failure rather than saying something went wrong", () => {
    render(<Failed error="Otter sync timed out" retryAction="retrySync" />)
    expect(screen.getByText(/Otter sync timed out/)).toBeTruthy()
  })

  it("offers a retry that calls back with the action name", () => {
    const onRetry = vi.fn()
    render(<Failed error="x" retryAction="retrySync" onRetry={onRetry} />)
    screen.getByRole("button", { name: /retry/i }).click()
    expect(onRetry).toHaveBeenCalledWith("retrySync")
  })

  it("renders no retry control when nothing can act on it", () => {
    render(<Failed error="x" retryAction="retrySync" />)
    expect(screen.queryByRole("button")).toBeNull()
  })
})

describe("Empty", () => {
  it("a pre-open store is explained, not apologised for", () => {
    render(<Empty reason="pre_open" />)
    expect(screen.getByText(/not trading yet/i)).toBeTruthy()
  })

  it("a filter that matched nothing offers a different next step", () => {
    render(<Empty reason="no_match" />)
    expect(screen.getByText(/nothing matched/i)).toBeTruthy()
  })
})

describe("StaleBanner", () => {
  it("says the figures are the last good run and when that was", () => {
    render(<StaleBanner lastGoodAt={new Date(2026, 7, 24, 9, 0)} />)
    expect(screen.getByRole("status").textContent).toMatch(/last good/i)
  })
})

describe("Owed", () => {
  it("names what is not computed yet instead of showing a zero", () => {
    render(<Owed owed="clock-in/out leak ledger" />)
    expect(screen.getByText(/clock-in\/out leak ledger/)).toBeTruthy()
    expect(screen.queryByText("0")).toBeNull()
  })
})
