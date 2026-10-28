import { describe, expect, it } from "vitest"
import { answerFiledAndWritten } from "@/lib/chat/stop"

const step = (text: string, ...tools: string[]) => ({
  text,
  toolResults: tools.map((toolName) => ({ toolName })),
})

describe("answerFiledAndWritten", () => {
  it("stops once a step both files the return and writes the paragraph", () => {
    expect(
      answerFiledAndWritten({
        steps: [step("", "getDailySales"), step("Sales held.\n\nFrom getDailySales", "fileReturn")],
      }),
    ).toBe(true)
  })

  it("keeps going when the return was filed with no paragraph", () => {
    expect(
      answerFiledAndWritten({ steps: [step("", "getDailySales"), step("  ", "fileReturn")] }),
    ).toBe(false)
  })

  it("keeps going when the fileReturn call failed and produced no result", () => {
    // A schema-rejected call has no tool result; the model must see the error.
    expect(answerFiledAndWritten({ steps: [step("Sales held.")] })).toBe(false)
  })

  it("keeps going while the model is still reading data", () => {
    expect(answerFiledAndWritten({ steps: [step("Checking.", "getDailySales")] })).toBe(false)
  })

  it("reads only the latest step", () => {
    expect(
      answerFiledAndWritten({
        steps: [step("Sales held.", "fileReturn"), step("", "getDailySales")],
      }),
    ).toBe(false)
    expect(answerFiledAndWritten({ steps: [] })).toBe(false)
  })
})
