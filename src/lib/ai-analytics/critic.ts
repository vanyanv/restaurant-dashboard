import { criticReview, OPENAI_CRITIC_MODEL, type OpenAIUsage } from "@/lib/openai-insights"
import type { AiInsightSeverity } from "@/generated/prisma/client"

/**
 * Critic LLM pass. Sits between the generator and the database. The critic
 * reads each candidate insight and the source data it was derived from, and
 * answers three questions per insight:
 *
 *   1. Is the insight supported by the source data?
 *   2. Is the recommendation actionable for a small restaurant operator?
 *   3. Is the impact material — i.e. >= the per-route materiality threshold?
 *
 * The critic returns a verdict (KEEP / REWRITE / DROP) per insight along with
 * a severity tag and the rewritten body if applicable. Anything DROPped is
 * removed before persistence; REWRITTEN insights replace the original text;
 * KEEP passes through unchanged.
 *
 * The critic uses `llama-3.3-70b-versatile` (Groq) for stronger reasoning than
 * the 8B generator. It does NOT see the memory / prior-insights context — its
 * job is point-in-time review of the candidate set, not historical reasoning.
 */

export interface CandidateInsight {
  headline: string
  body: string
  /** Optional impact estimate provided by the generator. Critic may rewrite. */
  impactDollars?: number
  /** Free-form generator-provided severity hint. Critic may override. */
  severityHint?: string
}

export type CriticVerdict = "KEEP" | "REWRITE" | "DROP"

export interface ReviewedInsight {
  headline: string
  body: string
  severity: AiInsightSeverity
  impactDollars: number | null
  verdict: CriticVerdict
  /** Reason the critic gave for DROP/REWRITE; null for KEEP. */
  reason: string | null
}

export interface CriticPassResult {
  reviewed: ReviewedInsight[]
  droppedCount: number
  usage: OpenAIUsage
  modelUsed: string
}

interface CriticPassOpts {
  candidates: CandidateInsight[]
  /** Stringified source data summary the generator was given. Critic uses
   * this verbatim to verify support — keep it tight (a few hundred lines max). */
  sourceDataSummary: string
  /** Minimum $ impact below which qualitative-only insights are dropped.
   * Set to 0 for routes where qualitative observations are intentionally
   * surfaced (e.g. Overview narrative). */
  materialityThresholdDollars: number
  /** Route name shown to the critic for context (e.g. "SALES"). */
  routeLabel: string
}

interface RawCriticResponse {
  insights: Array<{
    index?: number
    verdict?: string
    severity?: string
    headline?: string
    body?: string
    impactDollars?: number | null
    reason?: string | null
  }>
}

const SEVERITY_VALUES: AiInsightSeverity[] = ["INFO", "WATCH", "ALERT"]

function normalizeSeverity(value: string | undefined): AiInsightSeverity {
  if (!value) return "INFO"
  const upper = value.toUpperCase()
  if (SEVERITY_VALUES.includes(upper as AiInsightSeverity)) {
    return upper as AiInsightSeverity
  }
  return "INFO"
}

function normalizeVerdict(value: string | undefined): CriticVerdict {
  if (!value) return "DROP"
  const upper = value.toUpperCase()
  if (upper === "KEEP" || upper === "REWRITE" || upper === "DROP") return upper
  return "DROP"
}

const SYSTEM_PROMPT = `You are a critical reviewer of AI-generated operational insights for a small slider/burger restaurant. You receive a candidate set of insights and the source data they came from. Your job is to filter and refine the set so the operator only sees insights that are (a) supported by the data, (b) actionable, and (c) materially worth their attention.

For each insight return one of three verdicts:
  - KEEP: insight is supported, actionable, and material. Do not rewrite.
  - REWRITE: the underlying observation is correct but the wording is vague, exaggerated, or buries the action. Provide a corrected headline and body.
  - DROP: insight is unsupported by the data, immaterial (impact below threshold for routes that have one), or not actionable.

You also assign a severity tag:
  - INFO: notable but not urgent.
  - WATCH: trend worth monitoring; may become material if it continues.
  - ALERT: requires action this week.

Output STRICT JSON in this shape:
{
  "insights": [
    { "index": 0, "verdict": "KEEP" | "REWRITE" | "DROP",
      "severity": "INFO" | "WATCH" | "ALERT",
      "headline": "(REWRITE only)", "body": "(REWRITE only)",
      "impactDollars": <number or null>,
      "reason": "(DROP/REWRITE only)" }
  ]
}

Be ruthless. It is better to drop a borderline insight than to ship noise.`

export async function runCriticPass(opts: CriticPassOpts): Promise<CriticPassResult> {
  if (opts.candidates.length === 0) {
    return {
      reviewed: [],
      droppedCount: 0,
      usage: { promptTokens: 0, completionTokens: 0 },
      modelUsed: OPENAI_CRITIC_MODEL,
    }
  }

  const userPrompt = [
    `Route: ${opts.routeLabel}`,
    `Materiality threshold: $${opts.materialityThresholdDollars}`,
    "",
    "## Source data summary (the only data the generator was given)",
    opts.sourceDataSummary,
    "",
    "## Candidate insights",
    JSON.stringify(
      opts.candidates.map((c, i) => ({
        index: i,
        headline: c.headline,
        body: c.body,
        impactDollars: c.impactDollars ?? null,
        severityHint: c.severityHint ?? null,
      })),
      null,
      2,
    ),
  ].join("\n")

  const result = await criticReview<RawCriticResponse>({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    temperature: 0.2,
    maxTokens: 2500,
  })

  const reviewed: ReviewedInsight[] = []
  let dropped = 0

  for (const raw of result.data.insights ?? []) {
    const idx = typeof raw.index === "number" ? raw.index : -1
    const candidate = idx >= 0 && idx < opts.candidates.length ? opts.candidates[idx] : null
    if (!candidate) {
      dropped += 1
      continue
    }

    const verdict = normalizeVerdict(raw.verdict)
    if (verdict === "DROP") {
      dropped += 1
      continue
    }

    const severity = normalizeSeverity(raw.severity)
    const headline =
      verdict === "REWRITE" && raw.headline ? raw.headline.trim() : candidate.headline
    const body = verdict === "REWRITE" && raw.body ? raw.body.trim() : candidate.body
    const impactDollars =
      typeof raw.impactDollars === "number"
        ? raw.impactDollars
        : candidate.impactDollars ?? null

    reviewed.push({
      headline,
      body,
      severity,
      impactDollars,
      verdict,
      reason: raw.reason ?? null,
    })
  }

  // Any candidate the critic forgot to mention is treated as a DROP.
  if (reviewed.length + dropped < opts.candidates.length) {
    dropped += opts.candidates.length - (reviewed.length + dropped)
  }

  return {
    reviewed,
    droppedCount: dropped,
    usage: result.usage,
    modelUsed: OPENAI_CRITIC_MODEL,
  }
}
