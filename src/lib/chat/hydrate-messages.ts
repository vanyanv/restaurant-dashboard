import type { UIMessage } from "ai"

/**
 * Reconstructs `UIMessage[]` from saved conversation rows so reloaded
 * threads render their inline cards (TrendCard, InvoiceCard, ...) the same
 * way live streaming does. Without this, only the prose survives a reload
 * and `<ChatArtifacts>` renders nothing because no part has
 * `state === "output-available"`.
 */
export interface SavedToolCall {
  id: string
  toolName: string
  args: unknown
  result: unknown
}

export interface SavedMessage {
  id: string
  role: string
  content: string
  toolCalls?: SavedToolCall[]
}

export function hydrateConversationMessages(
  rawMessages: SavedMessage[],
): UIMessage[] {
  const out: UIMessage[] = []
  for (const m of rawMessages) {
    if (m.role !== "user" && m.role !== "assistant") continue
    const parts: UIMessage["parts"] = []
    if (m.content && m.content.length > 0) {
      parts.push({ type: "text", text: m.content })
    }
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      for (const tc of m.toolCalls) {
        parts.push({
          type: `tool-${tc.toolName}`,
          toolName: tc.toolName,
          toolCallId: tc.id,
          state: "output-available",
          input: tc.args,
          output: tc.result,
        } as unknown as UIMessage["parts"][number])
      }
    }
    out.push({
      id: m.id,
      role: m.role,
      parts,
    } as UIMessage)
  }
  return out
}
