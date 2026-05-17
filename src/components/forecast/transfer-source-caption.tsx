import * as React from "react"

interface TransferSourceCaptionProps {
  storeName: string
  dayNumber: number
}

/**
 * Editorial-docket caption for warming_up stores whose forecasts are
 * Hollywood-derived transfer projections (ml/transfer/hollywood_prior.py).
 * Renders only when the parent forecast read returned forecastSource =
 * 'transfer'. See docs/superpowers/specs/2026-05-17-ml-phase1-weeks5-12-design.md §1.5.
 */
export function TransferSourceCaption({
  storeName,
  dayNumber,
}: TransferSourceCaptionProps) {
  return (
    <div className="border-t border-[color:var(--hairline)] pt-2 mt-2">
      <p
        data-testid="transfer-source-caption"
        className="font-mono text-[11px] uppercase tracking-wide text-[color:var(--ink-faint)]"
      >
        Based on Hollywood patterns · day {dayNumber} of {storeName}
      </p>
    </div>
  )
}
