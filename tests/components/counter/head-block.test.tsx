// @vitest-environment jsdom
/**
 * `headBlock()`'s inner block — prototype lines 3689 (the wrapper we do NOT
 * port) and 4244 (Overview's two-figure body).
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { HeadBlock, LeadFigure } from "@/components/counter/surface/head-block"
import { Say } from "@/components/counter/surface/say"
import { FloorMeter } from "@/components/counter/surface/floor-meter"

const SAY = <Say headline="On plan">Everything is fine.</Say>

describe("HeadBlock", () => {
  it("two figures: the duo modifier, and the second figure ruled off as the co-lead", () => {
    const { container } = render(
      <HeadBlock
        figures={[
          <LeadFigure key="f1" label="Net sales today" value="$7,468" detail="▲ 5.1% vs last Tuesday" />,
          <LeadFigure key="f2" label="Sales per labor hour" value="$71.40" detail="104 hours bought" />,
        ]}
      >
        {SAY}
      </HeadBlock>,
    )
    const head = container.querySelector(".headline") as HTMLElement
    expect(head.className).toBe("headline headline--duo")
    expect([...head.children].map((c) => c.className)).toEqual(["fig", "fig fig--co", "say"])
  })

  it("one figure: a bare .headline, because the two-track rule is the one that fits it", () => {
    const { container } = render(
      <HeadBlock figures={[<LeadFigure key="f3" label="Hourly labor" value="24.8%" />]}>{SAY}</HeadBlock>,
    )
    const head = container.querySelector(".headline") as HTMLElement
    // `.headline` is minmax(210px,auto) 1fr; `--duo` is three tracks. One
    // figure in three tracks leaves an empty column between it and the say.
    expect(head.className).toBe("headline")
    expect([...head.children].map((c) => c.className)).toEqual(["fig", "say"])
  })

  it("the modifier follows the figure count — a caller cannot forget it or get it wrong", () => {
    const one = render(
      <HeadBlock figures={[<LeadFigure key="f4" label="a" value="1" />]}>{SAY}</HeadBlock>,
    ).container.querySelector(".headline")!.className
    const two = render(
      <HeadBlock
        figures={[
          <LeadFigure key="f5" label="a" value="1" />,
          <LeadFigure key="f6" label="b" value="2" />,
        ]}
      >
        {SAY}
      </HeadBlock>,
    ).container.querySelector(".headline")!.className
    expect(one).not.toContain("headline--duo")
    expect(two).toContain("headline--duo")
  })

  it("a figure is k, then v, then d — the prototype's order", () => {
    const { container } = render(
      <HeadBlock figures={[<LeadFigure key="f7" label="Net sales today" value="$7,468" detail="▲ 5.1%" />]}>
        {SAY}
      </HeadBlock>,
    )
    const fig = container.querySelector(".fig") as HTMLElement
    expect([...fig.children].map((c) => c.className)).toEqual(["k", "v", "d"])
    expect(fig.querySelector(".k")?.textContent).toBe("Net sales today")
    expect(fig.querySelector(".v")?.textContent).toBe("$7,468")
    expect(fig.querySelector(".d")?.textContent).toBe("▲ 5.1%")
  })

  it("omits .d entirely when a figure has not moved against anything", () => {
    const { container } = render(
      <HeadBlock figures={[<LeadFigure key="f8" label="Net sales" value="$7,468" />]}>{SAY}</HeadBlock>,
    )
    expect(container.querySelector(".d")).toBeNull()
  })

  it("the meter goes INSIDE the co-lead figure, after .d", () => {
    const { container } = render(
      <HeadBlock
        figures={[
          <LeadFigure key="f9" label="Net sales today" value="$7,468" />,
          <LeadFigure key="f10" label="Sales per labor hour" value="$71.40" detail="104 hours bought" meter={<FloorMeter value={71.4} floor={68} />} />,
        ]}
      >
        {SAY}
      </HeadBlock>,
    )
    const co = container.querySelector(".fig--co") as HTMLElement
    expect([...co.children].map((c) => c.className)).toEqual([
      "k",
      "v",
      "d",
      "blt blt--lead",
      "hfloor",
    ])
    // And nowhere else: the lead figure carries no meter of its own.
    expect(container.querySelectorAll(".blt")).toHaveLength(1)
  })

  it("puts the verdict LAST, in the track the say rule occupies", () => {
    const { container } = render(
      <HeadBlock
        figures={[
          <LeadFigure key="f11" label="a" value="1" />,
          <LeadFigure key="f12" label="b" value="2" />,
        ]}
      >
        {SAY}
      </HeadBlock>,
    )
    const head = container.querySelector(".headline") as HTMLElement
    expect(head.lastElementChild?.className).toBe("say")
  })

  it("gives .d a tone when the caller supplies one, and the sheet has a rule for it", () => {
    // `.headline .d` is one rule painting var(--good) in the prototype, so a
    // net sales figure DOWN 37.2% printed its ▼ in the colour of a rise, and
    // "no comparison set" printed as good news beside it. Corrected in
    // `scripts/extract-prototype-css.ts`'s CORRECTIONS table, covering this
    // selector and `.mhead .d` together — one decision, two surfaces.
    const sheet = readFileSync(
      join(process.cwd(), "src", "styles", "counter-components.css"),
      "utf-8",
    )
    expect(sheet).toMatch(/\.headline \.d\.is-down\{color:var\(--bad\)\}/)
    expect(sheet).toMatch(/\.headline \.d\.is-flat\{color:var\(--ink-3\)\}/)

    const { container } = render(
      <HeadBlock
        figures={[
          <LeadFigure
            key="d1"
            label="Net sales"
            value="$7,468"
            detail="▼ 37.2% vs the prior period"
            detailTone="is-down"
          />,
          <LeadFigure
            key="d2"
            label="Sales per labor hour"
            value="$71.40"
            detail="14 day readings with labor posted"
            detailTone="is-flat"
          />,
        ]}
      >
        {SAY}
      </HeadBlock>,
    )
    expect([...container.querySelectorAll(".d")].map((d) => d.className)).toEqual([
      "d is-down",
      "d is-flat",
    ])
  })

  it("leaves .d unclassed when no tone is given, because up is the default", () => {
    // `.is-down` is sentiment, not direction — the prototype puts it on a rise
    // and on a fall on the same page. A figure whose FALL is a win keeps the
    // unclassed reading, so this component must never infer from the arrow.
    const { container } = render(
      <HeadBlock
        figures={[
          <LeadFigure key="u1" label="Marketplace fees" value="$684" detail="▼ 12.0% vs the prior period" />,
        ]}
      >
        {SAY}
      </HeadBlock>,
    )
    expect(container.querySelector(".d")!.className).toBe("d")
  })

  it("renders no state of its own — headBlock()'s loading and empty branches are NOT ported", () => {
    // R3: Section is the sole state renderer. The prototype's headBlock()
    // substitutes a `.skb` skeleton body for loading; if that ever arrives
    // here, a page would have two components deciding what loading looks
    // like.
    const { container } = render(
      <HeadBlock figures={[<LeadFigure key="f13" label="a" value="1" />]}>{SAY}</HeadBlock>,
    )
    expect(container.querySelector(".skb")).toBeNull()
    expect(container.querySelector(".empty")).toBeNull()
  })
})
