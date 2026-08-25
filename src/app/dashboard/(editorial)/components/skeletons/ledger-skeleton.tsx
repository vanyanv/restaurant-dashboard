/**
 * Placeholder for `OverviewLedger` — seven columns and three rows of hairline,
 * so the reserved height matches what lands and the page does not jump.
 */
export function OverviewLedgerSkeleton() {
  return (
    <div className="ov-ledger">
      <div className="ov-ledger__grid">
        <div className="ov-ledger__row ov-ledger__row--head">
          <span>Store</span>
          {["Orders", "Gross", "Discounts", "Net", "Fees", "Payout"].map((c) => (
            <span key={c} className="text-right">
              {c}
            </span>
          ))}
        </div>
        {[0, 1, 2].map((r) => (
          <div key={r} className="ov-ledger__row">
            <span>
              <span className="inline-block h-4 w-28 rounded-sm bg-[color:var(--hairline)] align-middle animate-pulse" />
            </span>
            {[0, 1, 2, 3, 4, 5].map((c) => (
              <span key={c} className="text-right">
                <span className="inline-block h-3.5 w-16 rounded-sm bg-[color:var(--hairline)] align-middle animate-pulse" />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
