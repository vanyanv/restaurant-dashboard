export function PnLSummarySkeleton() {
  return (
    <div className="dock-in dock-in-3">
      <div className="flex items-center gap-3 pb-3 mb-4 border-b border-[var(--hairline)]">
        <span className="inline-block h-2 w-28 rounded-sm bg-[color:var(--hairline)] animate-pulse" />
        <div className="flex-1 h-px border-t border-dotted border-[var(--hairline-bold)]" />
        <span className="inline-block h-2 w-20 rounded-sm bg-[color:var(--hairline)] animate-pulse" />
      </div>

      <div className="mb-4">
        <span className="inline-block h-2 w-16 rounded-sm bg-[color:var(--hairline)] animate-pulse align-middle" />
        <div className="mt-2">
          <span className="inline-block h-10 w-40 rounded-sm bg-[color:var(--hairline)] animate-pulse align-middle" />
        </div>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <section key={i} className="inv-panel inv-panel--flush">
            <div className="p-4">
              <span className="inline-block h-2 w-14 rounded-sm bg-[color:var(--hairline)] animate-pulse align-middle" />
              <div className="mt-2">
                <span className="inline-block h-7 w-24 rounded-sm bg-[color:var(--hairline)] animate-pulse align-middle" />
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
