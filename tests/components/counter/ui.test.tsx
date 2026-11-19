// @vitest-environment jsdom
/**
 * The shared blocks (`@/components/counter/ui`). Behaviour and markup only:
 * jsdom has no layout, so the desk/phone shapes are checked by screenshot on
 * /dashboard/blocks. What IS checked here is what the CSS keys off.
 */
import { describe, it, expect, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { render, screen, fireEvent, renderHook, act as rtlAct } from "@testing-library/react"
import {
  Answer,
  BigNumber,
  BigNumbers,
  Button,
  ButtonLink,
  Card,
  Fold,
  NeedsYou,
  Rows,
  WeekBars,
  Tile,
  Tiles,
  Status,
  StoreCard,
  Tabs,
  useAct,
  actMarks,
  DONE_MS,
} from "@/components/counter/ui"
import { splitFigure } from "@/components/counter/ui/big-number"

const UI = join(process.cwd(), "src/components/counter/ui")
const CSS = readFileSync(join(process.cwd(), "src/styles/counter-ui.css"), "utf8")

describe("shared blocks", () => {
  it("every ui/*.tsx is exported from the ui entry point", () => {
    const barrel = readFileSync(join(UI, "index.ts"), "utf8")
    for (const f of readdirSync(UI).filter((f) => f.endsWith(".tsx"))) {
      expect(barrel).toMatch(new RegExp(`from "\\./${f.replace(/\.tsx$/, "")}"`))
    }
  })

  it("Answer is one paragraph", () => {
    const { container } = render(<Answer>You kept <b>$1</b>.</Answer>)
    expect(container.innerHTML).toBe('<p class="cu-answer">You kept <b>$1</b>.</p>')
  })

  it("BigNumber marks an upper bound and labels a missing input instead of showing $0", () => {
    render(
      <BigNumbers>
        <BigNumber label="Labor" value="24.1%" atMost missing="Glendale missing 2 days" />
        <BigNumber label="Kept" value={null} />
      </BigNumbers>,
    )
    expect(screen.getByText("≤ 24.1%")).toBeTruthy()
    expect(screen.getByText("Glendale missing 2 days").className).toBe("cu-missing")
    expect(screen.getByText("—")).toBeTruthy()
  })

  it("BigNumber's comparison carries its tone", () => {
    render(<BigNumber label="Sales" value="$1" vs={{ change: "▲ 4%", tone: "up", against: "vs last week" }} />)
    expect(screen.getByText("▲ 4%").className).toBe("cu-vs cu-vs--up")
  })

  it("Status has one class per tone, and every tone has a rule", () => {
    for (const tone of ["good", "warn", "bad", "wait"] as const) {
      const { container } = render(<Status tone={tone}>x</Status>)
      expect(container.firstElementChild?.className).toBe(`cu-status cu-status--${tone}`)
      expect(CSS).toContain(`.cu-status--${tone}{`)
    }
  })

  it("Button defaults to type=button and passes clicks through; ButtonLink is a link", () => {
    const onClick = vi.fn()
    render(<Button variant="primary" onClick={onClick}>Fix it</Button>)
    const b = screen.getByRole("button", { name: "Fix it" })
    expect(b.getAttribute("type")).toBe("button")
    expect(b.className).toBe("cu-btn cu-btn--primary")
    fireEvent.click(b)
    expect(onClick).toHaveBeenCalledOnce()
    render(<ButtonLink href="/dashboard/invoices">Open</ButtonLink>)
    expect(screen.getByRole("link", { name: "Open" }).getAttribute("href")).toBe("/dashboard/invoices")
  })

  it("Card contains layout but never paint, so menus and tooltips can overflow it", () => {
    const rule = CSS.match(/\.cu-card\{[^}]*\}/)?.[0] ?? ""
    expect(rule).toContain("contain:layout")
    expect(rule).not.toMatch(/contain:[^;]*(paint|strict|content)/)
    expect(rule).not.toMatch(/overflow:\s*(hidden|clip)/)
    const { container } = render(<Card as="section">x</Card>)
    expect(container.firstElementChild?.tagName).toBe("SECTION")
  })

  it("StoreCard shows its status in words", () => {
    render(<StoreCard name="Glendale" status={{ tone: "wait", label: "Waiting on data" }} figures={[{ label: "Sales", value: "$10" }]} />)
    expect(screen.getByText("Waiting on data").className).toBe("cu-status cu-status--wait")
  })

  it("Rows is a real table at every width, with each cell's phone slot", () => {
    render(
      <Rows
        rowKey={(r) => r.id}
        rows={[{ id: "1", v: "Sysco", a: "$2" }]}
        columns={[
          { key: "v", label: "Vendor", slot: "title", render: (r) => r.v },
          { key: "a", label: "Amount", slot: "amount", align: "end", render: (r) => r.a },
        ]}
      />,
    )
    expect(screen.getByRole("table")).toBeTruthy()
    expect(screen.getByRole("columnheader", { name: "Vendor" })).toBeTruthy()
    expect(screen.getByText("Sysco").getAttribute("data-slot")).toBe("title")
    expect(screen.getByText("$2").className).toBe("cu-end")
  })

  it("NeedsYou is collapsed by default, counts its groups, and renders nothing when empty", () => {
    const { container } = render(
      <NeedsYou groups={[{ key: "a", what: "2 invoices need a store", action: <Button>Yes</Button> }]} />,
    )
    const d = container.querySelector("details")!
    expect(d.open).toBe(false)
    expect(d.querySelector("summary")?.textContent).toBe("1thing needs you")
    expect(render(<NeedsYou groups={[]} />).container.innerHTML).toBe("")
  })

  it("Tabs: buttons report the pressed tab, links mark the current page", () => {
    const onSelect = vi.fn()
    render(<Tabs label="Period" active="week" onSelect={onSelect} items={[{ key: "week", label: "Week" }, { key: "month", label: "Month" }]} />)
    expect(screen.getByRole("button", { name: "Week" }).getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: "Month" }))
    expect(onSelect).toHaveBeenCalledWith("month")
    render(<Tabs label="Pages" active="a" items={[{ key: "a", label: "All", href: "/x" }]} />)
    expect(screen.getByRole("link", { name: "All" }).getAttribute("aria-current")).toBe("page")
  })

  it("Fold is a closed details by default", () => {
    const { container } = render(<Fold summary="Show every number">x</Fold>)
    expect(container.querySelector("details")?.open).toBe(false)
  })

  it("WeekBars: tallest bar is full height, nothing drawn for a negative week, a tap reports the key", () => {
    const onPick = vi.fn()
    const { container } = render(
      <WeekBars
        title="Weeks"
        partialLabel="labor missing"
        onPick={onPick}
        weeks={[
          { key: "a", label: "8/10", value: 50, top: "$50", ariaLabel: "a" },
          { key: "b", label: "8/17", value: 100, top: "$100", partial: true, selected: true, ariaLabel: "b" },
          { key: "c", label: "8/24", value: -20, top: "-$20", ariaLabel: "c" },
        ]}
      />,
    )
    const bars = [...container.querySelectorAll<HTMLElement>(".cu-weeks__bar")]
    expect(bars.map((b) => b.style.height)).toEqual(["50%", "100%", "0px"])
    expect(bars[1].classList.contains("is-part")).toBe(true)
    expect(screen.getByRole("button", { name: "b" }).getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: "a" }))
    expect(onPick).toHaveBeenCalledWith("a")
    expect(container.querySelector(".cu-weeks__key")?.textContent).toContain("labor missing")
  })

  it("the stylesheet uses only tokens: no colour literals", () => {
    const body = CSS.replace(/\/\*[\s\S]*?\*\//g, "")
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(|oklch\(/i)
  })

  it("every width-query block also sets its own width, so a flex or grid parent can't shrink it to 0", () => {
    // A container-type element has no content width; in a flex row it collapsed
    // to 0 and pushed the invoice buttons off the screen (2026-11-18).
    const body = CSS.replace(/\/\*[\s\S]*?\*\//g, "")
    const containers = [...body.matchAll(/(\.cu-[\w-]+)\{[^}]*container-type:inline-size/g)].map((m) => m[1])
    expect(containers.length).toBeGreaterThan(0)
    const guard = body.match(/([^{}]+)\{width:100%;min-width:0\}/)
    expect(guard).not.toBeNull()
    const guarded = guard![1].split(",").map((s) => s.trim())
    for (const c of containers) expect(guarded).toContain(c)
  })

  it("Tile: a link when it goes somewhere, red when bad, number coloured by tone", () => {
    const { container } = render(
      <Tiles>
        <Tile label="To ship" value={3} sub="1 late" bad href="/x" />
        <Tile label="Missed" value={1} tone="bad" />
      </Tiles>,
    )
    const [a, b] = container.querySelectorAll(".cu-tiles > *")
    expect(a.tagName).toBe("A")
    expect(a.className).toBe("cu-tile cu-tile--bad")
    expect(a.querySelector(".cu-tile__value")?.textContent).toBe("3")
    expect(b.tagName).toBe("DIV")
    expect(b.className).toBe("cu-tile cu-tile--tone-bad")
  })

  it("motion reads only duration tokens, and reduced motion zeroes every one of them", () => {
    const tokens = readFileSync(join(process.cwd(), "src/styles/counter.css"), "utf8")
    const declared = [...tokens.matchAll(/(--ct-dur-[a-z]+):\s*\d+ms/g)].map((m) => m[1])
    expect(new Set(declared).size).toBeGreaterThanOrEqual(5)
    const reduced = tokens.match(/@media \(prefers-reduced-motion: reduce\) \{\s*:root \{([^}]*)\}/)
    expect(reduced).not.toBeNull()
    for (const t of new Set(declared)) expect(reduced![1]).toContain(`${t}: 0ms`)
    // The Motion section of the blocks' stylesheet times nothing with a raw
    // number except the spinner's turn and the one-off changed flash.
    const motion = CSS.slice(CSS.indexOf("/* ---- Motion ----")).replace(/\/\*[\s\S]*?\*\//g, "")
    const raw = [...motion.matchAll(/(?:animation|transition)[^;{}]*?\b(\d*\.?\d+m?s)\b/g)].map((m) => m[1])
    expect(raw.filter((d) => !["7s", ".7s", "1.3s", "3s"].includes(d))).toEqual([])
  })

  it("Button shows working and done states, and a working button can't be tapped twice", () => {
    const onClick = vi.fn()
    const { rerender } = render(<Button state="busy" onClick={onClick}>Approve</Button>)
    const b = screen.getByRole("button")
    expect(b).toHaveProperty("disabled", true)
    expect(b.getAttribute("aria-busy")).toBe("true")
    expect(b.dataset.state).toBe("busy")
    expect(b.textContent).toBe("Approve")
    rerender(<Button state="done" doneLabel="Approved" onClick={onClick}>Approve</Button>)
    expect(screen.getByRole("button").textContent).toBe("✓ Approved")
    rerender(<Button state="idle" onClick={onClick}>Approve</Button>)
    expect(screen.getByRole("button").dataset.state).toBeUndefined()
  })

  it("actMarks: a plain button carries busy and done for the motion layer, nothing when idle or failed", () => {
    expect(actMarks("busy")).toEqual({ "aria-busy": true, "data-state": "busy" })
    expect(actMarks("done")).toEqual({ "aria-busy": undefined, "data-state": "done" })
    expect(actMarks("idle")).toEqual({ "aria-busy": undefined, "data-state": undefined })
    expect(actMarks("failed")).toEqual({ "aria-busy": undefined, "data-state": undefined })
  })

  it("useAct: busy, then done with the words fixed at the tap, then idle; a failure keeps its error", async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useAct())
    let resolve!: (v: { ok: true }) => void
    rtlAct(() => {
      result.current.act("a", () => new Promise((r) => (resolve = r)), { done: "Saved" })
    })
    expect(result.current.stateOf("a")).toBe("busy")
    expect(result.current.stateOf("b")).toBe("idle")
    await rtlAct(async () => resolve({ ok: true }))
    expect(result.current.stateOf("a")).toBe("done")
    expect(result.current.doneOf("a")).toBe("Saved")
    rtlAct(() => vi.advanceTimersByTime(DONE_MS))
    expect(result.current.stateOf("a")).toBe("idle")
    await rtlAct(async () => {
      result.current.act("b", async () => ({ ok: false as const, error: "forbidden" }))
    })
    expect(result.current.stateOf("b")).toBe("failed")
    expect(result.current.error).toBe("forbidden")
    vi.useRealTimers()
  })

  it("BigNumber's count-up splits a figure without changing what it ends on", () => {
    expect(splitFigure("$1,302.50")).toEqual({ before: "$", value: 1302.5, decimals: 2, after: "" })
    expect(splitFigure("62 of 65")).toEqual({ before: "", value: 62, decimals: 0, after: " of 65" })
    expect(splitFigure("−$260")?.before).toBe("−$")
    expect(splitFigure("—")).toBeNull()
    // First render is the exact text (hydration-safe).
    render(<BigNumber label="Kept" value="$71.20" />)
    expect(screen.getByText("$71.20")).toBeTruthy()
  })
})

