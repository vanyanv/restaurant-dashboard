// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
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

  it("is the prototype's skRow(): .skb-row holding four .skb.skb-line spans", () => {
    const { container } = render(<Skeleton rows={2} />)
    const rows = container.querySelectorAll(".skb-row")
    expect(rows).toHaveLength(2)
    for (const r of Array.from(rows)) {
      expect(r.children).toHaveLength(4)
      for (const c of Array.from(r.children)) expect(c.className).toBe("skb skb-line")
    }
  })
})

describe("Failed", () => {
  it("names the failure rather than saying something went wrong", () => {
    render(<Failed title="Net sales" error="Otter sync timed out" retryAction="retrySync" />)
    expect(screen.getByText(/Otter sync timed out/)).toBeTruthy()
  })

  it("emits the prototype's bodyError(): .failed > .fi + div > b + p + .acts", () => {
    const { container } = render(
      <Failed title="Net sales" error="timed out after 8s" retryAction="retrySync" />,
    )
    const failed = container.querySelector(".failed")!
    expect(failed.children[0].className).toBe("fi")
    expect(failed.children[0].textContent).toBe("!")
    const rest = failed.children[1]
    expect(rest.querySelector("b")!.textContent).toBe("Net sales unavailable")
    expect(rest.querySelector("p")).toBeTruthy()
    expect(rest.querySelector(".acts .mono")!.textContent).toBe("timed out after 8s")
  })

  it("names the section that failed, because a reader is looking at six of them", () => {
    render(<Failed title="Invoices" error="x" retryAction="y" />)
    expect(screen.getByText("Invoices unavailable")).toBeTruthy()
  })

  it("offers a retry that calls back with the action name", () => {
    const onRetry = vi.fn()
    render(<Failed title="Net sales" error="x" retryAction="retrySync" onRetry={onRetry} />)
    fireEvent.click(screen.getByRole("button", { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledWith("retrySync")
  })

  it("renders no retry control when nothing can act on it", () => {
    render(<Failed title="Net sales" error="x" retryAction="retrySync" />)
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

  it("emits the prototype's bodyEmpty(): .empty > .t + .s", () => {
    const { container } = render(<Empty reason="no_match" />)
    const empty = container.querySelector(".empty")!
    expect(empty.children).toHaveLength(2)
    expect(empty.children[0].className).toBe("t")
    expect(empty.children[1].className).toBe("s")
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
