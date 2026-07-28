/**
 * The two zero-cost matching arms for the ingredient auto-match bake-off,
 * plus the threshold sweep used to find the ship gate.
 *
 * `token-overlap` is a frozen historical baseline (see the big comment
 * below). `vector-only` is the strategy actually being evaluated for
 * shipping: embed the invoice line, cosine-search the pantry, classify with
 * the shared production scorer.
 *
 * Read-only. No writes, no migrations, no chat-completion calls — only the
 * OpenAI embeddings endpoint.
 */

import type { GoldCase } from "./gold"
import {
  classifyCandidates,
  buildMatchQueryText,
  THRESHOLDS,
  type MatchCandidate,
} from "../../src/lib/ingredient-match-scoring"
import { embedBatch, toVectorLiteral } from "../../src/lib/chat/embeddings"

export type ArmResult = {
  caseId: string
  /** Carried alongside the case so sweepThresholds / the report can score
   * correctness from ArmResult[] alone, without a second pass over GoldCase[]. */
  expectedCanonicalId: string
  decision: "auto" | "ambiguous" | "new"
  chosenCanonicalId: string | null
  /** null means "abstained" (ambiguous or new) — not scored as an error. */
  correct: boolean | null
  topScore: number
  /** top score minus runner-up score, over the *stored* candidate list. */
  margin: number
  /** Full ranked candidate list captured once, so threshold sweeps never re-query. */
  candidates: MatchCandidate[]
  reasoning?: string
  costUsd?: number
}

/** Minimal structural surface of the Prisma client this file needs — kept
 * narrow so arms.ts doesn't have to import the generated client type, and so
 * run.ts can pass the real `prisma` singleton (whose `$queryRawUnsafe`
 * returns a `PrismaPromise<T>`, itself a `Promise<T>`). */
type PrismaLike = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>
}

export type ArmContext = {
  prisma: PrismaLike
  accountId: string
}

export type Arm = {
  name: string
  resolve(cases: GoldCase[], ctx: ArmContext): Promise<ArmResult[]>
}

export type ThresholdRow = {
  high: number
  margin: number
  autoLinked: number
  correct: number
  wrong: number
  coveragePct: number
  precisionPct: number
}

const SHORTLIST_FOR_STORAGE = 10

/** Sort candidates by score desc and derive (topScore, margin) once, shared
 * by both arms so ArmResult's descriptive fields mean the same thing
 * regardless of which arm produced them. */
function rankedTopAndMargin(candidates: MatchCandidate[]): { sorted: MatchCandidate[]; topScore: number; margin: number } {
  const sorted = [...candidates].sort((a, b) => b.score - a.score)
  const topScore = sorted[0]?.score ?? 0
  const runnerUp = sorted[1]?.score ?? 0
  return { sorted, topScore, margin: topScore - runnerUp }
}

// ---------------------------------------------------------------------------
// Arm: vector-only
// ---------------------------------------------------------------------------

async function vectorSearch(ctx: ArmContext, vec: number[]): Promise<MatchCandidate[]> {
  const rows = await ctx.prisma.$queryRawUnsafe<
    Array<{ canonicalIngredientId: string; name: string; score: number }>
  >(
    `SELECT e."canonicalIngredientId", e."name",
            (1 - (e.embedding <=> $1::vector))::float8 AS score
       FROM "CanonicalIngredientEmbedding" e
      WHERE e."accountId" = $2
      ORDER BY e.embedding <=> $1::vector
      LIMIT ${SHORTLIST_FOR_STORAGE}`,
    toVectorLiteral(vec),
    ctx.accountId,
  )
  return rows.map((r) => ({
    canonicalIngredientId: r.canonicalIngredientId,
    name: r.name,
    score: r.score,
  }))
}

