"use client"

import { EditorialTopbar } from "../../components/editorial-topbar"

export default function IngredientPricesError({
  reset,
}: {
  error: Error
  reset: () => void
}) {
  return (
    <div className="flex h-full flex-col">
      <EditorialTopbar section="§ 03" title="Ingredient Prices" stamps="error" />
      <div className="flex-1 overflow-auto px-4 pb-8 pt-4 sm:px-6 sm:pt-5">
        <div className="mx-auto max-w-350">
          <section className="inv-panel">
            <div className="inv-panel__head">
              <div>
                <div className="inv-panel__dept">Error</div>
                <h2 className="inv-panel__title">Price data could not load</h2>
              </div>
            </div>
            <p className="max-w-[60ch] text-[13px] leading-6 text-[var(--ink-muted)]">
              The monitor could not read normalized invoice history. Retry the
              request; if it keeps failing, check invoice matching and cost
              hydration logs.
            </p>
            <button type="button" className="toolbar-btn mt-5" onClick={reset}>
              Retry
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}
