/**
 * The key to a small chart: one swatch and a few words per mark.
 *
 * Shared block: `fill` is the measured part, `base` what it is measured
 * against, `hatched` a figure with an input missing, `mark` a reference line.
 */
export type ChartKeyItem = { kind: "fill" | "base" | "hatched" | "mark"; label: string }

export function ChartKey({ items }: { items: ChartKeyItem[] }) {
  if (items.length === 0) return null
  return (
    <span className="cu-key">
      {items.map((k) => (
        <span key={`${k.kind}${k.label}`}>
          <i className={`cu-key__sw cu-key__sw--${k.kind}`} />
          {k.label}
        </span>
      ))}
    </span>
  )
}
