// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { StoreSwitcher } from "@/components/counter/shell/store-switcher"

const stores = [
  { id: "hollywood", name: "Hollywood", stage: "trading" as const },
  { id: "glendale", name: "Glendale", stage: "pre_open" as const },
  { id: "vannuys", name: "Van Nuys", stage: "warming_up" as const },
]

/**
 * `open` is a PROP, not internal state: `.rail.is-picking .storepop` — a class
 * on the rail — is the only selector that shows the popover, so the state has
 * to live where that class goes. `Rail` owns it; these tests supply it.
 *
 * Every event below is `fireEvent`, never a raw `.click()`: under React 19 +
 * RTL 16 + jsdom a raw click runs the handler but the resulting `setState` does
 * not commit before the next synchronous line.
 */
function setup(props: Partial<Parameters<typeof StoreSwitcher>[0]> = {}) {
  const onOpenChange = vi.fn()
  const onSelect = vi.fn()
  const result = render(
    <StoreSwitcher
      stores={stores}
      selectedId={null}
      onSelect={onSelect}
      open={false}
      onOpenChange={onOpenChange}
      {...props}
    />,
  )
  return { ...result, onOpenChange, onSelect }
}

describe("StoreSwitcher", () => {
  it("is the prototype's .rail__store: a two-line trigger with .nm over .mt", () => {
    const { container } = setup({ selectedId: "hollywood" })
    const trigger = container.querySelector(".rail__store") as HTMLElement
    expect(trigger.querySelector(".nm")?.textContent).toBe("Hollywood")
    expect(trigger.querySelector(".mt")?.textContent).toBe("1 of 3 stores")
  })

  it("treats a null selection as all stores, and counts the locations", () => {
    const { container } = setup({ selectedId: null })
    const trigger = container.querySelector(".rail__store") as HTMLElement
    expect(trigger.querySelector(".nm")?.textContent).toBe("All stores")
    expect(trigger.querySelector(".mt")?.textContent).toBe("3 locations")
  })

  it("keeps .storepop in the DOM whether or not it is open — the prototype shows it with a class, not a mount", () => {
    // This is what puts the store options behind `display:none` rather than
    // behind a React branch. It matters because the same decision on `.drpop`
    // is what makes the date control's Apply button a landmark the fidelity
    // gate can see.
    const { container } = setup({ open: false })
    expect(container.querySelector(".storepop")).toBeTruthy()
    expect(container.querySelectorAll(".storeopt")).toHaveLength(4)
  })

  it("offers every store plus all of them", () => {
    const { container } = setup({ open: true })
    const opts = [...container.querySelectorAll(".storeopt")].map((o) => o.textContent)
    expect(opts[0]).toContain("All stores")
    expect(opts.join(" ")).toContain("Hollywood")
    expect(opts.join(" ")).toContain("Glendale")
    expect(opts.join(" ")).toContain("Van Nuys")
  })

  it("marks the selection with aria-pressed, which is also the selector that paints it", () => {
    // `.storeopt[aria-pressed="true"]` (counter-components.css:747) is the ONLY
    // rule that highlights the current store. `role="radio"`/`aria-checked` —
    // what this used before the port — would have left it unpainted, and
    // `role="radio"` does not take `aria-pressed` at all.
    const { container } = setup({ open: true, selectedId: "hollywood" })
    const pressed = [...container.querySelectorAll(".storeopt")].filter(
      (o) => o.getAttribute("aria-pressed") === "true",
    )
    expect(pressed).toHaveLength(1)
    expect(pressed[0].textContent).toContain("Hollywood")
  })

  it("names a store's stage in a .mtag, because a pre-open store has no figures for a reason", () => {
    // Note 58: the model has three stages and the pre-Counter interface could
    // express two, so a reader looking at an empty Glendale could not tell
    // "not trading yet" from "the sync failed".
    const { container } = setup({ open: true })
    const tags = [...container.querySelectorAll(".mtag")].map((t) => [t.className, t.textContent])
    expect(tags).toEqual([
      ["mtag", "3"],
      ["mtag good", "Trading"],
      ["mtag warn", "Pre-open"],
      ["mtag", "Warming up"],
    ])
  })

  it("reports the chosen store, and null for all, and closes either way", () => {
    // Scoped to `.storeopt`: the trigger says "All stores" too, and matching
    // it by name alone would click the thing that opens the popover.
    const { container, onSelect, onOpenChange } = setup({ open: true })
    const opt = (name: string) =>
      [...container.querySelectorAll(".storeopt")].find((o) => o.textContent?.includes(name))!
    fireEvent.click(opt("Hollywood"))
    expect(onSelect).toHaveBeenCalledWith("hollywood")
    expect(onOpenChange).toHaveBeenLastCalledWith(false)

    fireEvent.click(opt("All stores"))
    expect(onSelect).toHaveBeenLastCalledWith(null)
  })

  it("asks to be closed on Escape, without selecting", () => {
    const { onOpenChange, onSelect } = setup({ open: true })
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it("asks to be closed on an outside click, without selecting", () => {
    const { onOpenChange, onSelect } = setup({ open: true })
    fireEvent.mouseDown(document.body)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onSelect).not.toHaveBeenCalled()
  })
})
