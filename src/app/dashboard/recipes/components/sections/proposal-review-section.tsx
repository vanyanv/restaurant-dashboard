import { listMappingProposals } from "@/app/actions/mapping-proposal-actions"
import { previewRecipeCost } from "@/app/actions/recipe-actions"
import { ProposalReviewLauncher, type ProposalView } from "../proposal-review-launcher"

/**
 * Streams the "AI proposals" topbar slot: pending RecipeMappingProposal rows
 * with a live per-proposal cost preview (component recipes / ingredients are
 * costed through the same walk the recipe builder uses). Wrapped in its own
 * Suspense boundary in the shell so proposal costing never blocks the editor.
 */
export async function ProposalReviewSection() {
  const proposals = await listMappingProposals()

  const views: ProposalView[] = await Promise.all(
    proposals.map(async (p) => {
      const ingredients =
        p.kind === "MATCH" && p.proposedRecipeId
          ? [
              {
                componentRecipeId: p.proposedRecipeId,
                quantity: 1,
                unit: "each",
                ingredientName: p.proposedRecipeName,
              },
            ]
          : p.payload.components.map((c) => ({
              componentRecipeId: c.componentRecipeId ?? null,
              canonicalIngredientId: c.canonicalIngredientId ?? null,
              quantity: c.quantity,
              unit: c.unit,
              ingredientName: c.name,
            }))
      const cost = await previewRecipeCost({ ingredients }).catch(() => null)
      return {
        id: p.id,
        otterItemName: p.otterItemName,
        category: p.category,
        kind: p.kind,
        confidence: p.confidence,
        reasoning: p.payload.reasoning,
        proposedRecipeName: p.proposedRecipeName,
        components: p.payload.components.map((c) => ({
          name: c.name,
          quantity: c.quantity,
          unit: c.unit,
          isRecipe: Boolean(c.componentRecipeId),
        })),
        estimatedCost: cost && cost.totalCost > 0 ? cost.totalCost : null,
        costIsPartial: cost?.partial ?? true,
      }
    })
  )

  return <ProposalReviewLauncher proposals={views} />
}

/** Keeps the topbar footprint stable while proposals stream in. */
export function ProposalReviewFallback() {
  return (
    <span
      aria-hidden
      className="inline-flex h-8 items-center gap-1.5 border border-[var(--hairline)] bg-[var(--paper)] px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)]"
    >
      AI proposals
    </span>
  )
}
