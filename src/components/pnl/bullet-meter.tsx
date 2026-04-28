import { cn } from "@/lib/utils"

/**
 * Inline horizontal bar sized against a target threshold. The meter fills to
 * the value as a fraction of `max`, and switches color at the `target` line.
 *
 * Use for % metrics where "too high" is bad (food cost, labor cost). The bar
 * turns red once the value crosses `target`.
 */
export interface BulletMeterProps {
  /** Current value (e.g. 0.18 for 18%). */
  value: number
  /** The "good ≤ bad >" threshold (e.g. 0.20 for a 20% target). */
  target: number
  /** Scale ceiling. Defaults to `max(target * 1.5, value)`. */
  max?: number
  width?: number
  className?: string
  ariaLabel?: string
}

export function BulletMeter({ value, target, max, width = 80, className, ariaLabel }: BulletMeterProps) {
  const ceiling = max ?? Math.max(target * 1.5, value, 0.01)
  const fillPct = Math.max(0, Math.min(1, value / ceiling)) * 100
  const targetPct = Math.max(0, Math.min(1, target / ceiling)) * 100
  const over = value > target

  return (
    <span
      className={cn("bullet-meter", over && "bullet-meter--over", className)}
      style={{ width }}
      role="img"
      aria-label={ariaLabel ?? `${(value * 100).toFixed(1)}% of target ${(target * 100).toFixed(0)}%`}
    >
      <span
        className="bullet-meter__fill"
        style={{ ["--bullet-fill" as string]: fillPct / 100 }}
      />
      <span className="bullet-meter__target" style={{ left: `${targetPct}%` }} aria-hidden />
    </span>
  )
}
