import type { DotCount } from "../lib/confidence"

interface Props {
  count: DotCount
  label?: string
}

export function ConfidenceDots({ count, label = "How sure we are" }: Props) {
  return (
    <span
      className="decisions-dots"
      role="img"
      aria-label={`${label}: ${count} of 3`}
      title={label}
    >
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={
            "decisions-dots__dot" +
            (i <= count ? " is-on" : "")
          }
        />
      ))}
    </span>
  )
}
