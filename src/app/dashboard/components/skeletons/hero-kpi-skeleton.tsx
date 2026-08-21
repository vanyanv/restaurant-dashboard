export function HeroKpiSkeleton() {
  return (
    <dl className="masthead-rail">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="masthead-rail__cell">
          <div className="masthead-rail__label">
            <span className="inline-block h-2 w-16 rounded-sm bg-[color:var(--hairline)] animate-pulse align-middle" />
          </div>
          <div className="masthead-rail__figure">
            <span className="inline-block h-10 w-32 rounded-sm bg-[color:var(--hairline)] animate-pulse align-middle" />
          </div>
          <div className="masthead-rail__meta">
            <span className="inline-block h-2 w-24 rounded-sm bg-[color:var(--hairline)] animate-pulse align-middle" />
          </div>
          <div className="masthead-rail__band">
            <div className="masthead-rail__band-track" />
          </div>
        </div>
      ))}
    </dl>
  )
}
