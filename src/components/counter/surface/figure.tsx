import { TABULAR } from "@/lib/counter/format"

export interface FigureProps {
  label: string
  /** Pre-formatted. Formatting belongs to `@/lib/counter/format`, not here. */
  value: string
  caption?: string
  delta?: string
  /** `lead` is the one headline figure on a page; the default is a strip cell. */
  size?: "lead" | "cell"
}

/**
 * One figure: what it is, what it reads, and what it is being judged against.
 *
 * The value is always DM Sans with tabular lining numerals — without them a
 * column of figures does not align, which is the whole reason the design
 * mandates them.
 */
export function Figure({ label, value, caption, delta, size = "cell" }: FigureProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3">
        {label}
      </span>
      <span
        data-figure-value
        className={
          size === "lead"
            ? `text-ct-hero font-semibold text-ct-ink ${TABULAR}`
            : `text-ct-xl font-semibold text-ct-ink ${TABULAR}`
        }
      >
        {value}
      </span>
      {delta ? <span className={`text-ct-cap text-ct-ink-2 ${TABULAR}`}>{delta}</span> : null}
      {caption ? <span className="text-ct-cap text-ct-ink-3">{caption}</span> : null}
    </div>
  )
}
