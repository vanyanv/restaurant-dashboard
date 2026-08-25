// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { SyncChip } from "@/components/counter/shell/sync-chip"

const now = new Date(2026, 7, 24, 12, 0)

describe("SyncChip", () => {
  it("is the prototype's .sync: a dot, then the words", () => {
    // `.sync i` is the 6px circle and it is the only colour in the topbar,
    // which is why the state is in the words as well.
    const { container } = render(<SyncChip state="synced" at={new Date(2026, 7, 24, 11, 48)} now={now} />)
    const chip = container.querySelector(".sync") as HTMLElement
    expect(chip.querySelector("i")?.getAttribute("aria-hidden")).toBe("true")
    expect(chip.textContent).toContain("Synced 12 min ago")
  })

  it("paints a failure with .is-bad, not with different words alone", () => {
    const { container } = render(<SyncChip state="failed" at={new Date(2026, 7, 24, 8, 0)} now={now} />)
    const chip = container.querySelector(".sync") as HTMLElement
    expect(chip.className).toBe("sync is-bad")
    expect(chip.textContent).toContain("Last sync failed 4h ago")
  })

  it("says it is syncing without claiming a time it does not have", () => {
    const { container } = render(<SyncChip state="syncing" now={now} />)
    expect((container.querySelector(".sync") as HTMLElement).textContent?.trim()).toBe("Syncing…")
  })

  it("prints no duration when it was not given one", () => {
    const { container } = render(<SyncChip state="synced" now={now} />)
    expect((container.querySelector(".sync") as HTMLElement).textContent?.trim()).toBe("Synced")
  })

  it("counts in the largest honest unit", () => {
    const cases: Array<[Date, string]> = [
      [new Date(2026, 7, 24, 11, 59, 45), "just now"],
      [new Date(2026, 7, 24, 11, 1), "59 min ago"],
      [new Date(2026, 7, 24, 5, 0), "7h ago"],
      [new Date(2026, 7, 21, 12, 0), "3d ago"],
    ]
    for (const [at, expected] of cases) {
      const { container, unmount } = render(<SyncChip state="synced" at={at} now={now} />)
      expect((container.querySelector(".sync") as HTMLElement).textContent).toContain(expected)
      unmount()
    }
  })
})
