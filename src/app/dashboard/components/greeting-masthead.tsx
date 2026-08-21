import type { CSSProperties, ReactNode } from "react"

const STORE_TZ = "America/Los_Angeles"

/**
 * Store-local hour, not server-local. Four monitoring components already bucket
 * dates in server-local time under a "PT" masthead; a greeting that says "good
 * morning" at 11pm because Vercel runs in UTC would be the same bug in the most
 * visible place on the product.
 */
export function storeLocalHour(now: Date): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: STORE_TZ,
    hour: "numeric",
    hour12: false,
  }).format(now)
  return Number(hour) % 24
}

export function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}

/** First name only — the greeting is a masthead addressing its reader, not a form field. */
export function firstNameOf(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0]
  return first ? first : null
}

/**
 * The name types itself in behind a red caret. CSS cannot measure glyphs, so the
 * component hands the animation its own length: `--name-steps` is one step per
 * character and `--name-width` is a Fraunces-italic estimate at ~0.49em per
 * character. Overshooting slightly is harmless — the last step just lands past
 * the final glyph — but undershooting would clip the name, so round up.
 */
function nameVars(name: string): CSSProperties {
  return {
    "--name-steps": String(name.length),
    "--name-width": `${(name.length * 0.49 + 0.15).toFixed(2)}em`,
  } as CSSProperties
}

interface GreetingMastheadProps {
  /** Owner's display name. Falls back to a plain folio headline when absent. */
  userName: string | null | undefined
  /** Injected so the caller controls the clock (and tests can pin it). */
  now: Date
  folio: ReactNode
  dispatch?: ReactNode
  children: ReactNode
}

export function GreetingMasthead({
  userName,
  now,
  folio,
  dispatch,
  children,
}: GreetingMastheadProps) {
  const first = firstNameOf(userName)
  const greeting = greetingFor(storeLocalHour(now))

  return (
    <section className="masthead dock-in dock-in-1">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 className="masthead__greeting">
            {first ? (
              <>
                {greeting},{" "}
                <span className="masthead__name" style={nameVars(first)}>
                  {first}
                </span>
              </>
            ) : (
              greeting
            )}
          </h2>
          <div className="masthead__folio">{folio}</div>
        </div>
        {dispatch}
      </div>
      {children}
    </section>
  )
}

/** The diamond divider used between folio and dispatch items. */
export function FolioDot() {
  return (
    <span
      className="inline-block h-[3px] w-[3px] rotate-45 bg-[var(--ink-ornament)]"
      aria-hidden="true"
    />
  )
}
