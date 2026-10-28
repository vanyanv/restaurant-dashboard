/**
 * WHEN A TURN IS DONE: the answer is filed and written.
 *
 * A turn used to take three model calls in a row, each re-reading the whole
 * prompt: one to call the data tools, one to call `fileReturn`, and one more
 * to write the paragraph under it. The prompt now asks for the paragraph and
 * `fileReturn` in the same response, and this stops the loop as soon as a step
 * carries both, which removes the third call.
 *
 * Both, not either. A step that filed the return but wrote no text still gets
 * the next step, so a model that ignores the instruction costs the turn what
 * it always cost and nothing more. And text alone is not a stop either: the
 * SDK already ends a step that calls no tool, which is the normal finish for a
 * clarifying question or a reply after a refusal.
 */

const FILE_RETURN_TOOL = "fileReturn"

/** The two fields of a finished step this reads, structurally. */
export interface StopStep {
  text: string
  toolCalls: ReadonlyArray<{ toolName: string }>
}

export function answerFiledAndWritten({ steps }: { steps: ReadonlyArray<StopStep> }): boolean {
  const last = steps[steps.length - 1]
  if (!last) return false
  return (
    last.text.trim().length > 0 &&
    last.toolCalls.some((c) => c.toolName === FILE_RETURN_TOOL)
  )
}
