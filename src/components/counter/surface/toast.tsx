export type ToastTone = "ok" | "warn" | "bad"

const TONE: Record<ToastTone, string> = {
  ok: "border-ct-good bg-ct-good-wash text-ct-ink",
  warn: "border-ct-warn bg-ct-warn-wash text-ct-ink",
  bad: "border-ct-bad bg-ct-bad-wash text-ct-ink",
}

/**
 * Every consequential button answers back — Saved, Committed, Approved and
 * posted to COGS. An action that changes something and says nothing leaves the
 * reader wondering whether it worked.
 *
 * A failure is announced assertively because the reader needs to know now; a
 * success is polite, because interrupting someone to say "it worked" is noise.
 */
export function Toast({
  message,
  tone = "ok",
  onDismiss,
}: {
  message: string
  tone?: ToastTone
  onDismiss?: () => void
}) {
  const bad = tone === "bad"
  return (
    <div
      role={bad ? "alert" : "status"}
      aria-live={bad ? "assertive" : "polite"}
      className={`flex items-center gap-3 rounded-ct border px-4 py-2 text-ct-body ${TONE[tone]}`}
    >
      <span>{message}</span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="ml-auto font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3 hover:text-ct-ink"
        >
          Dismiss
        </button>
      ) : null}
    </div>
  )
}
