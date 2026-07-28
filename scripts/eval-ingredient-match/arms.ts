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

/** Shared shortlist size for stored candidates — both vector search (LIMIT)
 * and the token-overlap arm (slice after scoring) cap at this so ArmResult's
 * `candidates` field means the same thing across arms. Exported for
 * token-overlap-arm.ts. */
export const SHORTLIST_FOR_STORAGE = 10

/** Sort candidates by score desc and derive (topScore, margin) once, shared
 * across all arms (including token-overlap-arm.ts) so ArmResult's
 * descriptive fields mean the same thing regardless of which arm produced
 * them.
 *
 * Secondary key: canonicalIngredientId ascending. Score ties are common on
 * the token-overlap arm (Jaccard is a coarse fraction — many pantry rows
 * land on exactly the same score), and without a deterministic tie-break the
 * winner among tied top candidates was whatever order Postgres happened to
 * return the pantry rows in, which is not guaranteed stable run-to-run. This
 * makes "which candidate wins a tie" a pure function of the stored data. */
export function rankedTopAndMargin(candidates: MatchCandidate[]): { sorted: MatchCandidate[]; topScore: number; margin: number } {
  const sorted = [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.canonicalIngredientId < b.canonicalIngredientId ? -1 : a.canonicalIngredientId > b.canonicalIngredientId ? 1 : 0
  })
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

/** Shared by both vector arms — the only thing that differs between
 * `vector-only` and `vector-productname-only` is which text gets embedded
 * per case. Search, classification, and ArmResult shape are identical. */
async function resolveViaVectorSearch(
  cases: GoldCase[],
  ctx: ArmContext,
  textFor: (c: GoldCase) => string,
): Promise<ArmResult[]> {
  const texts = cases.map(textFor)
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
}

export const vectorOnlyArm: Arm = {
  name: "vector-only",
  resolve(cases, ctx) {
    return resolveViaVectorSearch(cases, ctx, (c) =>
      buildMatchQueryText({ productName: c.productName, vendorName: c.vendorName, unit: c.unit }),
    )
  },
}

// ---------------------------------------------------------------------------
// Arm: vector-productname-only
// ---------------------------------------------------------------------------
//
// Diagnostic arm, not a candidate for shipping on its own. `buildMatchQueryText`
// (frozen, Task 2) joins productName | vendorName | unit into the embedded
// query text, but the stored document per pantry row is `name [category] ·
// aliases: …` — vendor and unit tokens never appear in any document. On short
// strings that's a plausible reason cosine scores run low. This arm changes
// exactly one thing versus vector-only: the query text is productName alone,
// built locally here (buildMatchQueryText itself is not touched). Everything
// else — pantry search, classification, sweep — is identical.

export const vectorProductNameOnlyArm: Arm = {
  name: "vector-productname-only",
  resolve(cases, ctx) {
    return resolveViaVectorSearch(cases, ctx, (c) => c.productName.trim())
  },
}

// tokenOverlapArm lives in ./token-overlap-arm.ts — split out to keep this
// file under the 400-line limit, and because it's a self-contained frozen
// baseline (see the header comment there) that doesn't share any code with
// the vector arms above besides rankedTopAndMargin/SHORTLIST_FOR_STORAGE,
// both exported from here for that purpose. Not re-exported from this file
// (that would create a module cycle) — import it directly from
// "./token-overlap-arm" where needed.

// ---------------------------------------------------------------------------
// Threshold sweep
// ---------------------------------------------------------------------------

/**
 * Recompute decisions for every (HIGH, MARGIN) pair in the swept grid from
 * each case's already-captured candidate list — never re-queries or
 * re-embeds. FLOOR and LLM_ACCEPT are held at their production defaults;
 * only the auto-link gate (HIGH, MARGIN) is swept.
 *
 * HIGH: 0.72 (== FLOOR) .. 0.99 step 0.01 (28 values). The lower bound is
 * FLOOR itself, not an arbitrary cutoff: classifyCandidates already rejects
 * every case below FLOOR as "new" regardless of HIGH, so sweeping HIGH any
 * lower than FLOOR would be a no-op. Anchoring the sweep here means a
 * max-coverage zero-error row that lands at HIGH=0.72 is a genuine ceiling
 * (nothing scoring below the floor is even a candidate), not a grid artifact
 * — whereas a prior version of this sweep started at HIGH=0.80 and quietly
 * ignored the whole reachable [0.72, 0.80) band.
 * MARGIN: 0.00 .. 0.15 step 0.01 (16 values)
 */
export function sweepThresholds(results: ArmResult[]): ThresholdRow[] {
  const rows: ThresholdRow[] = []
  for (let hi = Math.round(THRESHOLDS.FLOOR * 100); hi <= 99; hi++) {
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
