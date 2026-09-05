import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { rateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit"
import { getChatOpenAIClient } from "@/lib/chat/openai-client"
import { PRICING_PER_MINUTE, recordAiUsage } from "@/lib/monitoring/ai-usage"
import { logger } from "@/lib/logger"

/**
 * POST /api/ask/transcribe — the composer's mic.
 *
 * Hold the mic, speak, let go: the browser's `MediaRecorder` blob arrives
 * here as multipart `audio`, OpenAI's `gpt-4o-mini-transcribe` turns it into
 * text, and the text goes back to the field — NOT sent. The reader reads
 * what the mic heard and presses send themselves; a mis-heard "Van Nuys"
 * should not become a question the model answers.
 *
 * Server-side rather than the browser's own speech API because the phone is
 * the place a ten-word question gets spoken, and on iOS every browser is
 * WebKit — Web Speech is Safari-only there, and only after a language pack
 * has been fetched. One route works everywhere the composer does.
 *
 * Priced per minute (`PRICING_PER_MINUTE`), and recorded as its own feature
 * so the monitoring page can tell a spoken question from a typed one.
 */
export const maxDuration = 60

const MODEL = "gpt-4o-mini-transcribe"
const MAX_BYTES = 8 * 1024 * 1024

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 })
  const limited = await rateLimit(req, RATE_LIMIT_TIERS.moderate)
  if (limited) return limited

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: "Expected multipart audio" }, { status: 400 })
  }
  const audio = form.get("audio")
  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ error: "No audio" }, { status: 400 })
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json({ error: "That recording is too long" }, { status: 413 })
  }
  // The recorder reports its own duration in the form; the price is per
  // minute and the blob's byte length says nothing reliable about seconds.
  const seconds = Number(form.get("seconds") ?? 0)

  const started = Date.now()
  try {
    const result = await getChatOpenAIClient().audio.transcriptions.create({
      file: audio,
      model: MODEL,
      response_format: "text",
    })
    // `response_format: "text"` types the result as a string; the object
    // form is kept for the day the format changes.
    const text = (
      typeof result === "string" ? result : ((result as { text?: string }).text ?? "")
    ).trim()
    const minutes = Number.isFinite(seconds) && seconds > 0 ? seconds / 60 : 0
    await recordAiUsage({
      feature: "ask-transcribe",
      provider: "openai",
      model: MODEL,
      inputTokens: 0,
      outputTokens: 0,
      userId: session.user.id,
      durationMs: Date.now() - started,
      costUsd: minutes * PRICING_PER_MINUTE[MODEL],
    })
    return NextResponse.json({ text })
  } catch (err) {
    logger.error("[ask-transcribe] failed", err)
    return NextResponse.json({ error: "The recording could not be transcribed" }, { status: 502 })
  }
}