export const vectorOnlyArm: Arm = {
  name: "vector-only",
  async resolve(cases, ctx) {
    const texts = cases.map((c) =>
      buildMatchQueryText({ productName: c.productName, vendorName: c.vendorName, unit: c.unit }),
    )
    // embedBatch already chunks internally in groups of 100 — one call covers
    // the whole gold set regardless of size.
    const vectors = await embedBatch(texts)

    const results: ArmResult[] = []
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i]
      const candidates = await vectorSearch(ctx, vectors[i])
      const { sorted, topScore, margin } = rankedTopAndMargin(candidates)
      const classification = classifyCandidates(sorted, THRESHOLDS)

      if (classification.kind === "auto") {
        results.push({
          caseId: c.id,
          expectedCanonicalId: c.expectedCanonicalId,
          decision: "auto",
          chosenCanonicalId: classification.candidate.canonicalIngredientId,
          correct: classification.candidate.canonicalIngredientId === c.expectedCanonicalId,
          topScore,
          margin,
          candidates: sorted,
        })
      } else {
        results.push({
          caseId: c.id,
          expectedCanonicalId: c.expectedCanonicalId,
          decision: classification.kind,
          chosenCanonicalId: null,
          correct: null,
          topScore,
          margin,
          candidates: sorted,
        })
      }
    }
    return results
  },
}

// ---------------------------------------------------------------------------
// Arm: token-overlap
// ---------------------------------------------------------------------------
//
// FROZEN HISTORICAL BASELINE — deliberately duplicated, not shared-imported.
//
// This is a byte-for-byte port of the "smart suggest" scoring at
// src/app/dashboard/ingredients/components/match-picker-sheet.tsx:114-132
// (Jaccard-over-tokens, threshold 0.25), plus its `tokenSet` (line 737) and
// `prettifyIngredientName` (src/app/dashboard/recipes/components/
// ingredient-picker-utils.ts:155-215) helpers. The project owner made this
// call explicitly: this arm exists to measure what actually shipped to
// production as of 2026-07-28. If the live component's heuristic changes
// later, this eval baseline must NOT change with it — otherwise the bake-off
// stops being a comparison against a fixed status quo. Extracting a shared
// helper would also couple production UI code (a "use client" React
// component) to a plain node/tsx eval script. Do not "clean this up" into an
// import; if the production heuristic is intentionally re-baselined, copy it
// here again on purpose.

