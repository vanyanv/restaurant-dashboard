import { EditorialTopbar } from "../../components/editorial-topbar"

export default function IngredientPricesLoading() {
  return (
    <div className="flex h-full flex-col">
      <EditorialTopbar section="§ 03" title="Ingredient Prices" stamps="loading" />
      <div className="flex-1 overflow-auto px-4 pb-8 pt-4 sm:px-6 sm:pt-5">
        <div className="mx-auto max-w-350 space-y-5">
          <div className="inv-kpis">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="inv-kpi">
                <div className="skeleton-line h-3 w-16" />
                <div className="skeleton-line h-4 w-28" />
                <div className="skeleton-line h-8 w-20" />
                <div className="skeleton-line h-3 w-32" />
              </div>
            ))}
          </div>
          <div className="inv-panel">
            <div className="skeleton-line h-7 w-56" />
            <div className="mt-5 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="skeleton-line h-12 w-full" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
