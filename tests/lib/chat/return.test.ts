// Pure selectors behind the Answer Block. These decide what the chat renders
// for an assistant turn, so every degradation path matters more than the happy
// one: a malformed or half-streamed `fileReturn` must fall back to the old
// prose layout, never to an empty frame.

import { describe, it, expect } from "vitest"
import {
  selectFiledReturn,
  returnForm,
  splitProvenance,
  type ReturnPart,
} from "@/lib/chat/return"

function filed(overrides: Record<string, unknown> = {}): ReturnPart {
  return {
    type: "tool-fileReturn",
    toolName: "fileReturn",
    state: "output-available",
    output: {
      verdict: "Sales ran ahead of the week before on fewer orders.",
      department: "Sales",
      scope: "Hollywood · Aug 11 – 17",
      figures: [
        { value: "$48,912", label: "Net sales", delta: "+6.4%", direction: "up" },
        { value: "1,204", label: "Orders", delta: "-1.8%", direction: "down" },
      ],
      ...overrides,
    },
  }
}

describe("selectFiledReturn", () => {
  it("returns null when the message has no parts", () => {
    expect(selectFiledReturn([])).toBeNull()
  })

  it("returns null when no fileReturn part is present", () => {
    const parts: ReturnPart[] = [
      { type: "text", text: "Sales were up." },
      { type: "tool-getDailySales", toolName: "getDailySales", state: "output-available", output: [] },
    ]
    expect(selectFiledReturn(parts)).toBeNull()
  })

  it("ignores a return that is still streaming", () => {
    const part = filed()
    part.state = "input-streaming"
    expect(selectFiledReturn([part])).toBeNull()
  })

  it("reads the filed verdict, department, scope and figures", () => {
    const r = selectFiledReturn([filed()])
    expect(r).not.toBeNull()
    expect(r!.verdict).toBe("Sales ran ahead of the week before on fewer orders.")
    expect(r!.department).toBe("Sales")
    expect(r!.scope).toBe("Hollywood · Aug 11 – 17")
    expect(r!.figures).toHaveLength(2)
    expect(r!.figures[0]).toEqual({
      value: "$48,912",
      label: "Net sales",
      delta: "+6.4%",
      direction: "up",
    })
  })

  it("takes the last return when the model files twice", () => {
    const first = filed({ verdict: "First pass." })
    const second = filed({ verdict: "Corrected pass." })
    expect(selectFiledReturn([first, second])!.verdict).toBe("Corrected pass.")
  })

  it("returns null on a malformed payload rather than throwing", () => {
    const junk: ReturnPart[] = [
      { type: "tool-fileReturn", toolName: "fileReturn", state: "output-available", output: null },
      { type: "tool-fileReturn", toolName: "fileReturn", state: "output-available", output: "nope" },
      { type: "tool-fileReturn", toolName: "fileReturn", state: "output-available", output: { department: "Sales" } },
    ]
    for (const p of junk) expect(selectFiledReturn([p])).toBeNull()
  })

  it("clamps the figure strip to three and drops malformed entries", () => {
    const r = selectFiledReturn([
      filed({
        figures: [
          { value: "$1", label: "One" },
          { value: "$2" }, // no label — dropped
          { value: "$3", label: "Three" },
          { value: "$4", label: "Four" },
          { value: "$5", label: "Five" },
        ],
      }),
    ])
    expect(r!.figures.map((f) => f.label)).toEqual(["One", "Three", "Four"])
  })

  it("drops a direction the model invented outside up/down", () => {
    const r = selectFiledReturn([
      filed({ figures: [{ value: "$1", label: "One", delta: "+1%", direction: "sideways" }] }),
    ])
    expect(r!.figures[0].direction).toBeUndefined()
    expect(r!.figures[0].delta).toBe("+1%")
  })

  it("tolerates a missing scope", () => {
    const r = selectFiledReturn([filed({ scope: undefined })])
    expect(r!.scope).toBe("")
  })
})

describe("returnForm", () => {
  it("files a no-data department as the empty return", () => {
    const r = selectFiledReturn([filed({ department: "No data", figures: [] })])
    expect(returnForm(r!)).toBe("empty")
  })

  it("keeps the empty form even if the model filed a stray figure", () => {
    const r = selectFiledReturn([
      filed({ department: "No data", figures: [{ value: "0", label: "Rows" }] }),
    ])
    expect(returnForm(r!)).toBe("empty")
  })

  it("renders a single-figure answer short", () => {
    const r = selectFiledReturn([
      filed({ figures: [{ value: "$9,102", label: "Net sales", delta: "+12.4%", direction: "up" }] }),
    ])
    expect(returnForm(r!)).toBe("short")
  })

  it("renders a figureless in-scope answer short rather than empty", () => {
    const r = selectFiledReturn([filed({ figures: [] })])
    expect(returnForm(r!)).toBe("short")
  })

  it("renders two or more figures as the full return", () => {
    expect(returnForm(selectFiledReturn([filed()])!)).toBe("full")
  })
})

describe("splitProvenance", () => {
  it("pulls the trailing From line off the body", () => {
    const { body, footer } = splitProvenance(
      "The week closed at $48,912.\n\nFrom getDailySales · Hollywood · 2026-08-11 to 2026-08-17",
    )
    expect(body).toBe("The week closed at $48,912.")
    expect(footer).toBe("From getDailySales · Hollywood · 2026-08-11 to 2026-08-17")
  })

  it("strips a quote marker the model added against instructions", () => {
    const { footer } = splitProvenance("Body.\n\n> From searchInvoices · Hollywood · Mar 2026")
    expect(footer).toBe("From searchInvoices · Hollywood · Mar 2026")
  })

  it("leaves a body with no footer untouched", () => {
    const { body, footer } = splitProvenance("Just a paragraph with no provenance.")
    expect(body).toBe("Just a paragraph with no provenance.")
    expect(footer).toBeNull()
  })

  it("does not treat a mid-body From sentence as the footer", () => {
    const text = "From June onward the trend held.\n\nOrders rose 4%."
    const { body, footer } = splitProvenance(text)
    expect(footer).toBeNull()
    expect(body).toBe(text)
  })

  it("handles an empty string", () => {
    expect(splitProvenance("")).toEqual({ body: "", footer: null })
  })
})

describe("follow-ups", () => {
  it("reads the questions the model filed", () => {
    const r = selectFiledReturn([filed({ followUps: ["Break that out by platform", "Same week last year"] })])
    expect(r!.followUps).toEqual(["Break that out by platform", "Same week last year"])
  })

  it("is an empty list when the model filed none", () => {
    expect(selectFiledReturn([filed()])!.followUps).toEqual([])
  })

  it("caps at three so the answer does not end in a wall of chips", () => {
    const r = selectFiledReturn([filed({ followUps: ["a", "b", "c", "d", "e"] })])
    expect(r!.followUps).toEqual(["a", "b", "c"])
  })

  it("drops blank and non-string entries", () => {
    const r = selectFiledReturn([filed({ followUps: ["Real question", "   ", 42, null] })])
    expect(r!.followUps).toEqual(["Real question"])
  })

  it("survives a followUps field that is not an array", () => {
    const r = selectFiledReturn([filed({ followUps: "not an array" })])
    expect(r!.followUps).toEqual([])
  })
})
