import Link from "next/link"
import type { ButtonHTMLAttributes, ReactNode } from "react"
import type { ActState } from "./act"

export type ButtonVariant = "primary" | "plain" | "quiet"

function cls(variant: ButtonVariant, extra?: string) {
  return `cu-btn cu-btn--${variant}${extra ? ` ${extra}` : ""}`
}

/**
 * Main, plain and quiet actions. On a phone-width container it grows to a
 * 44 px tap target and, inside `ButtonRow`, shares the row's width.
 *
 * Shared block: replaces `.btn`, `.mbtn`, `.iv-btn`, `.ibtn`, `.qbtn`,
 * `.pagebtn` and `.pp-invite-btn`. A real `<button>`, type="button" unless
 * set; `ButtonLink` is the same look on a link.
 */
export function Button({
  variant = "plain",
  className,
  type = "button",
  state,
  doneLabel,
  disabled,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  /**
   * What the tap is doing, from `useAct`: "busy" keeps the label and adds a
   * small working mark (and blocks a second tap); "done" turns the button
   * green with a tick for a moment. Leave it out for an ordinary button.
   */
  state?: ActState
  /** The words a done button shows, e.g. "Approved". Defaults to its own label. */
  doneLabel?: ReactNode
}) {
  const busy = state === "busy"
  const done = state === "done"
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      data-state={busy || done ? state : undefined}
      className={cls(variant, className)}
    >
      {done ? <>✓ {doneLabel ?? children}</> : children}
    </button>
  )
}

export function ButtonLink({
  href,
  variant = "plain",
  children,
}: {
  href: string
  variant?: ButtonVariant
  children: ReactNode
}) {
  return (
    <Link href={href} className={cls(variant)}>
      {children}
    </Link>
  )
}

/** A row of buttons. On a phone-width container the non-quiet ones share the width. */
export function ButtonRow({ children }: { children: ReactNode }) {
  return (
    <div className="cu-btnrow">
      <div className="cu-btnrow__in">{children}</div>
    </div>
  )
}
