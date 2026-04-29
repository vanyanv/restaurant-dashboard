/**
 * Parses the Vercel AI SDK v6 UI-message stream produced by
 * `result.toUIMessageStreamResponse()`.
 *
 * Wire format: SSE — each event is `data: <json>\n\n`, terminated by
 * `data: [DONE]\n\n`. The JSON is one of the chunk shapes defined in
 * `ai/dist/index.d.ts` (UIMessageChunk).
 *
 * We don't use any AI SDK helpers here on purpose — the harness is an
 * outside-the-app HTTP client, so we mirror what the Network tab sees.
 */

export interface ToolCallRecord {
  toolCallId: string
  toolName: string
  input: unknown
  output?: unknown
  error?: string
}

export interface StreamResult {
  finalText: string
  toolCalls: ToolCallRecord[]
  errors: string[]
}

export async function parseUIMessageStream(
  body: ReadableStream<Uint8Array>,
): Promise<StreamResult> {
  const reader = body.getReader()
  const decoder = new TextDecoder("utf-8")

  // Per-text-id buffers — text chunks are split across `text-start` /
  // `text-delta` / `text-end` events. There can be multiple parallel
  // text streams in a single response (one per assistant turn step).
  const texts = new Map<string, string>()
  const toolsById = new Map<string, ToolCallRecord>()
  const errors: string[] = []

  let buffer = ""
  let done = false
  while (!done) {
    const { value, done: isDone } = await reader.read()
    done = isDone
    if (value) buffer += decoder.decode(value, { stream: !done })

    // SSE events are separated by a blank line (`\n\n`). Hold back the
    // last (possibly partial) event until the next read.
    let sep: number
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      handleEvent(rawEvent)
    }
  }
  // Flush any tail without trailing `\n\n` (rare, but defensive).
  if (buffer.trim()) handleEvent(buffer)

  // Concatenate text streams in insertion order. Map preserves it.
  let finalText = ""
  for (const t of texts.values()) finalText += t

  return {
    finalText: finalText.trim(),
    toolCalls: [...toolsById.values()],
    errors,
  }

  function handleEvent(raw: string) {
    // An event can be multiple `data:` lines; concatenate per SSE spec.
    const dataLines = raw
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
    if (dataLines.length === 0) return
    const payload = dataLines.join("\n")
    if (payload === "[DONE]") return

    let chunk: { type: string; [k: string]: unknown }
    try {
      chunk = JSON.parse(payload)
    } catch {
      errors.push(`Malformed SSE payload: ${payload.slice(0, 120)}`)
      return
    }

    switch (chunk.type) {
      case "text-start":
        if (typeof chunk.id === "string") texts.set(chunk.id, "")
        break
      case "text-delta":
        if (typeof chunk.id === "string" && typeof chunk.delta === "string") {
          texts.set(chunk.id, (texts.get(chunk.id) ?? "") + chunk.delta)
        }
        break
      case "text-end":
        // No-op; content already accumulated in deltas.
        break
      case "tool-input-available": {
        const id = chunk.toolCallId as string
        toolsById.set(id, {
          toolCallId: id,
          toolName: chunk.toolName as string,
          input: chunk.input,
        })
        break
      }
      case "tool-output-available": {
        const id = chunk.toolCallId as string
        const existing = toolsById.get(id)
        if (existing) existing.output = chunk.output
        else
          toolsById.set(id, {
            toolCallId: id,
            toolName: "(unknown)",
            input: undefined,
            output: chunk.output,
          })
        break
      }
      case "tool-output-error":
      case "tool-input-error": {
        const id = chunk.toolCallId as string
        const existing = toolsById.get(id)
        const errorText = (chunk.errorText as string) ?? "(no message)"
        if (existing) existing.error = errorText
        else
          toolsById.set(id, {
            toolCallId: id,
            toolName: (chunk.toolName as string) ?? "(unknown)",
            input: chunk.input,
            error: errorText,
          })
        break
      }
      case "error":
        errors.push((chunk.errorText as string) ?? JSON.stringify(chunk))
        break
      // start, finish, finish-step, reasoning-*, source-*, file, data-*, etc. — ignored.
    }
  }
}
