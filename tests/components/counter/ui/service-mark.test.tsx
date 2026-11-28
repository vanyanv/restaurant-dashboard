// @vitest-environment jsdom
/**
 * The developer page's icons. Every icon id the two lists use must have a
 * drawing, drawn in the text colour and hidden from a screen reader.
 */
import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CONNECTION_ICONS } from "@/lib/counter/connections"
import { STACK_ICONS } from "@/lib/counter/stack"
import { SERVICE_MARKS, ServiceMark, type ServiceMarkId } from "@/components/counter/ui"
import { BRAND_PATHS } from "@/components/counter/ui/service-mark-paths"

const IDS = [...new Set<string>([...CONNECTION_ICONS, ...STACK_ICONS])]

describe("ServiceMark", () => {
  it("covers both id lists, and holds no id neither list uses", () => {
    expect(IDS.length).toBeGreaterThan(20)
    expect(Object.keys(SERVICE_MARKS).sort()).toEqual([...IDS].sort())
  })

  it.each(IDS)("draws %s", (id) => {
    const { container } = render(<ServiceMark icon={id as ServiceMarkId} />)
    const svg = container.querySelector("svg")
    expect(svg, id).not.toBeNull()
    // Decorative: the name sits beside it in words.
    expect(svg!.getAttribute("aria-hidden")).toBe("true")
    // Something is actually drawn.
    expect(svg!.querySelectorAll("path,circle,rect,line,polyline").length).toBeGreaterThan(0)
    // In the text colour, never a colour of its own.
    const paint = [svg!, ...svg!.querySelectorAll("*")].flatMap((el) => [el.getAttribute("fill"), el.getAttribute("stroke")])
    expect(paint.filter((p) => p !== null && p !== "none" && p !== "currentColor")).toEqual([])
  })

  it("draws a brand mark from its one path", () => {
    const { container } = render(<ServiceMark icon="vercel" size={20} />)
    const svg = container.querySelector("svg")!
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24")
    expect(svg.getAttribute("width")).toBe("20")
    expect(svg.querySelector("path")!.getAttribute("d")).toBe(BRAND_PATHS.vercel)
  })

  it("falls back to the key for an id it does not know, never a blank", () => {
    const { container } = render(<ServiceMark icon={"not-an-icon" as ServiceMarkId} />)
    expect(container.querySelector("svg")).not.toBeNull()
  })

  it("keeps brand colours out: the path data holds no colour at all", () => {
    const src = readFileSync(join(process.cwd(), "src/components/counter/ui/service-mark-paths.ts"), "utf8")
    expect(src).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(|oklch\(|fill=/i)
  })
})
