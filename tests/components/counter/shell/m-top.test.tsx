// @vitest-environment jsdom
/**
 * `MTop` against the prototype's own `.mtop`, emitted in `phoneFor()`
 * (`docs/counter/counter-prototype.html` line 8742).
 *
 * `.mtop` sits OUTSIDE `.mscroll`, so `npm run fidelity` never measures it —
 * `SURFACE_ROOT.phone` is `#phoneHost .pframe .mscroll`. That is precisely why
 * the phone's store and date controls could go missing when Counter replaced
 * the editorial mobile home and no gate said a word. These tests are the gate
 * that surface does not have.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { MTop } from "@/components/counter/shell/m-top"
import type { SwitchableStore } from "@/components/counter/shell/store-switcher"

const SHEET = readFileSync(join(process.cwd(), "src/styles/counter-components.css"), "utf8")

const STORES: SwitchableStore[] = [
  { id: "hollywood", name: "Hollywood", stage: "trading" },
  { id: "glendale", name: "Glendale", stage: "pre_open" },
  { id: "vannuys", name: "Van Nuys", stage: "warming_up" },
]

function renderTop(overrides: Partial<React.ComponentProps<typeof MTop>> = {}) {
  const onSelectStore = vi.fn()
  const utils = render(
    <MTop
      stores={STORES}
      selectedStoreId="hollywood"
      onSelectStore={onSelectStore}
      date={<button className="mdate">Aug 21</button>}
      {...overrides}
    />,
  )
  return { ...utils, onSelectStore }
}

/**
 * The store sheet is a ui-sdk Drawer whose code loads on the first tap
 * (next/dynamic), so opening is awaited. jsdom has no top layer, so ui-sdk
 * renders it into <body> there (in place in a browser): it is read off
 * `document`. Open and closed are the drawer's own `data-open`.
 */
async function openStores(container: HTMLElement) {
  fireEvent.click(container.querySelector(".st")!)
  await screen.findByRole("dialog", { name: "Pick a store" })
  await waitFor(() => expect(isOpen()).toBe(true))
}
const isOpen = () => document.querySelector(".msheet")?.hasAttribute("data-open") ?? false
const closes = () => waitFor(() => expect(isOpen()).toBe(false))

