/**
 * The four-slot confidence meter, `.dots`.
 *
 * Four slots always. A meter whose length changed with its value would encode
 * the value twice and read as three-of-three at low confidence.
 */
export function Dots({ filled }: { filled: number }) {
  const on = Math.max(0, Math.min(4, Math.round(filled)))
  return (
    <span className="dots">
      {[0, 1, 2, 3].map((i) => (
        <i key={i} className={i < on ? "on" : undefined} />
      ))}
    </span>
  )
}
