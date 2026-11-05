"use client"

import type { ReactNode } from "react"
import { Logo, WelcomeLine, welcomeNext } from "@/components/counter"
import { SignupFields, roleLine, useSignup } from "../signup-fields"

/**
 * Accept an invite, desk. The login page's own composition (`.login--sign`):
 * the lit sign on the left, the form on the right, the same eyebrow, fields,
 * button and colophon. Where login's sign lists three facts about the
 * product, this one lists the three about the invite.
 */
export function SignupDeskFrame({
  facts,
  eyebrow,
  foot,
  className = "",
  children,
  door,
}: {
  facts: Array<{ k: string; v: string; pulse?: boolean }>
  eyebrow: string
  foot: string
  className?: string
  children: ReactNode
  door?: ReactNode
}) {
  return (
    <main className={`ct-root login login--sign${className}`}>
      <div className="login__sign">
        <span className="login__where">Hollywood · Glendale · Van Nuys</span>
        <div className="login__stage">
          <div className="login__mark">
            <span className="login__bloom" aria-hidden="true" />
            <Logo width={320} />
            <p className="login__op">Operations</p>
          </div>
        </div>
        <div className="login__svc">
          {facts.map((f) => (
            <div key={f.k}>
              <span className="k">{f.k}</span>
              <span className="v">
                {f.pulse ? <i className="login__pulse" aria-hidden="true" /> : null}
                {f.v}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="login__form">
        <span className="login__eyebrow">{eyebrow}</span>
        <div className="login__body">{children}</div>
        <p className="mono login__foot">{foot}</p>
      </div>

      <div className="login__door" aria-hidden="true">
        <Logo width={340} priority={false} />
        {door}
      </div>
    </main>
  )
}

export function CounterSignupClient({
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
  const { phase, problem, greeting, submit } = useSignup({ token, email, preview, home: "/dashboard" })

  return (
    <SignupDeskFrame
      className={`${phase === "bad" ? " is-stutter" : ""}${phase === "good" ? " is-opening" : ""}`}
      eyebrow="Invited sign-up"
      foot={preview ? "A preview. Nothing here creates an account." : `This link is only for ${email} and works once.`}
      facts={[
        { k: "Invited by", v: inviterName, pulse: true },
        { k: "Access", v: role === "DEVELOPER" ? "Developer" : "Owner" },
        { k: "Link good until", v: expiresLabel },
      ]}
      door={greeting !== null ? <WelcomeLine greeting={greeting} next={welcomeNext(new Date())} /> : null}
    >
      <div className="login__head">
        <h1>{inviterName} invited you</h1>
        <p className="sub">Choose a password and you&rsquo;re in. {roleLine(role)}</p>
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

      <SignupFields email={email} initialName={name} preview={preview} phase={phase} onSubmit={submit} />
    </SignupDeskFrame>
  )
}
