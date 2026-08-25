"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Sparkles } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  acceptMappingProposal,
  generateMappingProposals,
  rejectMappingProposal,
} from "@/app/actions/mapping-proposal-actions"

export type ProposalView = {
  id: string
  otterItemName: string
  category: string
  kind: string
  confidence: number | null
  reasoning: string
  proposedRecipeName: string | null
  components: Array<{ name: string; quantity: number; unit: string; isRecipe: boolean }>
  estimatedCost: number | null
  costIsPartial: boolean
}

const KIND_LABEL: Record<string, string> = {
  MATCH: "Same item, new spelling",
  COMBO_DECOMPOSITION: "Combo of existing recipes",
  NEW_RECIPE: "New recipe draft",
}

/**
 * Topbar slot: "AI proposals (N)" opens the review sheet; "Suggest fixes"
 * asks the model for proposals on currently-unmapped items. Accept writes the
 * mapping (and recipe, for combos) in one transaction server-side — the click
 * is the confirmation. Neutral ink throughout; red only on failure.
 */
export function ProposalReviewLauncher({ proposals }: { proposals: ProposalView[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function handleGenerate() {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      const result = await generateMappingProposals({})
      if (!result.ok) {
        setError("Could not generate proposals — try again.")
        return
      }
      setNotice(
        result.created > 0
          ? `${result.created} new proposal${result.created === 1 ? "" : "s"} drafted.`
          : "Nothing new to propose — every sold item is mapped or already queued."
      )
      router.refresh()
    })
  }

  function handleDecision(id: string, decision: "accept" | "reject") {
    setError(null)
    setBusyId(id)
    startTransition(async () => {
      const result =
        decision === "accept"
          ? await acceptMappingProposal(id)
          : await rejectMappingProposal(id)
      setBusyId(null)
      if (!result.ok) {
        setError("That didn't go through — refresh and try again.")
        return
      }
      if (decision === "accept") {
        setNotice("Mapped. COGS history updates on the overnight sweep.")
      }
      router.refresh()
    })
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 border border-[var(--hairline-bold)] bg-[var(--paper)] px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-muted)] transition hover:border-[var(--ink)] hover:text-[var(--ink)]"
        >
          <Sparkles className="h-3 w-3" />
          AI proposals
          {proposals.length > 0 && (
            <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center bg-[var(--accent)] px-1 text-[9px] text-(--paper)">
              {proposals.length}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto border-l border-[var(--hairline-bold)] bg-[var(--paper)] sm:max-w-md"
      >
        <SheetHeader className="border-b border-[var(--hairline)] pb-3">
          <SheetTitle className="font-display text-[20px] italic tracking-[-0.02em] text-[var(--ink)]">
            AI Mapping Proposals
          </SheetTitle>
          <SheetDescription className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">
            Nothing is written until you accept
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-6">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={pending}
            className="inline-flex h-9 items-center justify-center gap-1.5 border border-[var(--hairline-bold)] bg-[var(--paper)] px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink)] transition hover:border-[var(--ink)] disabled:opacity-50"
          >
            <Sparkles className="h-3 w-3" />
            {pending ? "Working…" : "Suggest fixes for unmapped items"}
          </button>

          {notice && (
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">
              {notice}
            </p>
          )}
          {error && (
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--accent)]">
              {error}
            </p>
          )}

          {proposals.length === 0 && !notice && (
            <p className="pt-2 text-[13px] leading-relaxed text-[var(--ink-muted)]">
              No pending proposals. When a new combo or renamed item starts
              selling without a recipe, draft fixes here instead of leaving its
              food cost at $0.
            </p>
          )}

          {proposals.map((p) => (
            <article
              key={p.id}
              className="border border-[var(--hairline-bold)] bg-[rgba(255,253,247,0.72)] p-4"
            >
              <header className="flex items-baseline justify-between gap-2">
                <h3 className="text-[15px] font-semibold text-[var(--ink)]">
                  {p.otterItemName}
                </h3>
                {p.estimatedCost != null && (
                  <span
                    className="text-[13px] font-semibold text-[var(--ink)]"
                    style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
                  >
                    ${p.estimatedCost.toFixed(2)}
                    {p.costIsPartial ? "*" : ""}
                  </span>
                )}
              </header>
              <p className="mt-0.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                {KIND_LABEL[p.kind] ?? p.kind}
                {p.confidence != null && ` · conf ${(p.confidence * 100).toFixed(0)}%`}
              </p>

              {p.kind === "MATCH" && p.proposedRecipeName ? (
                <p className="mt-2 text-[13px] text-[var(--ink)]">
                  Map to <span className="font-semibold">{p.proposedRecipeName}</span>
                </p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1 border-t border-dashed border-[var(--hairline)] pt-2">
                  {p.components.map((c, i) => (
                    <li
                      key={i}
                      className="flex items-baseline justify-between text-[12.5px] text-[var(--ink)]"
                    >
                      <span>
                        {c.name}
                        {c.isRecipe && (
                          <span className="ml-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                            recipe
                          </span>
                        )}
                      </span>
                      <span
                        className="text-[var(--ink-muted)]"
                        style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
                      >
                        {c.quantity} {c.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {p.reasoning && (
                <p className="mt-2 text-[12px] italic leading-snug text-[var(--ink-muted)]">
                  {p.reasoning}
                </p>
              )}

              <footer className="mt-3 flex gap-2 border-t border-[var(--hairline)] pt-3">
                <button
                  type="button"
                  onClick={() => handleDecision(p.id, "accept")}
                  disabled={pending}
                  className="inline-flex h-8 flex-1 items-center justify-center border border-[var(--ink)] bg-[var(--ink)] px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--paper)] transition hover:opacity-85 disabled:opacity-50"
                >
                  {busyId === p.id ? "Applying…" : "Accept"}
                </button>
                <button
                  type="button"
                  onClick={() => handleDecision(p.id, "reject")}
                  disabled={pending}
                  className="inline-flex h-8 items-center justify-center border border-[var(--hairline-bold)] bg-[var(--paper)] px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-muted)] transition hover:border-[var(--ink)] hover:text-[var(--ink)] disabled:opacity-50"
                >
                  Reject
                </button>
              </footer>
            </article>
          ))}

          {proposals.some((p) => p.estimatedCost != null && p.costIsPartial) && (
            <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
              * some components not yet costed — total is an understatement
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