function prettifyIngredientName(raw: string): string {
  if (!raw) return raw
  let s = raw.trim()

  // Drop trailing parens (sizes, vendor SKUs, etc.) — repeat for nested cases.
  for (let i = 0; i < 3; i++) {
    const next = s.replace(/\s*\([^)]*\)\s*$/g, "").trim()
    if (next === s) break
    s = next
  }

  // Strip trailing pack/size descriptors. Run repeatedly because invoices
  // often stack ("shredded mozzarella 5 lb bag case").
  const noiseTrailing =
    /\s+(?:\d+(?:\.\d+)?\s*(?:#|ct|pk|pkt|pack|case|cs|bg|bag|bottle|btl|can|box|jar|qt|pt|gal|lb|lbs|oz|fl ?oz|kg|g|ml|l|each|ea|dz|doz|dozen|count|cnt|ctn|carton|tray|bunch|head|loaf)\b\.?)+\s*$/i
  for (let i = 0; i < 4; i++) {
    const next = s.replace(noiseTrailing, "").trim()
    if (next === s) break
    s = next
  }

  // Common embedded noise: "ct/12", "pk of 6", "x 24", standalone "case", trailing slashes.
  s = s
    .replace(/\b(ct|pk|pack|case|cs|cnt|count)[\s\/]*\d+\b/gi, "")
    .replace(/\bx\s*\d+\b/gi, "")
    .replace(/[\/\-,]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim()

  // Title case, but keep small words lowercase unless first.
  const small = new Set(["and", "or", "of", "the", "for", "to", "in", "on", "with", "a", "an"])
  s = s
    .split(" ")
    .map((word, i) => {
      if (!word) return word
      // Preserve all-caps acronyms (>=2 letters and originally uppercase).
      if (/^[A-Z]{2,}$/.test(word)) return word
      const lower = word.toLowerCase()
      if (i > 0 && small.has(lower)) return lower
      // Don't break hyphenated words apart.
      return lower
        .split("-")
        .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
        .join("-")
    })
    .join(" ")

  return s || raw
}

function tokenSet(s: string): Set<string> {
  const tokens = s
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
  // Drop common pack/size/noise words so they don't inflate overlap.
  const noise = new Set([
    "bag",
    "box",
    "case",
    "can",
    "ctn",
    "jar",
    "pack",
    "pkt",
    "cnt",
    "count",
    "carton",
    "tray",
    "bunch",
    "each",
    "dozen",
    "the",
    "and",
    "for",
    "with",
    "fresh",
    "frozen",
  ])
  return new Set(tokens.filter((t) => !noise.has(t)))
}

const TOKEN_OVERLAP_THRESHOLD = 0.25

function scoreTokenOverlap(productName: string, canonicalName: string): number {
  const productTokens = tokenSet(prettifyIngredientName(productName))
  if (productTokens.size === 0) return 0
  const nameTokens = tokenSet(canonicalName)
  if (nameTokens.size === 0) return 0
  const overlap = [...productTokens].filter((t) => nameTokens.has(t)).length
  return overlap / Math.max(productTokens.size, nameTokens.size)
}

export const tokenOverlapArm: Arm = {
  name: "token-overlap",
  async resolve(cases, ctx) {
    // Pantry name list, scoped to the account — same source table the
    // vector arm searches, just read as plain rows instead of via <=>.
    const pantry = await ctx.prisma.$queryRawUnsafe<Array<{ canonicalIngredientId: string; name: string }>>(
      `SELECT "canonicalIngredientId", "name"
         FROM "CanonicalIngredientEmbedding"
        WHERE "accountId" = $1`,
      ctx.accountId,
    )

    const results: ArmResult[] = []
    for (const c of cases) {
      const scored: MatchCandidate[] = pantry.map((p) => ({
        canonicalIngredientId: p.canonicalIngredientId,
        name: p.name,
        score: scoreTokenOverlap(c.productName, p.name),
      }))
      const { sorted, topScore, margin } = rankedTopAndMargin(scored)
      const top10 = sorted.slice(0, SHORTLIST_FOR_STORAGE)
      const winner = sorted[0]

      // Mirrors the production heuristic's own decision rule: it only ever
      // surfaces candidates with score > 0.25 as suggestions. No margin or
      // ambiguity concept exists in the shipped heuristic, so the eval
      // decision is binary: the top-scoring candidate above the bar is what
      // a user would see suggested first, or nothing clears the bar at all.
      if (winner && winner.score > TOKEN_OVERLAP_THRESHOLD) {
        results.push({
          caseId: c.id,
          expectedCanonicalId: c.expectedCanonicalId,
          decision: "auto",
          chosenCanonicalId: winner.canonicalIngredientId,
          correct: winner.canonicalIngredientId === c.expectedCanonicalId,
          topScore,
          margin,
          candidates: top10,
        })
      } else {
        results.push({
          caseId: c.id,
          expectedCanonicalId: c.expectedCanonicalId,
          decision: "new",
          chosenCanonicalId: null,
          correct: null,
          topScore,
          margin,
          candidates: top10,
        })
      }
    }
    return results
  },
}

// ---------------------------------------------------------------------------
// Threshold sweep
// ---------------------------------------------------------------------------

/**
 * Recompute decisions for every (HIGH, MARGIN) pair in the swept grid from
 * each case's already-captured candidate list — never re-queries or
 * re-embeds. FLOOR and LLM_ACCEPT are held at their production defaults;
 * only the auto-link gate (HIGH, MARGIN) is swept.
 *
 * HIGH: 0.80 .. 0.99 step 0.01 (20 values)
 * MARGIN: 0.00 .. 0.15 step 0.01 (16 values)
 */
export function sweepThresholds(results: ArmResult[]): ThresholdRow[] {
  const rows: ThresholdRow[] = []
  for (let hi = 80; hi <= 99; hi++) {
    const high = round2(hi / 100)
    for (let mi = 0; mi <= 15; mi++) {
      const margin = round2(mi / 100)
      let autoLinked = 0
      let correct = 0
      let wrong = 0
      for (const r of results) {
        const classification = classifyCandidates(r.candidates, {
          HIGH: high,
          MARGIN: margin,
          FLOOR: THRESHOLDS.FLOOR,
          LLM_ACCEPT: THRESHOLDS.LLM_ACCEPT,
        })
        if (classification.kind === "auto") {
          autoLinked++
          if (classification.candidate.canonicalIngredientId === r.expectedCanonicalId) correct++
          else wrong++
        }
      }
      const coveragePct = results.length > 0 ? (autoLinked / results.length) * 100 : 0
      const precisionPct = autoLinked > 0 ? (correct / autoLinked) * 100 : 0
      rows.push({ high, margin, autoLinked, correct, wrong, coveragePct, precisionPct })
    }
  }
  return rows
}

/** Threshold grid values are generated from integer cents (hi/100, mi/100)
 * but binary floating point still leaves artifacts like 0.9500000000000001 —
 * round to 2dp so report output and row lookups are exact. */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}
