export function SectionHead({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pb-3 mb-4 border-b border-[var(--hairline)]">
      <span className="editorial-section-label">{label}</span>
      <div className="flex-1 h-px border-t border-dotted border-[var(--hairline-bold)]" />
    </div>
  )
}