describe("MTop — the phone's top chrome", () => {
  it("emits .mtop with the store trigger and the date slot, in the prototype's order", () => {
    const { container } = renderTop()
    const top = container.firstElementChild!
    expect(top.className).toBe("mtop")
    // `.st` first; the date last, behind the prototype's own
    // `style="margin-left:auto"` wrapper. The two sheets between them are
    // `position:fixed` and out of flow, so they cannot sit between the two
    // controls visually whatever their DOM order.
    expect(top.firstElementChild!.className).toBe("st")
    const last = top.lastElementChild as HTMLElement
    expect(last.tagName).toBe("SPAN")
    expect(last.style.marginLeft).toBe("auto")
    expect(last.querySelector(".mdate")).not.toBeNull()
  })

  it("every class it emits has a rule in the ported sheet", () => {
    // The `Meter` defect: a component that existed, was exported, was used,
    // and was invisible to the design system. Nothing here is invented markup
    // — `.mtop`, `.mtop .st`, `.msheet`, `.pshade`, `.storeopt` and `.mtag`
    // are all the prototype's.
    for (const rule of [
      ".mtop{",
      ".mtop .st{",
      ".msheet{",
      ".msheet__grab{",
      ".pshade{",
      ".storeopt{",
      ".mtag{",
    ]) {
      expect(SHEET, `${rule} has no rule`).toContain(rule)
    }
  })

  it("the store control is a BUTTON, because the prototype's chevron promises a picker it never had", async () => {
    // `.st` is a <span> in `phoneFor()` — it wears a chevron and opens
    // nothing, which is note 46 ("markup that looks wired and is not") sitting
    // in the design itself. A phone reader has to be able to change the store.
    const { container } = renderTop()
    const trigger = container.querySelector(".st")!
    expect(trigger.tagName).toBe("BUTTON")
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog")
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    await openStores(container)
    expect(trigger.getAttribute("aria-controls")).toBe(document.querySelector(".msheet")!.getAttribute("id"))
  })

  it("names the selected store, and 'All stores' when none is selected", () => {
    const { container, rerender } = renderTop()
    expect(container.querySelector(".st")!.textContent).toContain("Hollywood")
    rerender(
      <MTop stores={STORES} selectedStoreId={null} onSelectStore={() => {}} />,
    )
    expect(container.querySelector(".st")!.textContent).toContain("All stores")
  })

  it("the sheet is not drawn until the store control is tapped, then it slides up", async () => {
    const { container } = renderTop()
    expect(document.querySelector(".msheet")).toBeNull()
    await openStores(container)
    expect(document.querySelector(".pshade")).toBeTruthy()
    expect(container.querySelector(".st")!.getAttribute("aria-expanded")).toBe("true")
  })

  it("offers every store plus 'All stores', pressed on the current one", async () => {
    const { container } = renderTop()
    await openStores(container)
    const opts = [...document.querySelectorAll(".storeopt")]
    expect(opts.map((o) => o.querySelector("b")!.textContent)).toEqual([
      "All stores",
      "Hollywood",
      "Glendale",
      "Van Nuys",
    ])
    // `.storeopt[aria-pressed="true"]` is the ONLY selector that paints the
    // current store, so the attribute is load-bearing rather than decorative.
    expect(opts.map((o) => o.getAttribute("aria-pressed"))).toEqual([
      "false",
      "true",
      "false",
      "false",
    ])
  })

  it("calls a store's stage by the SAME words and tones the rail uses", async () => {
    // One map, two surfaces (`STAGE_TAG`, exported from store-switcher.tsx).
    // A store that is "Warming up" in the rail must not be something else in a
    // sheet, and note 58 is why the third stage exists at all.
    const { container } = renderTop()
    await openStores(container)
    const tags = [...document.querySelectorAll(".storeopt .mtag")]
    expect(tags.map((t) => `${t.className}|${t.textContent}`)).toEqual([
      "mtag|3",
      "mtag good|Trading",
      "mtag warn|Pre-open",
      "mtag|Warming up",
    ])
  })

  it("selecting a store reports it and closes the sheet; 'All stores' reports null", async () => {
    const { container, onSelectStore } = renderTop()
    await openStores(container)
    fireEvent.click(screen.getByText("Van Nuys"))
    expect(onSelectStore).toHaveBeenCalledWith("vannuys")
    await closes()

    await openStores(container)
    fireEvent.click(screen.getByText("All stores", { selector: "b" }))
    // null is the ABSENCE of a store, not a magic "all" id.
    expect(onSelectStore).toHaveBeenLastCalledWith(null)
  })

  it("the shade closes it, and so does Escape", async () => {
    const { container } = renderTop()
    await openStores(container)
    const shade = document.querySelector(".pshade")!
    fireEvent.pointerDown(shade)
    fireEvent.pointerUp(shade)
    fireEvent.click(shade)
    await closes()

    await openStores(container)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
    await closes()
  })

  it("emits no .mback on a page with no trail, and no date slot with no date", () => {
    // A back button to nowhere is the same defect as a chevron to nowhere.
    const { container } = render(
      <MTop stores={STORES} selectedStoreId={null} onSelectStore={() => {}} />,
    )
    expect(container.querySelector(".mback")).toBeNull()
    expect(container.querySelector(".mdate")).toBeNull()
  })

  it("emits NO landmark class, so it cannot move the fidelity count it sits outside of", () => {
    // `.mtop` is outside `.mscroll` on the prototype side but INSIDE
    // `main.m-shell__main` on ours, which is the root the fidelity suite
    // extracts from. A landmark class here would be reported as an extra on a
    // page whose whole job this task is to bring to zero extras.
    const { container } = renderTop()
    fireEvent.click(container.querySelector(".st")!)
    const landmarks = [
      "btn", "sec", "sec__head", "sec__body", "strip", "mstrip", "mhead",
      "mlist", "moving", "sugs", "sug", "chan", "chan__row", "cbar", "btnrow",
      "band", "blt", "sp", "ch", "empty", "fig", "say", "queue", "qitem",
      "stores", "stcard", "kv", "wf", "tbl", "drill", "moneyline", "gap",
      "mtr", "wkt", "hfloor", "askbar", "dispatch", "headline",
    ]
    for (const c of landmarks) {
      expect(container.querySelectorAll(`.${c}`).length, `.${c} inside .mtop`).toBe(0)
    }
  })
})
