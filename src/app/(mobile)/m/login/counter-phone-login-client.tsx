"use client"

import { useState } from "react"
import { signIn, getSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Logo } from "@/components/counter"

/**
 * Sign in, on a phone — `P.login.phone()`.
 *
 * The same two fields and the same `signIn` call as the desk, in the design's
 * phone idiom: a single column, `.mbtn` rather than `.btn`, and none of the
 * desk's aside. A class cannot change with a media query, which is why this is
 * a route rather than a breakpoint — see the note in `proxy.ts`.
 *
 * It lands on `/m` after signing in rather than `/dashboard`: the reader is on
 * a phone, and the redirect that would follow is one the proxy would have to
 * do anyway.
 *
 * `Logo` rather than `Wordmark`, for the reason written out in
 * `shell/logo.tsx` — the prototype draws the mark here too, at 190px rather
 * than the desk's 236px, which is the one number this copy carries of its own.
 */
export function CounterPhoneLoginClient() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const router = useRouter()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      const result = await signIn("credentials", { email, password, redirect: false })
      if (result?.error) {
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
      router.push("/m")
    } catch {
      setProblem("Something went wrong on our end")
      setBusy(false)
    }
  }

  return (
    <main className="ct-root ct-phone plogin">
      <div className="login__logo" style={{ marginBottom: 8 }}>
        <Logo width={190} />
        <span className="cap">Operations</span>
      </div>

      {problem !== null ? (
        <div className="loginmsg" role="alert">
          <span className="fi">!</span>
          <div>
            <b>{problem}</b>
            <p>Two people have accounts. We do not say which half was wrong.</p>
          </div>
        </div>
      ) : null}

      <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
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
          <input
            id="password"
            className="inp"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button className="mbtn mbtn--primary" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mono" style={{ textAlign: "center", margin: 0 }}>
        Invite only · nothing here is your data
      </p>
    </main>
  )
}
