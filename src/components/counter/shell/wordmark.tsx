/**
 * Note 15: "The wordmark is the palette's alibi." Counter's red and signal
 * yellow read as a designer's choice until the logo sits next to them, at
 * which point they read as the brand. It is the one place Bricolage appears
 * outside a page title.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span
      // `whitespace-nowrap` because `.rail__logo` holds an `<img class="logo">`
      // in the prototype and a line of type here. Below 900px the sheet turns
      // the rail into a horizontal strip (`.rail{flex-direction:row}`), and a
      // shrinking flex item broke "Chris N Eddy's" over three lines at 390px.
      // An image would not have wrapped; the ported sheet has no rule for a
      // wordmark set in type, so this is the one property it needs.
      className={`whitespace-nowrap font-ct-display text-ct-lg font-extrabold tracking-tight text-ct-accent ${className}`}
    >
      Chris N Eddy&apos;s
    </span>
  )
}
