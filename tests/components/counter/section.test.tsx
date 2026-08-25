// @vitest-environment jsdom
/**
 * `sec()` at line 3037 of docs/counter/counter-prototype.html, plus our sixth
 * state. The head/body split is what the ported stylesheet is written against,
 * so the tests assert the elements, not only the text inside them.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { Section } from "@/components/counter/surface/section"
import { ready, stale, loading, failed, empty, notComputed } from "@/lib/counter/section-data"

const body = (d: { n: number }) => <p>value {d.n}</p>

describe("Section", () => {
  it("emits the prototype's .sec > .sec__head > h3, then .sec__body", () => {
    const { container } = render(
      <Section title="Net sales" data={ready({ n: 7 })}>
        {body}
      </Section>,
    )
    const sec = container.querySelector(".sec")!
    expect(sec.children).toHaveLength(2)
    const [head, sectionBody] = Array.from(sec.children)
    expect(head.className).toBe("sec__head")
    expect(head.firstElementChild!.tagName).toBe("H3")
    expect(sectionBody.className).toBe("sec__body")
    expect(sectionBody.textContent).toBe("value 7")
  })

  it("renders its children only when data is present", () => {
    render(
      <Section title="Net sales" data={ready({ n: 7 })}>
        {body}
      </Section>,
    )
    expect(screen.getByText("value 7")).toBeTruthy()
  })

  it("pad={false} drops .sec__body — the prototype's raw(), which is what a table needs", () => {
    const { container } = render(
      <Section title="Stores" data={ready({ n: 1 })} pad={false}>
        {() => <table className="tbl" />}
      </Section>,
    )
    expect(container.querySelector(".sec__body")).toBeNull()
    // and the body is still there, as a direct child of .sec
    expect(container.querySelector(".sec > .tbl")).toBeTruthy()
  })

  it("loading swaps ONLY the body: the head survives, the skeleton is inside .sec__body", () => {
    const spy = vi.fn(body)
    const { container } = render(
      <Section title="Net sales" data={loading()}>
        {spy}
      </Section>,
    )
    expect(container.querySelector(".sec__head h3")!.textContent).toBe("Net sales")
    expect(container.querySelectorAll(".sec__body .skb-row")).toHaveLength(4)
    expect(container.querySelectorAll(".sec__body .skb-row .skb.skb-line")).toHaveLength(16)
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
    expect(spy).not.toHaveBeenCalled()
  })

  it("failure names the section that failed, inside .sec__body, and keeps the rest of the page", () => {
    const { container } = render(
      <Section title="Net sales" data={failed("timed out after 8s", "retrySync")}>
        {body}
      </Section>,
    )
    const failedBody = container.querySelector(".sec__body > .failed")!
    expect(failedBody.querySelector(".fi")!.textContent).toBe("!")
    expect(failedBody.querySelector("b")!.textContent).toBe("Net sales unavailable")
    expect(failedBody.querySelector(".acts .mono")!.textContent).toBe("timed out after 8s")
    expect(screen.getByRole("alert")).toBeTruthy()
    expect(screen.queryByText(/value/)).toBeNull()
  })

  it("the empty body is NOT wrapped in .sec__body — .empty pads itself, as in the prototype", () => {
    const { container } = render(
      <Section title="Net sales" data={empty("pre_open")}>
        {body}
      </Section>,
    )
    expect(container.querySelector(".sec__body")).toBeNull()
    const emptyBody = container.querySelector(".sec > .empty")!
    expect(emptyBody.querySelector(".t")!.textContent).toMatch(/not trading yet/i)
    expect(emptyBody.querySelector(".s")).toBeTruthy()
    // the head is still there, so a reader knows WHICH section is empty
    expect(container.querySelector(".sec__head h3")!.textContent).toBe("Net sales")
  })

  it("not_computed is our sixth state and sits inside .sec__body like the others", () => {
    const { container } = render(
      <Section title="Leak ledger" data={notComputed("clock-in/out leak ledger")}>
        {body}
      </Section>,
    )
    expect(container.querySelector(".sec__body")!.textContent).toMatch(/clock-in\/out leak ledger/)
    expect(container.querySelector(".sec__head h3")!.textContent).toBe("Leak ledger")
  })

  it("stale renders the banner AND the data — the figures are still real", () => {
    render(
      <Section title="Net sales" data={stale({ n: 7 }, new Date(2026, 7, 24, 9, 0))}>
        {body}
      </Section>,
    )
    expect(screen.getByRole("status").textContent).toMatch(/last good/i)
    expect(screen.getByText("value 7")).toBeTruthy()
  })

  it("shows the title in every state, so a reader knows what failed", () => {
    for (const d of [
      ready({ n: 1 }),
      loading(),
      failed("x", "y"),
      empty("no_match"),
      notComputed("z"),
    ]) {
      const { unmount } = render(
        <Section title="Net sales" data={d}>
          {body}
        </Section>,
      )
      expect(screen.getByRole("heading", { name: "Net sales" })).toBeTruthy()
      unmount()
    }
  })

  it("meta is .k in the head, and only when there is data to describe", () => {
    const { container, unmount } = render(
      <Section title="Net sales" meta="last 30 days" data={ready({ n: 1 })}>
        {body}
      </Section>,
    )
    expect(container.querySelector(".sec__head .k")!.textContent).toBe("last 30 days")
    unmount()
    // The prototype gates meta on `st === 'ok'` exactly like askmini — only
    // the title survives every state.
    render(
      <Section title="Net sales" meta="last 30 days" data={loading()}>
        {body}
      </Section>,
    )
    expect(screen.queryByText("last 30 days")).toBeNull()
  })

  it("offers .askmini only when there is an answer to ask about", () => {
    const { container, unmount } = render(
      <Section title="Net sales" askAbout data={ready({ n: 1 })}>
        {body}
      </Section>,
    )
    const btn = container.querySelector(".sec__head button.askmini")!
    expect(btn).toHaveAttribute("type", "button")
    expect(btn.querySelector("svg")).toBeTruthy()
    expect(btn.textContent).toMatch(/ask about this/i)
    unmount()
    render(
      <Section title="Net sales" askAbout data={loading()}>
        {body}
      </Section>,
    )
    expect(screen.queryByRole("button", { name: /ask about this/i })).toBeNull()
  })

  it("asks about the section by its own title unless told otherwise", () => {
    const { unmount } = render(
      <Section title="Net sales" askAbout data={ready({ n: 1 })}>
        {body}
      </Section>,
    )
    expect(screen.getByRole("button", { name: /ask about this/i })).toHaveAttribute(
      "data-askabout",
      "Net sales",
    )
    unmount()
    render(
      <Section title="Stores" askAbout="the per-store ledger" data={ready({ n: 1 })}>
        {body}
      </Section>,
    )
    expect(screen.getByRole("button", { name: /ask about this/i })).toHaveAttribute(
      "data-askabout",
      "the per-store ledger",
    )
  })

  it("strips markup out of the question, and does not double-escape a quote", () => {
    // The prototype hand-escapes `"` to `&quot;` because it concatenates the
    // attribute by hand. JSX escapes it already, so porting that replace would
    // put a literal &quot; into the DOM and hand the Ask surface entity noise.
    render(
      <Section title="x" askAbout={'why is <b>food cost</b> over "plan"?'} data={ready({ n: 1 })}>
        {body}
      </Section>,
    )
    expect(screen.getByRole("button", { name: /ask about this/i })).toHaveAttribute(
      "data-askabout",
      'why is food cost over "plan"?',
    )
  })
})
