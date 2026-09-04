"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { signIn, getSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import {
  Logo,
  WelcomeLine,
  greetingFor,
  welcomeNext,
  welcomeHoldMs,
  useReducedMotion,
} from "@/components/counter"

/**
 * Sign in, on a phone — `P.login.phone()`, on the "Sign on" composition.
 *
 * The same two fields and the same `signIn` call as the desk, in the design's
 * phone idiom: a single column, `.mbtn` rather than `.btn`, and none of the
 * desk's second column. A class cannot change with a media query, which is why
 * this is a route rather than a breakpoint — see the note in `proxy.ts`.
 *
 * It lands on `/m` after signing in rather than `/dashboard`: the reader is on
 * a phone, and the redirect that would follow is one the proxy would have to
 * do anyway.
 *
 * ## The keyboard is the design constraint
 *
 * A sign-in screen built around a large mark breaks the instant someone taps a
 * field, because the software keyboard takes roughly half a phone screen and
 * the form goes under it. So focus drives a layout change rather than only a
 * ring: `.is-typing` folds the mark from 190px to 104px, drops "Operations",
 * and lifts the sheet. Blur reverses it. This is the one animation on the page
 * that `prefers-reduced-motion` does NOT remove — it is layout, not
 * decoration, and a reader who suppresses motion still needs to see the field
 * they are typing into.
 *
 * `onBlur` defers a frame before folding back, because tabbing from Email to
 * Password blurs one field before focusing the next and would otherwise
 * unfold and refold the sign between two keystrokes.
 *
 * Nothing autofocuses, deliberately. Autofocusing the email field throws the
 * keyboard up before the reader has seen the screen, which on this composition
 * means never seeing the sign at all.
 *
 * ## The dark ground costs no new token
 *
 * `.plogin--sign` sets `color-scheme: dark` and reads the ordinary `--ct-*`
 * tokens; `light-dark()` resolves against the using element's own
 * `color-scheme`, so the whole screen is the dark half of the palette in both
 * application themes. The reasoning, and the Chromium probe that confirmed it,
 * are written out in the desk copy of this screen.
 *
 * ## Landmarks
 *
 * The manifest pins this route at ONE landmark on the phone (`baseline.mobile`
 * is 1, plus a declared-absent magic-link `mbtn`). The one `.mbtn` is still
 * the one `.mbtn`; everything added is `plogin__*` or `login__*`, none of
 * which is in `LANDMARK_CLASSES`. The `.reveal` the desk has is added here
 * too — it carries no landmark, and a password field a reader cannot check is
 * worse on a phone than anywhere else.
 */
/** The sheet's drop and the sign's flood — `plogin-drop` .2s + .5s, `plogin-flood` .7s. */
const PHONE_FLOOD_MS = 700

export function CounterPhoneLoginClient() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [phase, setPhase] = useState<"idle" | "working" | "bad" | "good">("idle")
  const [problem, setProblem] = useState<string | null>(null)
  const [reveal, setReveal] = useState(false)
  const [typing, setTyping] = useState(false)
  const router = useRouter()

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unfold = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Set on success from the session, and read only by the flooded stage.
  const [greeting, setGreeting] = useState<string | null>(null)
  const reduced = useReducedMotion()
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    if (unfold.current) clearTimeout(unfold.current)
  }, [])

  // Tabbing between the two fields blurs one before focusing the next; folding
  // on that gap would flap the sign twice per field.
  function onFocus() {
    if (unfold.current) clearTimeout(unfold.current)
    setTyping(true)
  }
  function onBlur() {
    if (unfold.current) clearTimeout(unfold.current)
    unfold.current = setTimeout(() => setTyping(false), 80)
  }

  const fail = useCallback((message: string) => {
    setProblem(message)
    setPhase("bad")
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (phase === "working" || phase === "good") return
    setPhase("working")
    setProblem(null)
    try {
      const result = await signIn("credentials", { email, password, redirect: false })
      if (result?.error) {
        fail("Email or password is wrong")
        return
      }
      const session = await getSession()
      if (!session) {
        fail("Something went wrong on our end")
        return
      }
      setPhase("good")
      setTyping(false)
      // The same hold as the desk door, for the same reason (see there); the
      // phone's own flood took 700ms, which is the floor under reduced motion.
      const hello = greetingFor(session.user.name)
      setGreeting(hello)
      timer.current = setTimeout(
        () => router.push("/m"),
        reduced ? PHONE_FLOOD_MS : Math.max(PHONE_FLOOD_MS, welcomeHoldMs(hello)),
      )
    } catch {
      fail("Something went wrong on our end")
    }
  }

  const busy = phase === "working" || phase === "good"

  return (
    <main
      className={`ct-root ct-phone plogin plogin--sign${typing ? " is-typing" : ""}${
        phase === "bad" ? " is-stutter" : ""
      }${phase === "good" ? " is-flooding" : ""}`}
    >
      <div className="plogin__stage">
        <div className="login__mark">
          <span className="login__bloom" aria-hidden="true" />
          <Logo width={190} />
          <p className="login__op">Operations</p>
        </div>
        {/* Typed under the mark as the sheet drops away — the phone's door is
            the stage itself. Starts a little earlier than the desk's because
            the stage is already in view; there is no wipe to wait for. */}
        {greeting !== null ? (
          <WelcomeLine greeting={greeting} next={welcomeNext(new Date())} delayMs={220} />
        ) : null}
      </div>

      <div className="plogin__sheet">
        {problem !== null ? (
          <div className="loginmsg" role="alert">
            <span className="fi">!</span>
            <div>
              <b>{problem}</b>
              <p>Two people have accounts. We do not say which half was wrong.</p>
            </div>
          </div>
        ) : null}

        <form onSubmit={submit} className="login__fields">
          <div className="field2">
            <label htmlFor="email">Email</label>
            <div className="inp">
              <input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                placeholder="you@chrisneddys.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={onFocus}
                onBlur={onBlur}
                required
              />
            </div>
          </div>

          <div className="field2">
            <label htmlFor="password">Password</label>
            <div className="inp">
              <input
                id="password"
                type={reveal ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={onFocus}
                onBlur={onBlur}
                required
              />
              <button
                className="reveal"
                type="button"
                onClick={() => setReveal((v) => !v)}
                aria-pressed={reveal}
              >
                {reveal ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <button
            className={`mbtn mbtn--primary login__go${phase === "working" ? " is-working" : ""}${
              phase === "good" ? " is-good" : ""
            }`}
            type="submit"
            disabled={busy}
          >
            <span className="login__sweep" aria-hidden="true" />
            <span className="login__label">
              {phase === "good" ? (
                <>
                  <svg className="login__tick" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M4 10.5l4 4 8-9" />
                  </svg>
                  Signed in
                </>
              ) : phase === "working" ? (
                "Signing in…"
              ) : (
                "Sign in"
              )}
            </span>
          </button>
        </form>

        <p className="mono plogin__foot">Invite only · nothing here is your data</p>
      </div>
    </main>
  )
}
