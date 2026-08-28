// `askSteps` — the reading log an answer shows while it is being worked out.
//
// The defect this exists to prevent is not a crash. It is the surface going
// quiet: before this, `AskAnswerBody` had one static line for the whole turn,
// and measured in a browser it sat unchanged for 32.8 of 33.8 seconds while
// the surface already knew which tools had been called and which had come
// back. A step that stops advancing is indistinguishable from a broken page,
// which is exactly how it was reported.

import { describe, it, expect } from "vitest"
import { askSteps } from "@/lib/counter/ask-state"

/** A tool part in the shape the AI SDK streams. */
const part = (name: string, state: string) => ({ type: `tool-${name}`, state })

describe("askSteps", () => {
  it("is empty before the model has called anything", () => {
    // Not a failure state — the model is still choosing. `Thinking` draws its
    // own opening beat for this rather than an empty box.
    expect(askSteps([])).toEqual([])
    expect(askSteps([{ type: "text", text: "" }])).toEqual([])
  })

  it("reports a called-but-unfinished tool as reading", () => {
    // THE POINT OF THE WHOLE FILE. `toolNamesFrom` keeps only
    // `output-available` parts, because it answers what a FINISHED turn read.
    // The step the reader is actually waiting on is the one that has not
    // landed, so filtering the same way here would show an empty log for
    // precisely as long as there was something to say.
    expect(askSteps([part("getDailySales", "input-available")])).toEqual([
      { tool: "getDailySales", state: "reading" },
    ])
    expect(askSteps([part("getDailySales", "input-streaming")])).toEqual([
      { tool: "getDailySales", state: "reading" },
    ])
  })

  it("advances a tool to read when its output lands", () => {
    expect(askSteps([part("getDailySales", "output-available")])).toEqual([
      { tool: "getDailySales", state: "read" },
    ])
  })

  it("keeps the order the model worked in", () => {
    expect(
      askSteps([
        part("getDailySales", "output-available"),
        part("getPnlSummary", "input-available"),
      ]),
    ).toEqual([
      { tool: "getDailySales", state: "read" },
      { tool: "getPnlSummary", state: "reading" },
    ])
  })

  it("INCLUDES fileReturn, which the finished-turn list excludes", () => {
    // Filing reads nothing, so it is rightly absent from the "Read" row. But
    // it is a whole model round trip — roughly a third of a turn's wall clock
    // — and hiding it leaves the log looking finished while the reader waits
    // through the longest step there is.
    expect(askSteps([part("fileReturn", "input-available")])).toEqual([
      { tool: "fileReturn", state: "reading" },
    ])
  })

  it("collapses a tool called twice into one line at its furthest state", () => {
    // Two rows for one tool would read as two reads; worse, a late
    // `input-streaming` part must not un-read a tool whose output already
    // landed and make the dot go backwards.
    expect(
      askSteps([
        part("getDailySales", "input-streaming"),
        part("getDailySales", "output-available"),
      ]),
    ).toEqual([{ tool: "getDailySales", state: "read" }])

    expect(
      askSteps([
        part("getDailySales", "output-available"),
        part("getDailySales", "input-streaming"),
      ]),
    ).toEqual([{ tool: "getDailySales", state: "read" }])
  })

  it("reads a part that names its tool the other way", () => {
    // The SDK has used both `type: "tool-<name>"` and an explicit `toolName`;
    // `toolNamesFrom` accepts both and so must this, or the log empties out on
    // an SDK upgrade with nothing failing to say why.
    expect(askSteps([{ type: "tool-call", toolName: "getTopMenuItems", state: "output-available" }]))
      .toEqual([{ tool: "getTopMenuItems", state: "read" }])
  })

  it("ignores parts that are not tools", () => {
    expect(
      askSteps([
        { type: "text", text: "Gross sales were…" },
        { type: "reasoning" },
        part("getDailySales", "output-available"),
      ]),
    ).toEqual([{ tool: "getDailySales", state: "read" }])
  })

  it("survives malformed parts rather than taking the surface down", () => {
    // These arrive from the network mid-stream. A thrown error here would
    // replace a slow answer with a blank page.
    expect(
      askSteps([
        null as never,
        { type: undefined } as never,
        part("getDailySales", "output-available"),
      ]),
    ).toEqual([{ tool: "getDailySales", state: "read" }])
  })
})
