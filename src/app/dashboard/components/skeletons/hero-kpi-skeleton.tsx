export function HeroKpiSkeleton() {
  return (
    <dl className="editorial-kpi-strip editorial-kpi-strip-wide">
      {[0, 1, 2].map((i) => (
        <div key={i} className="editorial-kpi">
          <div className="kpi-label">
            <span className="inline-block h-2 w-16 rounded-sm bg-[color:var(--hairline)] animate-pulse align-middle" />
          </div>
          <div className="kpi-value">
            <span className="inline-block h-10 w-32 rounded-sm bg-[color:var(--hairline)] animate-pulse align-middle" />
          </div>
          <div className="kpi-unit">
            <span className="inline-block h-2 w-10 rounded-sm bg-[color:var(--hairline)] animate-pulse align-middle" />
          </div>
        </div>
      ))}
    </dl>
  )
}
