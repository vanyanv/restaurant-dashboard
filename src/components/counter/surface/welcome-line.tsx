"use client"

import { TYPE_CHAR_MS, useTypewriter } from "@/components/counter/motion/use-typewriter"
import { rangeTitle, resolvePreset } from "@/lib/counter/date-range"
import { DEFAULT_PRESET } from "@/lib/counter/url-state"

/**
 * The one sentence the product says that is not a figure.
 *
 * It sits on the sign-in DOOR — the night panel that wipes across the form
 * once the credentials are accepted, and holds until the route changes — on
 * both the desk (`/login`, `.login__door`) and the phone (`/m/login`, the
 * stage under the mark). Sign-in is the only route in the application that
 * is not instrumentation, which is why a greeting is allowed here and
 * nowhere else; everything past this door is tabular figures on paper.
 *
 * ## What it says, and why each half is true
 *
 * - **"Welcome back, Chris."** — the first name from the session, typed in
 *   the product's own face (DM Sans, `--t-hero`, the same size as the
 *   "Sign in" heading it visually replaces) with the caret the Ask surface
 *   already uses. No exclamation point; one full stop; then it stops.
 * - **"All stores · Tuesday's numbers"** — the TITLE of the page about to
 *   open, worded by the same `rangeTitle` that words it there, for the same
 *   default window `readCounterParams` resolves. The door names what is
 *   behind it, so the first thing the reader sees on the Overview is the
 *   sentence they were just told. Not business data: a calendar window and
 *   the word "all" are properties of the software, which is the login
 *   screen's own rule for what it may print.
 *
 * ## Timing, and the door's hold
 *
 * The door takes 620ms to wipe. Typing starts at 300ms — by then the wipe
 * (ease-out) is past the centre of the screen, so the first character is
 * never painted on the form — and runs at `TYPE_CHAR_MS` a character. The
 * second line mounts when typing finishes, and the door holds a beat after
 * that before the route changes. `welcomeHoldMs` is that arithmetic, so the
 * two sign-in clients cannot each guess a different number; the floor is
 * the door's own 620ms plus the time a short name needs.
 *
 * Under reduced motion the sentence is simply there, finished, the caret is
 * hidden, and the door holds only its original 620ms — the client asks
 * `useReducedMotion` for that, not this component.
 */

/** Typing starts once the door has crossed the centre of the screen. */
export const WELCOME_TYPE_DELAY_MS = 300
/** After the last character: enough to read the second line before the route changes. */
const WELCOME_SETTLE_MS = 320
/** The door's own wipe; the hold is never shorter than it. */
export const DOOR_WIPE_MS = 620

/** "Chris Karimian" -> "Welcome back, Chris." ; no name -> "Welcome back." */
export function greetingFor(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0]
  return first ? `Welcome back, ${first}.` : "Welcome back."
}

/** The title of the Overview about to open, for the default window. */
export function welcomeNext(today: Date): string {
  return `All stores · ${rangeTitle(resolvePreset(DEFAULT_PRESET, today))}`
}

/** How long the door holds so the whole greeting is read before the route changes. */
export function welcomeHoldMs(greeting: string): number {
  return Math.max(
    DOOR_WIPE_MS,
    WELCOME_TYPE_DELAY_MS + greeting.length * TYPE_CHAR_MS + WELCOME_SETTLE_MS,
  )
}

export function WelcomeLine({
  greeting,
  next,
  delayMs = WELCOME_TYPE_DELAY_MS,
}: {
  greeting: string
  next: string
  delayMs?: number
}) {
  const { shown, done } = useTypewriter(greeting, { delayMs })
  return (
    <div className="login__greet" data-done={done ? "" : undefined}>
      <p className="login__hello">
        <span>{shown}</span>
        <i className="login__caret" aria-hidden="true" />
      </p>
      {/* Mounted on `done` rather than delayed by arithmetic, so it follows
          the sentence however long the name is. */}
      {done ? <p className="login__next">{next}</p> : null}
    </div>
  )
}
