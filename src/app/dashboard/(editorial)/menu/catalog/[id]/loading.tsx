export default function MenuItemDetailLoading() {
  return (
    <div className="editorial-surface min-h-[calc(100vh-3.5rem)]">
      {/* Top nav rail */}
      <div className="border-b border-[var(--hairline)] bg-[var(--paper)] px-8 py-3">
        <div className="flex items-center justify-between">
          <div className="h-3 w-28 animate-pulse bg-[var(--hairline-bold)]/60" />
          <div className="h-3 w-40 animate-pulse bg-[var(--hairline)]/80" />
        </div>
      </div>

      {/* Hero */}
      <section className="relative border-b border-[var(--hairline-bold)] bg-[var(--paper)] px-8 pt-10 pb-12">
        <div className="mx-auto max-w-[1180px]">
          <div className="h-3 w-24 animate-pulse bg-[var(--hairline-bold)]/60" />
          <div className="mt-4 h-12 w-2/3 animate-pulse bg-[var(--hairline-bold)]/40" />
          <div className="mt-2 h-12 w-2/5 animate-pulse bg-[var(--hairline-bold)]/40" />
          <div className="mt-6 flex gap-2">
            <div className="h-5 w-24 animate-pulse bg-[var(--hairline)]/80" />
            <div className="h-5 w-20 animate-pulse bg-[var(--hairline)]/80" />
          </div>
        </div>
      </section>

      {/* Stat rail */}
      <section className="border-b border-[var(--hairline-bold)] bg-[var(--paper-deep)]">
        <div className="mx-auto grid max-w-[1180px] grid-cols-2 gap-px bg-[var(--hairline)] md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1.5 bg-[var(--paper)] px-6 py-5">
              <div className="h-2 w-16 animate-pulse bg-[var(--hairline-bold)]/60" />
              <div className="h-6 w-20 animate-pulse bg-[var(--hairline-bold)]/40" />
              <div className="h-2 w-24 animate-pulse bg-[var(--hairline)]/80" />
            </div>
          ))}
        </div>
      </section>

      {/* Body */}
      <section className="bg-[var(--paper)] px-8 py-10">
        <div className="mx-auto grid max-w-[1180px] gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
          {/* Ingredient tree placeholder */}
          <div>
            <div className="flex items-baseline justify-between border-b border-[var(--hairline-bold)] pb-1">
              <div className="h-2 w-20 animate-pulse bg-[var(--hairline-bold)]/60" />
              <div className="h-2 w-24 animate-pulse bg-[var(--hairline)]/80" />
            </div>
            <ul className="mt-2 divide-y divide-[var(--hairline)] border-b border-[var(--hairline)]">
              {Array.from({ length: 8 }).map((_, i) => (
                <li
                  key={i}
                  className="grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_90px_120px]"
                >
                  <div className="min-w-0 space-y-2">
                    <div
                      className="h-4 animate-pulse bg-[var(--hairline-bold)]/40"
                      style={{ width: `${45 + ((i * 17) % 40)}%` }}
                    />
                    <div className="h-2 w-1/3 animate-pulse bg-[var(--hairline)]/80" />
                    {i < 3 && (
                      <div className="h-[3px] w-40 bg-[var(--hairline)]">
                        <div
                          className="h-full animate-pulse bg-[var(--ink)]/30"
                          style={{ width: `${70 - i * 18}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center md:justify-end">
                    <div className="h-3 w-14 animate-pulse bg-[var(--hairline)]/80" />
                  </div>
                  <div className="flex items-center md:justify-end">
                    <div className="h-3 w-20 animate-pulse bg-[var(--hairline)]/80" />
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Sidebar */}
          <aside className="space-y-8 lg:border-l lg:border-[var(--hairline)] lg:pl-10">
            <div>
              <div className="h-2 w-20 border-b border-[var(--hairline-bold)] bg-[var(--hairline-bold)]/60 pb-1 animate-pulse" />
              <div className="mt-3 space-y-2">
                <div className="h-3 w-full animate-pulse bg-[var(--hairline)]/80" />
                <div className="h-3 w-5/6 animate-pulse bg-[var(--hairline)]/80" />
                <div className="h-3 w-4/6 animate-pulse bg-[var(--hairline)]/80" />
              </div>
            </div>
            <div>
              <div className="h-2 w-24 border-b border-[var(--hairline-bold)] bg-[var(--hairline-bold)]/60 pb-1 animate-pulse" />
              <div className="mt-3 divide-y divide-[var(--hairline)] border-y border-[var(--hairline)]">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-baseline justify-between py-2">
                    <div className="h-2 w-20 animate-pulse bg-[var(--hairline)]/80" />
                    <div className="h-2 w-16 animate-pulse bg-[var(--hairline-bold)]/40" />
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </section>
    </div>
  )
}
