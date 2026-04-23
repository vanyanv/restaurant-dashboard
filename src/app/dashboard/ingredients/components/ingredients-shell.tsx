import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { SectionErrorBoundary } from "@/components/analytics/section-error"
import { EditorialTopbar } from "../../components/editorial-topbar"
import { PantrySection } from "./sections/pantry-section"
import { SubItemsSection } from "./sections/subitems-section"

type Props = {
  initialOpenId: string | null
}

export function IngredientsShell({ initialOpenId }: Props) {
  return (
    <div className="editorial-surface flex min-h-[calc(100vh-3.5rem)] flex-col">
      <EditorialTopbar section="§ 11" title="Pantry" />

      <SectionErrorBoundary label="Pantry unavailable">
        <Suspense fallback={<PantryFallback />}>
          <PantrySection initialOpenId={initialOpenId} />
        </Suspense>
      </SectionErrorBoundary>

      <SectionErrorBoundary label="Modifier catalog unavailable">
        <Suspense fallback={<SubItemsFallback />}>
          <SubItemsSection />
        </Suspense>
      </SectionErrorBoundary>
    </div>
  )
}

function PantryFallback() {
  // Approximate the pantry toolbar + rail + grid so first paint doesn't jump
  // once the real pantry streams in. Heights chosen to roughly match the real
  // toolbar row and a first screen of tiles.
  return (
    <>
      <div className="border-b border-[var(--hairline-bold)] bg-[var(--paper)]/60 px-8 py-5">
        <Skeleton className="h-12 w-full rounded-sm" />
        <div className="mt-4 flex flex-wrap gap-2">
          <Skeleton className="h-7 w-20 rounded-sm" />
          <Skeleton className="h-7 w-28 rounded-sm" />
          <Skeleton className="h-7 w-36 rounded-sm" />
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="w-[200px] shrink-0 border-r border-[var(--hairline)] bg-[var(--paper)]/50 px-4 py-6">
          <Skeleton className="h-60 w-full rounded-sm" />
        </div>
        <div className="flex-1 px-8 py-6">
          <Skeleton className="h-96 w-full rounded-sm" />
        </div>
      </div>
    </>
  )
}

function SubItemsFallback() {
  // Low-priority placeholder for the collapsed modifier drawer footer.
  return (
    <div className="border-t border-[var(--hairline-bold)] bg-[var(--paper-deep)]/40 px-8 py-4">
      <Skeleton className="h-14 w-full rounded-sm" />
    </div>
  )
}
