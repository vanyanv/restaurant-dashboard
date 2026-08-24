// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { Toast } from "@/components/counter/surface/toast"

describe("Toast", () => {
  it("announces itself to a screen reader without stealing focus", () => {
    render(<Toast message="Saved" />)
    const el = screen.getByRole("status")
    expect(el.textContent).toContain("Saved")
    expect(el).toHaveAttribute("aria-live", "polite")
  })

  it("uses assertive announcement only for a failure", () => {
    render(<Toast message="Could not post to COGS" tone="bad" />)
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive")
  })

  it("offers dismissal when a handler is given, and none otherwise", () => {
    const onDismiss = vi.fn()
    const { unmount } = render(<Toast message="Saved" onDismiss={onDismiss} />)
    screen.getByRole("button", { name: /dismiss/i }).click()
    expect(onDismiss).toHaveBeenCalled()
    unmount()
    render(<Toast message="Saved" />)
    expect(screen.queryByRole("button")).toBeNull()
  })
})
