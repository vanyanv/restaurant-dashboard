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
  DOOR_WIPE_MS,
  useReducedMotion,
} from "@/components/counter"

/**
 * Sign in — `P.login`, on the "Sign on" composition.
 *
 * "Public and unauthenticated, so nothing on it can be business data", which
 * is the prototype's own note and the reason the sign panel says where the
 * stores are rather than how they did. Every word on this page is the same for
 * a stranger as for the owner.
 *
 * ## Why this screen is dark and the rest of the product is not
 *
 * Sign-in is the only route in the application that is not instrumentation.
 * Everything past it is tabular figures on paper; this is the sign over the
 * door. The mark in `public/logo-wordmark.png` is already a sign painter's
 * job — gold fill, red outline, a hard drop shadow — which is a lit sign drawn
 * flat, and it reads as one the moment it sits on a dark ground with its own
 * light behind it. The aside this replaced was a grey slab of marketing copy
 * next to a 236px logo stranded in whitespace.
 *
 * ## The dark ground costs no new token
 *
 * `.login__sign` sets `color-scheme: dark` and then reads the ordinary
 * `--ct-*` tokens. Every one of them is declared in `counter.css` as a
 * `light-dark()` pair, and `light-dark()` resolves against the USING element's
 * computed `color-scheme` — so inside that panel `var(--sunk)` is the dark
 * half (oklch 14%) in both application themes, while the form column beside it
 * keeps following the reader's. Verified in Chromium before this was built on:
 * a probe element with `color-scheme: dark` computed `var(--ct-sunk)` as
 * `oklch(0.14 0.009 55)` under a `:root` pinned to `light`.
 *
 * That is the whole reason there is no `--ct-night`. An earlier draft of this
 * design invented one; the dark half of the palette already was one.
 *
 * ## The four states, and the one the fidelity row counts
 *
 * `phase` is `idle` | `working` | `bad` | `good`, replacing the old boolean
 * `busy`. `working` runs a sweep across the button rather than swapping the
 * label to "Signing in…" alone; `bad` stutters the sign, the way a tube
 * stutters, so a rejection lands on the identity instead of only in a red box;
 * `good` turns the button `--good`, draws a check, and then runs `.is-opening`
 * — the night panel wipes across the form — BEFORE `router.push`. The
 * dashboard arrives behind an open door instead of a white flash.
 *
 * The manifest pins this route at ONE landmark on the desk (`baseline.desktop`
 * is 1, plus a declared-absent magic-link `btn`). Everything added here is
 * `login__*`, none of which is in `LANDMARK_CLASSES`, and the one `.btn`
 * remains the one `.btn`. `.reveal` carries no landmark by the same rule it
 * always did — a control that changes what you can see, not one that does
 * anything.
 *
 * ## `Logo`, not `Wordmark`
 *
 * Unchanged, and the argument is in `shell/logo.tsx`. What changed is the
 * width: the sign panel is the mark's own screen, so it asks for 320 rather
 * than the sheet's 236, and the sheet caps it at the panel with `max-width`
 * because `Logo` writes its width inline.
 */
/**
 * The small print under "Email or password is wrong" — the prototype's own
 * reason for refusing to say which field it was.
 */
const WHY_REFUSED =
  "We do not say which, on purpose — otherwise this page would tell a stranger " +
  "which addresses have accounts."

/**
 * The small print under "Something went wrong on our end", on every path that
 * reaches it: the credential check either could not run or did run and the
 * session did not arrive. In none of them is the reader's password implicated,
 * and saying so is the whole point — mid-outage the alternative is an owner
 * hunting a password fault that does not exist.
 */
const WHY_OURS =
  "Nothing is wrong with your password — we could not reach the records to check it. " +
  "Try again in a few minutes."

