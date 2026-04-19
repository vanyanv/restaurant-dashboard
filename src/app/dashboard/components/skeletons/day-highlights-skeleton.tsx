export function DayHighlightsSkeleton() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="h-7 w-40 rounded-full bg-[color:var(--hairline)] animate-pulse" />
      <div className="h-7 w-36 rounded-full bg-[color:var(--hairline)] animate-pulse" />
    </div>
  )
}
