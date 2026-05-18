interface Props {
  lifecycleStage: "pre_open" | "warming_up" | "ready" | null
  storeName: string
}

export function OpportunitiesEmptyState({ lifecycleStage, storeName }: Props) {
  const message = (() => {
    if (lifecycleStage === "pre_open") return `${storeName} hasn't opened yet — opportunities will appear once operations begin.`
    if (lifecycleStage === "warming_up") return `Building recommendation history for ${storeName}. The opportunity feed activates after this store transitions to ready.`
    return `No opportunities for ${storeName} today. Check back tomorrow.`
  })()
  return (
    <div className="inv-panel mx-6 my-6 px-5 py-8 text-[color:var(--ink-muted)]">
      <p className="font-serif italic text-[16px]">{message}</p>
    </div>
  )
}
