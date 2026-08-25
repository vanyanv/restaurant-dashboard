export function InvoiceSnapshotSkeleton() {
  return (
    <div className="relative rounded-none border border-(--hairline) bg-[rgba(255,253,248,0.68)] shadow-none overflow-hidden">
      <span
        aria-hidden
        className="absolute left-0 top-0 h-px w-5 bg-(--accent) opacity-80"
      />
      <div className="flex items-center justify-between border-b border-dotted border-(--hairline-bold) bg-transparent px-4 py-3">
        <div className="space-y-1.5">
          <div className="h-2.5 w-24 rounded-sm bg-(--hairline) animate-pulse" />
          <div className="h-5 w-40 rounded-sm bg-(--hairline) animate-pulse" />
        </div>
        <div className="h-8 w-48 rounded-none bg-(--hairline) animate-pulse" />
      </div>
      <div className="px-4 py-6 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-5 w-full rounded-sm bg-(--hairline) animate-pulse"
          />
        ))}
      </div>
    </div>
  )
}
