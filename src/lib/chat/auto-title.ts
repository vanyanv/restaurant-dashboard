import { CHAT_ROUTING_MODEL, getChatOpenAIClient } from "./openai-client"

/**
 * Generates a 3-6 word title from the first user/assistant turn of a
 * conversation. Returns null on any failure — the route handler treats a
 * missing title as non-fatal (the rail falls back to "Untitled").
 *
 * Plain text only: no quotes, no period, sentence case.
 */
export async function generateConversationTitle(
  firstUser: string,
  firstAssistant: string,
): Promise<string | null> {
  const userClipped = firstUser.slice(0, 600).trim()
  const assistantClipped = firstAssistant.slice(0, 600).trim()
  if (!userClipped) return null

  try {
    const client = getChatOpenAIClient()
    const completion = await client.chat.completions.create({
      model: CHAT_ROUTING_MODEL,
      temperature: 0.2,
      max_tokens: 24,
      messages: [
        {
          role: "system",
          content:
            "You write 3-6 word titles for restaurant-owner chat conversations. Plain text, no quotes, no period, sentence case. Just the title.",
        },
        {
          role: "user",
          content: `First question: ${userClipped} — first answer: ${assistantClipped}. Title:`,
        },
      ],
    })
    const raw = completion.choices[0]?.message?.content?.trim()
    if (!raw) return null
    return sanitizeTitle(raw)
  } catch (err) {
    console.error("[chat] auto-title generation failed", err)
    return null
  }
}

function sanitizeTitle(raw: string): string | null {
  let t = raw.replace(/^["'`\s]+|["'`\s.]+$/g, "").trim()
  if (!t) return null
  // Single line only.
  t = t.split(/\r?\n/)[0].trim()
  // Defensive cap so a runaway model can't store paragraph blobs.
  if (t.length > 80) t = t.slice(0, 80).trim()
  return t || null
}
