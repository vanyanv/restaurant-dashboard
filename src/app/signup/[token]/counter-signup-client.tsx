"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Logo } from "@/components/counter"

/**
 * Accept an invite — `P.signup`.
 *
 * The design's own aside is "what a developer can see", and it is the whole
 * reason this page has one: somebody is about to be given the run of an
 * account, and the screen that asks them to pick a password is the last place
 * anyone reads what that means.
 *
 * ## Preview
 *
 * `?preview=1` renders the same composition for a SIGNED-IN reader with the
 * submit disabled and the copy saying so. An invite screen is otherwise
 * invisible until you send one — you cannot look at it, review its wording, or
 * measure it against its design without minting a real token, and minting one
 * against a live database to take a screenshot is not a thing to do. The
 * session is the safeguard; a stranger with a bad token still gets the
 * rejection state.
 */
export function CounterSignupClient({
  token,
  email,
  accountName,
  inviterName,
  expiresLabel,
  preview,
}: {
  token: string
  email: string
  accountName: string
  inviterName: string
  expiresLabel: string
  preview: boolean
}) {
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const router = useRouter()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (preview) return
    setBusy(true)
    setProblem(null)
    try {
      const res = await fetch("/api/auth/signup-with-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, email, password }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setProblem(body?.error ?? "That did not work. The invite may have just been used.")
        setBusy(false)
        return
      }
      await signIn("credentials", { email, password, redirect: false })
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
        <h1>{inviterName} invited you</h1>
        <p className="sub">
          You are joining <b>{accountName}</b>. Pick a password and you are in.
        </p>

        {problem !== null ? (
          <div className="loginmsg" role="alert">
            <span className="fi">!</span>
            <div>
              <b>{problem}</b>
              <p>Ask whoever invited you to send another.</p>
            </div>
          </div>
        ) : null}

        <form onSubmit={submit} style={{ display: "grid", gap: 16 }}>
          <div className="field2">
            <label htmlFor="signup-email">Email</label>
            <input id="signup-email" className="inp" type="email" value={email} readOnly />
          </div>
          <div className="field2">
            <label htmlFor="signup-name">Your name</label>
            <input
              id="signup-name"
              className="inp"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required={!preview}
              disabled={preview}
            />
          </div>
          <div className="field2">
            <label htmlFor="signup-password">Choose a password</label>
            <input
              id="signup-password"
              className="inp"
              type="password"
              autoComplete="new-password"
              placeholder="At least 10 characters"
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required={!preview}
              disabled={preview}
            />
          </div>
          <button
            className="btn btn--primary"
            type="submit"
            style={{ justifyContent: "center", padding: 11 }}
            disabled={busy || preview}
          >
            {busy ? "Creating…" : "Create the account"}
          </button>
        </form>

        <p className="mono" style={{ textAlign: "center", margin: 0 }}>
          {preview
            ? "A preview. Nothing here creates an account."
            : `This invite expires on ${expiresLabel}.`}
        </p>
      </div>

      <div className="login__aside">
        <span className="who">What this account can see</span>
        <p className="qt">
          Everything the owner sees, plus the monitoring pages the owner never does.
        </p>
        <div className="loginstat">
          <div>
            <span className="k">Stores</span>
            <span className="v">All of them</span>
          </div>
          <div>
            <span className="k">Money pages</span>
            <span className="v">Yes</span>
          </div>
          <div>
            <span className="k">Monitoring</span>
            <span className="v">Yes</span>
          </div>
          <div>
            <span className="k">Invited by</span>
            <span className="v">{inviterName}</span>
          </div>
        </div>
      </div>
    </main>
  )
}
