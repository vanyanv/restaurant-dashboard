"use client"

import { useEffect, useRef, useState } from "react"
import { signIn, getSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { DOOR_WIPE_MS, greetingFor, useReducedMotion, welcomeHoldMs } from "@/components/counter"

/**
 * The sign-up form, shared by the desk and phone pages. It wears the login
 * page's own parts (`.login__fields`, `.field2`, `.inp`, `.reveal`,
 * `.login__go`), so the two screens cannot drift apart: a change to the
 * login inputs is a change here too.
 *
 * Success runs the same exit the login page does: the account is made, the
 * person is signed in with the password they just chose, and the greeting
 * plays before the dashboard opens.
 */

export type SignupPhase = "idle" | "working" | "bad" | "good"

export const MIN_PASSWORD = 10

/** 0 to 4. Under ten characters is 0 whatever else it has. */
export function passwordStrength(v: string): number {
  if (v.length < MIN_PASSWORD) return 0
  let s = 1
  if (v.length >= 14) s++
  if (/[0-9]/.test(v) && /[a-zA-Z]/.test(v)) s++
  if (/[^a-zA-Z0-9]/.test(v)) s++
  return s
}

const STRENGTH_WORDS = ["", "OK", "Good", "Strong", "Very strong"]

export function useSignup(opts: { token: string; email: string; preview: boolean; home: string }) {
  const [phase, setPhase] = useState<SignupPhase>("idle")
  const [problem, setProblem] = useState<string | null>(null)
  const [greeting, setGreeting] = useState<string | null>(null)
  const router = useRouter()
  const reduced = useReducedMotion()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  async function submit(name: string, password: string) {
    if (opts.preview || phase === "working" || phase === "good") return
    setPhase("working")
    setProblem(null)
    try {
      const res = await fetch("/api/auth/signup-with-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: opts.token, name, password }),
      })
      const body = (await res.json().catch(() => null)) as { error?: string; email?: string } | null
      if (!res.ok) {
        setProblem(body?.error ?? "That didn't work. The link may have just been used")
        setPhase("bad")
        return
      }
      const result = await signIn("credentials", { email: body?.email ?? opts.email, password, redirect: false })
      const session = result?.error ? null : await getSession()
      if (!session) {
        // The account exists; only the automatic sign-in failed.
        router.push("/login")
        return
      }
      setPhase("good")
      const hello = greetingFor(session.user.name)
      setGreeting(hello)
      timer.current = setTimeout(() => router.push(opts.home), reduced ? DOOR_WIPE_MS : welcomeHoldMs(hello))
    } catch {
      setProblem("Something went wrong on our end. Try again in a minute")
      setPhase("bad")
    }
  }

  return { phase, problem, greeting, submit }
}

export function SignupFields({
  email,
  initialName,
  preview,
  phase,
  phone,
  onSubmit,
}: {
  email: string
  initialName: string
  preview: boolean
  phase: SignupPhase
  phone?: boolean
  onSubmit: (name: string, password: string) => void
}) {
  const [name, setName] = useState(initialName)
  const [password, setPassword] = useState("")
  const [reveal, setReveal] = useState(false)
  const strength = passwordStrength(password)
  const short = password.length > 0 && password.length < MIN_PASSWORD
  const busy = phase === "working" || phase === "good"

  return (
    <form
      className="login__fields"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(name.trim(), password)
      }}
    >
      <div className="field2">
        <label htmlFor="signup-email">Email</label>
        <div className="inp su-locked">
          <input id="signup-email" type="email" value={email} readOnly aria-describedby="signup-email-note" />
          <span id="signup-email-note" className="su-lock">
            Locked
          </span>
        </div>
      </div>

      <div className="field2">
        <label htmlFor="signup-name">Your name</label>
        <div className="inp">
          <input
            id="signup-name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required={!preview}
            disabled={preview}
            maxLength={120}
          />
        </div>
      </div>

      <div className="field2">
        <label htmlFor="signup-password">Choose a password</label>
        <div className="inp">
          <input
            id="signup-password"
            type={reveal ? "text" : "password"}
            autoComplete="new-password"
            placeholder={`At least ${MIN_PASSWORD} characters`}
            minLength={MIN_PASSWORD}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required={!preview}
            disabled={preview}
            aria-describedby="signup-strength"
          />
          <button className="reveal" type="button" onClick={() => setReveal((v) => !v)} aria-pressed={reveal}>
            {reveal ? "Hide" : "Show"}
          </button>
        </div>
        <div className="su-meter" data-strength={strength} aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
        <span id="signup-strength" className="su-meter__word" aria-live="polite">
          {password.length === 0
            ? `At least ${MIN_PASSWORD} characters`
            : short
              ? `${MIN_PASSWORD - password.length} more ${MIN_PASSWORD - password.length === 1 ? "character" : "characters"}`
              : STRENGTH_WORDS[strength]}
        </span>
      </div>

      <button
        className={`${phone ? "mbtn mbtn--primary" : "btn btn--primary"} login__go${phase === "working" ? " is-working" : ""}${
          phase === "good" ? " is-good" : ""
        }`}
        type="submit"
        disabled={busy || preview || password.length < MIN_PASSWORD || name.trim() === ""}
      >
        <span className="login__sweep" aria-hidden="true" />
        <span className="login__label">
          {phase === "good" ? (
            <>
              <svg className="login__tick" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M4 10.5l4 4 8-9" />
              </svg>
              You&rsquo;re in
            </>
          ) : phase === "working" ? (
            "Creating your account…"
          ) : (
            "Create my account"
          )}
        </span>
      </button>
    </form>
  )
}

export function roleLine(role: "OWNER" | "DEVELOPER"): string {
  return role === "DEVELOPER"
    ? "Developer access: every store and money page, plus Admin."
    : "Owner access: every store and money page."
}
