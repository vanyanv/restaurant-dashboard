"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Wordmark } from "@/components/counter"

/**
 * Accept an invite, on a phone — `P.signup.phone()`.
 *
 * The same three fields and the same POST as the desk, without the aside. The
 * design drops "what a developer can see" here and keeps the fields, which is
 * the right way round: the promise about access is worth reading, but a phone
 * is where you tap a link from an email and want to be in.
 */
export function CounterPhoneSignupClient({
  token,
  email,
  inviterName,
  expiresLabel,
  preview,
}: {
  token: string
  email: string
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
      router.push("/m")
    } catch {
      setProblem("Something went wrong on our end")
      setBusy(false)
    }
  }

  return (
    <main className="ct-root ct-phone plogin">
      <div className="login__logo" style={{ marginBottom: 6 }}>
        <Wordmark />
      </div>
      <h2 className="mtitle" style={{ textAlign: "center" }}>
        {inviterName} invited you
      </h2>

      {problem !== null ? (
        <div className="loginmsg" role="alert">
          <span className="fi">!</span>
          <div>
            <b>{problem}</b>
            <p>Ask whoever invited you to send another.</p>
          </div>
        </div>
      ) : null}

      <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
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
          <label htmlFor="signup-password">Password</label>
          <input
            id="signup-password"
            className="inp"
            type="password"
            autoComplete="new-password"
            placeholder="10 characters"
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required={!preview}
            disabled={preview}
          />
        </div>
        <button className="mbtn mbtn--primary" type="submit" disabled={busy || preview}>
          {busy ? "Creating…" : "Create the account"}
        </button>
      </form>

      <p className="mono" style={{ textAlign: "center", margin: 0 }}>
        {preview ? "A preview. Nothing here creates an account." : `Expires ${expiresLabel}`}
      </p>
    </main>
  )
}
