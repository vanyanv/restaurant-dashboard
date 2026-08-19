import { z } from "zod"
import type { ChatTool } from "./types"

/**
 * A presentation tool, not a data tool. It reads nothing and touches no
 * owner-scoped resource — `execute` echoes its input so the payload lands on
 * the message as a `tool-fileReturn` part, which is what the client renders
 * the Answer Block from.
 *
 * See `docs/superpowers/specs/2026-08-19-chat-answer-block-design.md`.
 */

/** The department stamped on the return's head, and the one signal that puts
 * the block into its empty form. */
export const RETURN_DEPARTMENTS = [
  "Sales",
  "Costs",
  "Menu",
  "Forecast",
  "Inventory",
  "Orders",
  "No data",
] as const

const figureSchema = z
  .object({
    value: z
      .string()
      .min(1)
      .max(24)
      .describe(
        'The number, already formatted the way it should read: "$48,912", "1,204", "66.2%". Never a bare float.',
      ),
    label: z
      .string()
      .min(1)
      .max(28)
      .describe('What the number is, in two or three words: "Net sales", "Avg ticket", "Food cost".'),
    delta: z
      .string()
      .max(16)
      .optional()
      .describe('Change against the comparison period, formatted: "+6.4%", "-1.8pt", "+3".'),
    direction: z
      .enum(["up", "down"])
      .optional()
      .describe(
        'Whether the delta is good or bad for the owner, NOT its arithmetic sign. Produce spend rising 14% is "down" because paying more is worse. Sales rising is "up". Omit when the delta carries no judgement.',
      ),
  })
  .strict()

const parameters = z
  .object({
    verdict: z
      .string()
      .min(1)
      .max(160)
      .describe(
        "One sentence that answers the question, leading with the answer. This is set large at the top of the block, so keep it under about twenty words and let the figures carry the numbers.",
      ),
    department: z
      .enum(RETURN_DEPARTMENTS)
      .describe(
        'Which desk the answer came from. Use "No data" when the question is out of scope or nothing could be grounded — that renders the refusal form.',
      ),
    scope: z
      .string()
      .max(80)
      .optional()
      .describe('What the answer covers: "Hollywood · Aug 11 – 17", "3 stores · Mar 2026".'),
    figures: z
      .array(figureSchema)
      .max(3)
      .describe(
        "The one to three numbers the answer turns on, most important first. File one figure for a single-fact question and none at all when the department is No data.",
      ),
  })
  .strict()

export type FileReturnInput = z.infer<typeof parameters>

export const fileReturn: ChatTool<typeof parameters, FileReturnInput> = {
  name: "fileReturn",
  description:
    "File the answer for display. Call this exactly once per turn, after the data tools have returned and before writing your paragraph. It renders the headline verdict and the figure strip at the top of your answer, so the numbers you pass here are the ones the owner reads first. Every value must come from a tool result in this same turn.",
  parameters,
  // Presentation only: the input IS the result. No ctx use, no data access.
  async execute(args) {
    return args
  },
}