export function CounterLoginClient() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [phase, setPhase] = useState<"idle" | "working" | "bad" | "good">("idle")
  const [problem, setProblem] = useState<string | null>(null)
  const [why, setWhy] = useState<string | null>(null)
  const [reveal, setReveal] = useState(false)
  // Set on success from the session, and read only by the door.
  const [greeting, setGreeting] = useState<string | null>(null)
  const router = useRouter()
  const reduced = useReducedMotion()

  // `good` holds the door open for its own animation before the route changes.
  // The timer is cleared on unmount so a fast navigation cannot push twice.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  /**
   * `why` is the small print under the message, and it is NOT always the same
   * sentence. The refusal copy is followed by the prototype's reason for being
   * vague; a failure that never reached the records has nothing to be vague
   * about, and telling an owner mid-outage that we are withholding which field
   * was wrong sends them looking for a password fault that does not exist.
   */
  const fail = useCallback((message: string, why: string | null = null) => {
    setProblem(message)
    setWhy(why)
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
        /*
         * "CredentialsSignin" is the ONLY error that means the credentials
         * were refused. next-auth v4 emits it when `authorize` returns null —
         * no such email, or the wrong password — and emits the thrown
         * message for anything else, which `src/lib/auth.ts` uses to say the
         * check could not be made at all.
         *
         * Both used to land here and both were told "Email or password is
         * wrong". During the 2026-09-02 database outage that sentence was
         * false and expensive: an owner with the right password would retype
         * it and then assume the account was gone.
         *
         * The refusal copy stays exactly as the prototype wrote it, for the
         * reason the prototype gives: "we do not say which, on purpose —
         * otherwise this page would tell a stranger which addresses have
         * accounts." That reasoning is about a credential check that RAN. It
         * has nothing to say about one that could not run, and there is
         * nothing to disclose in admitting so.
         */
        if (result.error === "CredentialsSignin") {
          fail(
            "Email or password is wrong",
            WHY_REFUSED,
          )
        } else {
          fail(
            "Something went wrong on our end",
            WHY_OURS,
          )
        }
        return
      }
      const session = await getSession()
      if (!session) {
        fail("Something went wrong on our end", WHY_OURS)
        return
      }
      setPhase("good")
      /*
       * The door holds long enough for the greeting to be typed and read
       * (`welcomeHoldMs`, from the name's length) — about 1.05s for "Chris"
       * against the 620ms the wipe alone took. Under reduced motion the
       * sentence is simply there, so the door holds only its wipe.
       */
      const hello = greetingFor(session.user.name)
      setGreeting(hello)
      timer.current = setTimeout(
        () => router.push("/dashboard"),
        reduced ? DOOR_WIPE_MS : welcomeHoldMs(hello),
      )
    } catch {
      fail("Something went wrong on our end", WHY_OURS)
    }
  }

  const busy = phase === "working" || phase === "good"

  return (
    <main
      className={`ct-root login login--sign${phase === "bad" ? " is-stutter" : ""}${
        phase === "good" ? " is-opening" : ""
      }`}
    >
      <div className="login__sign">
        <span className="login__where">Hollywood · Glendale · Van Nuys</span>

        <div className="login__stage">
          <div className="login__mark">
            <span className="login__bloom" aria-hidden="true" />
            <Logo width={320} />
            <p className="login__op">Operations</p>
          </div>
        </div>

        {/* Three facts that are true for a stranger. No figure here is
            anyone's money — "4 reconciled" is the number of CHANNELS the
            product reads, which is a property of the software. */}
        <div className="login__svc">
          <div>
            <span className="k">Channels</span>
            <span className="v">
              <i className="login__pulse" aria-hidden="true" />4 reconciled
            </span>
          </div>
          <div>
            <span className="k">Reconciled</span>
            <span className="v">Overnight</span>
          </div>
          <div>
            <span className="k">Access</span>
            <span className="v">Invite only</span>
          </div>
        </div>
      </div>

      <div className="login__form">
        <span className="login__eyebrow">Secure sign-in</span>

        {/* One flex child between the eyebrow and the colophon, so the head,
            the message and the fields centre as a group in whatever height is
            left. They were three siblings of a three-row grid and fell into
            implicit rows, which jammed the form against the foot. */}
        <div className="login__body">
        <div className="login__head">
          <h1>Sign in</h1>
          <p className="sub">Invite only. Two people have accounts.</p>
        </div>

        {problem !== null ? (
          <div className="loginmsg" role="alert">
            <span className="fi">!</span>
            <div>
              <b>{problem}</b>
              {why === null ? null : <p>{why}</p>}
            </div>
          </div>
        ) : null}

        <form onSubmit={submit} className="login__fields">
          {/* The ids are `email` and `password` because `e2e/auth.setup.ts`
              fills them by id, and that file carries five tasks' worth of
              hard-won knowledge about why sign-in flakes. A rebuilt page
              should not cost it a rewrite. */}
          <div className="field2">
            <label htmlFor="email">Email</label>
            <div className="inp">
              <input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="you@chrisneddys.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
                required
              />
              {/* `.reveal` is the prototype's own class and carries no
                  landmark — a control that changes what you can see, not one
                  that does anything. It gets a real hit area here; it was a
                  9.5px text run. */}
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
            className={`btn btn--primary login__go${phase === "working" ? " is-working" : ""}${
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
        </div>

        <p className="mono login__foot">Nothing on this page is anyone&rsquo;s data.</p>
      </div>

      {/* The door. Painted only while `.is-opening` runs, and hidden from the
          accessibility tree — it is the transition, not content. */}
      <div className="login__door" aria-hidden="true">
        <Logo width={340} priority={false} />
        {/* The one sentence that is not a figure — see `welcome-line.tsx`.
            Mounted with the `good` phase so its typing starts with the wipe;
            `new Date()` is the client's clock, which is the right clock for a
            line that names the day the reader is about to open. */}
        {greeting !== null ? (
          <WelcomeLine greeting={greeting} next={welcomeNext(new Date())} />
        ) : null}
      </div>
    </main>
  )
}
