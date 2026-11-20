import { describe, expect, it } from "vitest"
import { chatModelFor, isReasoningModel } from "@/lib/chat/openai-client"

describe("chatModelFor", () => {
  it("answers Quick on gpt-4.1 with no reasoning effort", () => {
    expect(chatModelFor("quick")).toEqual({ model: "gpt-4.1", reasoningEffort: null })
    expect(chatModelFor(undefined)).toEqual(chatModelFor("quick"))
  })

  it("answers Careful on gpt-5-mini at medium effort", () => {
    expect(chatModelFor("careful")).toEqual({ model: "gpt-5-mini", reasoningEffort: "medium" })
  })
})

describe("isReasoningModel", () => {
  it("tells the reasoning families apart", () => {
    expect(isReasoningModel("gpt-5-mini")).toBe(true)
    expect(isReasoningModel("o4-mini")).toBe(true)
    expect(isReasoningModel("gpt-4.1")).toBe(false)
    expect(isReasoningModel("gpt-4.1-mini")).toBe(false)
  })
})
