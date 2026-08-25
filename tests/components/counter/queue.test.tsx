// @vitest-environment jsdom
/**
 * `queue()` at line 3074 and `kv()` at line 3086 of
 * docs/counter/counter-prototype.html.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { Queue, type QueueItem } from "@/components/counter/surface/queue"
import { Kv } from "@/components/counter/surface/kv"

const items: QueueItem[] = [
  {
    key: "invoice",
    tone: "bad",
    lead: "3",
    unit: "lines",
    title: "Invoice lines that do not reconcile",
    body: "Extracted lines fall $57.77 short of the header total.",
    act: "Review invoice",
    onAct: () => {},
  },
  {
    key: "beef",
    tone: "warn",
    lead: "18%",
    unit: "per lb",
    title: "Ground beef is up in three weeks",
    body: "$4.12 to $4.86 per lb.",
  },
]

describe("Queue", () => {
  it("emits .queue > .qitem, one per item", () => {
    const { container } = render(<Queue items={items} />)
    const queue = container.querySelector(".queue")!
    expect(queue.children).toHaveLength(2)
    for (const q of Array.from(queue.children)) expect(q.className).toBe("qitem")
  })

  it("a qitem is the lead figure and one UNCLASSED div — .qitem b/p/.do style its children", () => {
    const { container } = render(<Queue items={items} />)
    const first = container.querySelector(".qitem")!
    expect(first.children).toHaveLength(2)
    expect(first.children[0].className).toBe("lead")
    expect(first.children[1].tagName).toBe("DIV")
    expect(first.children[1].className).toBe("")
    expect(first.children[1].querySelector("b")!.textContent).toBe(items[0].title)
    expect(first.children[1].querySelector("p")!.textContent).toBe(items[0].body)
  })

  it("the unit is an <em> inside .lead, and is dropped when there isn't one", () => {
    const { container } = render(
      <Queue
        items={[
          items[0],
          { key: "x", tone: "good", lead: "75.8%", title: "T", body: "B" },
        ]}
      />,
    )
    const leads = container.querySelectorAll(".lead")
    expect(leads[0].querySelector("em")!.textContent).toBe("lines")
    expect(leads[0].textContent).toBe("3lines")
    expect(leads[1].querySelector("em")).toBeNull()
  })

  it("the tone becomes an inline var(--token), never a colour", () => {
    const { container } = render(<Queue items={items} />)
    const leads = container.querySelectorAll<HTMLElement>(".lead")
    expect(leads[0].style.color).toBe("var(--bad)")
    expect(leads[1].style.color).toBe("var(--warn)")
  })

  it("the action is a .do button, and there is none when there is nothing to do", () => {
    const onAct = vi.fn()
    const { container } = render(
      <Queue
        items={[
          {
            key: "invoice",
            tone: "bad",
            lead: "3",
            title: "Invoice lines that do not reconcile",
            body: "…",
            act: "Review invoice",
            onAct,
          },
          items[1],
        ]}
      />,
    )
    const buttons = container.querySelectorAll("button.do")
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveAttribute("type", "button")
    fireEvent.click(buttons[0])
    expect(onAct).toHaveBeenCalledTimes(1)
  })
})

describe("Kv", () => {
  it("emits .kv > div > span + b, both children unclassed", () => {
    const { container } = render(
      <Kv
        rows={[
          { label: "Timezone", value: "America/Los_Angeles" },
          { label: "In review", value: "3 · $2,140", tone: "warn" },
        ]}
      />,
    )
    const kv = container.querySelector(".kv")!
    expect(kv.children).toHaveLength(2)
    const first = kv.children[0]
    expect(first.tagName).toBe("DIV")
    expect(first.className).toBe("")
    expect(first.children[0].tagName).toBe("SPAN")
    expect(first.children[1].tagName).toBe("B")
    expect(screen.getByText("America/Los_Angeles").tagName).toBe("B")
  })

  it("a toned value takes the token, an untoned one takes no colour at all", () => {
    const { container } = render(
      <Kv rows={[{ label: "a", value: "1" }, { label: "b", value: "2", tone: "good" }]} />,
    )
    const bs = container.querySelectorAll<HTMLElement>(".kv b")
    expect(bs[0].getAttribute("style")).toBeNull()
    expect(bs[1].style.color).toBe("var(--good)")
  })
})
