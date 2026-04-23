import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { SectionErrorBoundary } from "@/components/analytics/section-error"
import { RecipeEditorSection } from "./sections/recipe-editor-section"
import {
  UnmatchedCountFallback,
  UnmatchedCountSection,
} from "./sections/unmatched-count-section"

/**
 * Suspense shell for the Recipes page. Renders instantly with a proportional
 * skeleton where the editor will land, and streams each data-dependent slice
 * behind its own error boundary.
 *
 * Two Suspense boundaries:
 *   1. Unmatched-line-items count badge in the editorial topbar — tiny,
 *      streamed independently so the invoice scan never blocks the editor.
 *   2. The two-pane editor (menu items list + recipe canvas) — awaits menu
 *      items, recipes, and canonical ingredients in parallel and mounts the
 *      client `RecipesContent`.
 *
 * The two visible panes share client state inside `RecipesContent` (selected
 * item, open editor, drag/drop, dialog state), so they are streamed as one
 * unit rather than as two independent Suspense boundaries.
 */
export function RecipesShell() {
  const unmatchedCountSlot = (
    <SectionErrorBoundary label="Count unavailable">
      <Suspense fallback={<UnmatchedCountFallback />}>
        <UnmatchedCountSection />
      </Suspense>
    </SectionErrorBoundary>
  )

  return (
    <SectionErrorBoundary label="Recipes editor unavailable">
      <Suspense fallback={<RecipesEditorSkeleton />}>
        <RecipeEditorSection unmatchedCountSlot={unmatchedCountSlot} />
      </Suspense>
    </SectionErrorBoundary>
  )
}

/**
 * Proportional skeleton for the recipes shell: mirrors the final
 * editorial-topbar + two-pane grid layout so the editor mounts without CLS.
 */
function RecipesEditorSkeleton() {
  return (
    <div className="editorial-surface relative flex min-h-[calc(100vh-3.5rem)] flex-col">
      <header className="editorial-topbar">
        <div className="editorial-topbar-rule" aria-hidden="true" />
        <div className="editorial-topbar-inner">
          <span className="editorial-section-label">§ 10</span>
          <span className="font-display text-[18px] italic leading-none tracking-[-0.02em] text-[var(--ink-faint)]">
            Recipes
          </span>
        </div>
      </header>

      <div className="grid h-[calc(100vh-3.5rem)] grid-cols-[280px_1fr] overflow-hidden">
        <div className="flex h-full flex-col gap-3 border-r border-[var(--hairline)] bg-[var(--paper)] px-4 py-4">
          <Skeleton className="h-5 w-24 rounded-sm" />
          <div className="flex gap-1.5">
            <Skeleton className="h-6 w-16 rounded-sm" />
            <Skeleton className="h-6 w-12 rounded-sm" />
            <Skeleton className="h-6 w-14 rounded-sm" />
            <Skeleton className="h-6 w-14 rounded-sm" />
          </div>
          <div className="flex flex-col gap-2 pt-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-sm" />
            ))}
          </div>
        </div>

        <div className="flex h-full items-center justify-center bg-[var(--paper)]">
          <Skeleton className="h-40 w-72 rounded-sm" />
        </div>
      </div>
    </div>
  )
}
