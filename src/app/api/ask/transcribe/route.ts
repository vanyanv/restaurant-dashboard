import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { rateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit"
import { getChatOpenAIClient } from "@/lib/chat/openai-client"
import { PRICING_PER_MINUTE, recordAiUsage } from "@/lib/monitoring/ai-usage"
import { logger } from "@/lib/logger"
import { checkDailyBudget } from "@/lib/chat/spend-cap"

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
 *
 * The cost is never taken from the client. The form's `seconds` field is the
 * browser's own claim and is ignored: the duration comes from OpenAI's usage
 * block when it reports one (`type: "duration"`); when it reports tokens
 * instead, the tokens are recorded and priced by the token table, which
 * fails loudly for this model until its token price is entered (see
 * `computeCostUsd`). And the daily AI cap is checked BEFORE the call, as the
 * chat route does — a spoken question is spend like a typed one.
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

  const budget = await checkDailyBudget(session.user.accountId)
  if (budget.overBudget) {
    logger.warn(
      `[ask-transcribe] accountId=${session.user.accountId} over daily AI budget ` +
        `spent=${budget.spentUsd} budget=${budget.budgetUsd}`,
    )
    return NextResponse.json(
      {
        error:
          `This account has reached its daily AI limit of $${budget.budgetUsd.toFixed(2)}. ` +
          `The mic works again after midnight; you can still type the question.`,
      },
      { status: 429, headers: { "Retry-After": "3600" } },
    )
  }

  const started = Date.now()
  try {
    // `json`, not `text`: only the object form carries the usage block the
    // cost is read from.
    const result = await getChatOpenAIClient().audio.transcriptions.create({
      file: audio,
      model: MODEL,
      response_format: "json",
    })
    const text = (result.text ?? "").trim()
    await recordAiUsage({
      feature: "ask-transcribe",
      provider: "openai",
      model: MODEL,
      userId: session.user.id,
      durationMs: Date.now() - started,
      ...transcriptionCost(result.usage),
    })
    return NextResponse.json({ text })
  } catch (err) {
    logger.error("[ask-transcribe] failed", err)
    return NextResponse.json({ error: "The recording could not be transcribed" }, { status: 502 })
  }
}

type TranscriptionUsage =
  | { type: "duration"; seconds: number }
  | { type: "tokens"; input_tokens: number; output_tokens: number }
  | undefined

/**
 * What a transcription cost, from OpenAI's own usage block — never from the
 * client. A duration is priced per minute; a token count is recorded as
 * tokens and priced by `computeCostUsd`, which books an unpriced model at the
 * dearest known rate and says so rather than recording $0.
 */
function transcriptionCost(usage: TranscriptionUsage | { type?: string }): {
  inputTokens: number
  outputTokens: number
  costUsd?: number
} {
  const u = usage as TranscriptionUsage
  if (u?.type === "duration" && Number.isFinite(u.seconds) && u.seconds >= 0) {
    return { inputTokens: 0, outputTokens: 0, costUsd: (u.seconds / 60) * PRICING_PER_MINUTE[MODEL] }
  }
  if (u?.type === "tokens") {
    return { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0 }
  }
  logger.error(
    `[ask-transcribe] no usage block on the response; recording it unpriced so it is visible`,
  )
  return { inputTokens: 0, outputTokens: 0 }
}
