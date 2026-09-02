"use client"

import { useState } from "react"
import { signIn, getSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Logo } from "@/components/counter"

/**
 * Sign in — `P.login`.
 *
 * "Public and unauthenticated, so nothing on it can be business data", which
 * is the prototype's own note and the reason the aside says what the product
 * DOES rather than what this account's figures are. Every word on this page is
 * the same for a stranger as for the owner.
 *
 * ## The five views, and the one this page has
 *
 * `P.login` draws `default`, `error`, `locked`, `expired` and `magic` off a
 * `UI.view` switch. Three of the five are real states this form reaches:
 * `default`, `error` (a wrong password) and `loading` on the way. `locked` is
 * not — nothing in `authorize()` counts attempts or holds a lockout, so a
 * page that said "locked for another 4 minutes 52 seconds" would be inventing
 * a security control. `expired` belongs to the redirect that sends you here,
 * not to this component, and `magic` needs an email provider this install does
 * not have — `authOptions.providers` is `CredentialsProvider` alone.
 *
 * So the message block is the prototype's `.loginmsg` with the copy this
 * product can stand behind, and the second button is declared absent in the
 * fidelity manifest rather than drawn as a shape.
 *
 * ## `Logo`, not `Wordmark`
 *
 * This drew `Wordmark` — the name set in the display face — on the reasoning
 * that one typeface across all three placements was the same decision made
 * once. The reasoning was sound and the premise was wrong: it rested on
 * `Rail`'s note that "we have no logo asset", and `public/logo.png` has been
 * in the tree the whole time. The rest of the argument, and what the file
 * costs, is in `shell/logo.tsx`; the fidelity manifest's own row for this page
 * is unaffected, because an image is not a landmark.
 *
 * `Rail` and the phone chrome's logo slot still draw the type. They are next.
 */
export function CounterLoginClient() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [reveal, setReveal] = useState(false)
  const router = useRouter()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      const result = await signIn("credentials", { email, password, redirect: false })
      if (result?.error) {
        // The prototype's own copy, and its own reason: "we do not say which,
        // on purpose — otherwise this page would tell a stranger which
        // addresses have accounts."
        setProblem("Email or password is wrong")
        setBusy(false)
        return
      }
      const session = await getSession()
      if (!session) {
        setProblem("Something went wrong on our end")
        setBusy(false)
        return
      }
      router.push("/dashboard")
    } catch {
      setProblem("Something went wrong on our end")
      setBusy(false)
    }
  }

  return (
    <main className="ct-root login">
      <div className="login__form">
        <div className="login__logo">
          <Logo />
          <span className="cap">Operations</span>
        </div>
        <h1>Sign in</h1>
        <p className="sub">Invite only. Two people have accounts.</p>

        {problem !== null ? (
          <div className="loginmsg" role="alert">
            <span className="fi">!</span>
            <div>
              <b>{problem}</b>
              <p>
                We do not say which, on purpose — otherwise this page would tell a stranger
                which addresses have accounts.
              </p>
            </div>
          </div>
        ) : null}

        <form onSubmit={submit} style={{ display: "grid", gap: 16 }}>
          {/* The ids are `email` and `password` because `e2e/auth.setup.ts`
              fills them by id, and that file carries five tasks' worth of
              hard-won knowledge about why sign-in flakes. A rebuilt page
              should not cost it a rewrite. */}
          <div className="field2">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="inp"
              type="email"
              autoComplete="username"
              placeholder="you@chrisneddys.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field2">
            <label htmlFor="password">Password</label>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8 }}>
              <input
                id="password"
                className="inp"
                type={reveal ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {/* `.reveal` is the prototype's own class and carries no
                  landmark — a control that changes what you can see, not one
                  that does anything. */}
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
            className="btn btn--primary"
            type="submit"
            style={{ justifyContent: "center", padding: 11 }}
            disabled={busy}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mono" style={{ margin: 0, textAlign: "center" }}>
          Invite only
        </p>
      </div>

      <div className="login__aside">
        <span className="who">Chris Neddy&rsquo;s Operations</span>
        <p className="qt">
          Every order, every invoice and every hour of labour — reconciled overnight, with a
          model that says what tomorrow should look like.
        </p>
        <ul className="whatis">
          <li>
            <i />
            Orders from four channels, reconciled to the payout
          </li>
          <li>
            <i />
            Invoices read, costed, and posted to COGS
          </li>
          <li>
            <i />A forecast you can score, not just read
          </li>
        </ul>
        <p className="mono" style={{ margin: 0 }}>
          Nothing on this page is anyone&rsquo;s data.
        </p>
      </div>
    </main>
  )
}
