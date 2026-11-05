"use client"

import type { ReactNode } from "react"
import { Logo, WelcomeLine, welcomeNext } from "@/components/counter"
import { SignupFields, roleLine, useSignup } from "../../signup-fields"

/**
 * Accept an invite, phone. The phone login's composition (`.plogin--sign`):
 * the lit sign on top, the form in a sheet under it.
 */
export function SignupPhoneFrame({
  className = "",
  foot,
  stage,
  children,
}: {
  className?: string
  foot: string
  stage?: ReactNode
  children: ReactNode
}) {
  return (
    <main className={`ct-root ct-phone plogin plogin--sign${className}`}>
      <div className="plogin__stage">
        <div className="login__mark">
          <span className="login__bloom" aria-hidden="true" />
          <Logo width={190} />
          <p className="login__op">Operations</p>
        </div>
        {stage}
      </div>
      <div className="plogin__sheet">
        {children}
        <p className="mono plogin__foot">{foot}</p>
      </div>
    </main>
  )
}

export function CounterPhoneSignupClient({
  token,
  email,
  name,
  role,
  inviterName,
  expiresLabel,
  preview,
}: {
  token: string
  email: string
  name: string
  role: "OWNER" | "DEVELOPER"
  inviterName: string
  expiresLabel: string
  preview: boolean
}) {
  const { phase, problem, greeting, submit } = useSignup({ token, email, preview, home: "/m" })

  return (
    <SignupPhoneFrame
      className={`${phase === "bad" ? " is-stutter" : ""}${phase === "good" ? " is-flooding" : ""}`}
      foot={preview ? "A preview. Nothing here creates an account." : `Only for ${email} · works until ${expiresLabel}`}
      stage={greeting !== null ? <WelcomeLine greeting={greeting} next={welcomeNext(new Date())} delayMs={220} /> : null}
    >
      <div className="su-phead">
        <h1>{inviterName} invited you</h1>
        <p>Choose a password and you&rsquo;re in. {roleLine(role)}</p>
      </div>

      {problem !== null ? (
        <div className="loginmsg" role="alert">
          <span className="fi">!</span>
          <div>
            <b>{problem}</b>
            <p>If it keeps happening, ask {inviterName} to send you a fresh link.</p>
          </div>
        </div>
      ) : null}

      <SignupFields email={email} initialName={name} preview={preview} phase={phase} phone onSubmit={submit} />
    </SignupPhoneFrame>
  )
}
