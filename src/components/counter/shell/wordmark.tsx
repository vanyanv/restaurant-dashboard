/**
 * Note 15: "The wordmark is the palette's alibi." Counter's red and signal
 * yellow read as a designer's choice until the logo sits next to them, at
 * which point they read as the brand. It is the one place Bricolage appears
 * outside a page title.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`font-ct-display text-ct-lg font-extrabold tracking-tight text-ct-accent ${className}`}
    >
      Chris N Eddy&apos;s
    </span>
  )
}
