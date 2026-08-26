// @vitest-environment jsdom
/**
 * `MList` against the prototype's own `mlist()`
 * (`docs/counter/counter-prototype.html` line 3116).
 *
 * The load-bearing rule is the sheet's own, written above `.mli.is-link`:
 * "The chevron used to be typed into the row's value, which meant a row could
 * wear one and go nowhere. It now comes with the destination or not at all."
 */
import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { MList } from "@/components/counter/shell/m-list"

function shapeOf(el: Element): string[] {
  return [...el.children].map((c) => {
    const cls = c.getAttribute("class")
    return cls ? `${c.tagName.toLowerCase()}.${cls.split(/\s+/).join(".")}` : c.tagName.toLowerCase()
  })
}

describe("MList — the phone's list of rows", () => {
  it("wraps .mli rows in .mlist", () => {
    const { container } = render(
      <MList
        rows={[
          { key: "a", title: "Invoice lines do not reconcile", value: "$57.77" },
          { key: "b", title: "Ground beef is up 18%", value: "$4.86" },
        ]}
      />,
    )
    const list = container.firstElementChild!
    expect(list.className).toBe("mlist")
    expect(list.children).toHaveLength(2)
    expect(shapeOf(list)).toEqual(["div.mli", "div.mli"])
  })

  it("emits the two halves the sheet grids: a title block, then .rt", () => {
    const { container } = render(
      <MList
        rows={[
          {
            key: "a",
            title: "Invoice lines do not reconcile",
            detail: "I28517 is $57.77 short",
            value: "$57.77",
            note: "short",
            noteTone: "down",
          },
        ]}
      />,
    )
    const row = container.querySelector(".mli")!
    expect(shapeOf(row)).toEqual(["div", "div.rt"])
    expect(row.querySelector("b")!.textContent).toBe("Invoice lines do not reconcile")
    expect(row.querySelector("div > span")!.textContent).toBe("I28517 is $57.77 short")
    expect(row.querySelector(".rt em")!.className).toBe("down")
  })

  it("omits the second line rather than printing an empty span", () => {
    const { container } = render(<MList rows={[{ key: "a", title: "Milkshake", value: "61" }]} />)
    expect(container.querySelector(".mli div > span")).toBeNull()
  })

  it("omits .rt em when a row has no qualifier", () => {
    const { container } = render(<MList rows={[{ key: "a", title: "Milkshake", value: "61" }]} />)
    expect(container.querySelector(".rt em")).toBeNull()
  })

  it("a row with no href is not a link and wears no chevron", () => {
    // `.mli.is-link::after` IS the chevron. Without `is-link` there is none,
    // which is the whole point of the class.
    const { container } = render(<MList rows={[{ key: "a", title: "Milkshake", value: "61" }]} />)
    const row = container.querySelector(".mli")!
    expect(row.tagName).toBe("DIV")
    expect(row.classList.contains("is-link")).toBe(false)
    expect(container.querySelector("a")).toBeNull()
  })

  it("a row with an href is a real anchor carrying is-link", () => {
    const { container } = render(
      <MList rows={[{ key: "a", title: "Invoice I28517", value: "$57.77", href: "/m/invoices/I28517" }]} />,
    )
    const row = container.querySelector(".mli")!
    expect(row.tagName).toBe("A")
    expect(row.classList.contains("is-link")).toBe(true)
    expect(row.getAttribute("href")).toBe("/m/invoices/I28517")
  })

  it("mixes linked and unlinked rows in one list without either borrowing the other's chevron", () => {
    const { container } = render(
      <MList
        rows={[
          { key: "a", title: "Goes somewhere", value: "1", href: "/m/invoices" },
          { key: "b", title: "Goes nowhere", value: "2" },
        ]}
      />,
    )
    const rows = [...container.querySelectorAll(".mli")]
    expect(rows.map((r) => r.classList.contains("is-link"))).toEqual([true, false])
  })

  it("carries only the two tones the sheet has rules for", () => {
    const { container } = render(
      <MList
        rows={[
          { key: "a", title: "Up", value: "1", note: "up", noteTone: "up" },
          { key: "b", title: "Down", value: "2", note: "down", noteTone: "down" },
          { key: "c", title: "Neither", value: "3", note: "plain" },
        ]}
      />,
    )
    expect([...container.querySelectorAll(".rt em")].map((e) => e.getAttribute("class"))).toEqual([
      "up",
      "down",
      null,
    ])
  })
})
