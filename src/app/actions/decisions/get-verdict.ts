import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import { generateVerdictLine } from "@/lib/decision-verdict-llm"
import {
  composeVerdict,
  verdictInputsHash,
  type VerdictFacts,
} from "@/app/dashboard/decisions/lib/verdict-copy"

/**
 * The verdict sentence for one scope on one day.
 *
 * /dashboard/decisions is server-rendered, so a naive implementation would buy
 * a completion on every page load — including every refresh after committing a
 * decision. `DecisionVerdict` keys the sentence on (scope, date) alongside the
 * hash of the facts it was written from, which bounds narration to one call per
 * scope per day, and re-costs only when a figure the page actually displays has
 * moved.
 *
 * Every failure path here degrades to the deterministic sentence rather than
 * propagating. A cache that cannot be read is a cost problem, never a reason
 * for the page to lose its masthead.
 */
export async function getVerdictLine(input: {
  facts: VerdictFacts
  storeId: string | null
  /** YYYY-MM-DD, the view's asOf. */
  asOf: string
  userId?: string | null
}): Promise<{ line: string; model: string | null }> {
  const { facts, storeId, asOf, userId } = input

  // The portfolio view has no store; see the migration note on why this is a
  // real column rather than a nullable storeId in the unique index.
  const scopeKey = storeId ?? "ALL"
  const asOfDate = new Date(`${asOf}T00:00:00Z`)
  const inputsHash = verdictInputsHash(facts)

  try {
    const cached = await prisma.decisionVerdict.findUnique({
      where: { scopeKey_asOfDate: { scopeKey, asOfDate } },
    })
    if (cached && cached.inputsHash === inputsHash) {
      return { line: cached.line, model: cached.model }
    }
  } catch (err) {
    logger.error("[decision-verdict] cache read failed:", err)
    return { line: composeVerdict(facts), model: null }
  }

  const result = await generateVerdictLine(facts, { storeId, userId })

  try {
    await prisma.decisionVerdict.upsert({
      where: { scopeKey_asOfDate: { scopeKey, asOfDate } },
      create: {
        scopeKey,
        storeId,
        asOfDate,
        inputsHash,
        line: result.line,
        model: result.model,
      },
      update: { inputsHash, line: result.line, model: result.model },
    })
  } catch (err) {
    // Worth knowing about — an un-writable cache means every view pays again —
    // but the sentence in hand is still correct, so the page gets it.
    logger.error("[decision-verdict] cache write failed:", err)
  }

  return result
}
