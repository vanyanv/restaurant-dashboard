import Link from "next/link"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { Logo } from "@/components/counter"
import { checkInvite, type InviteCheck } from "../invite"
import { CounterSignupClient } from "./counter-signup-client"

export const dynamic = "force-dynamic"

const NOTICE_COPY: Record<
  Exclude<InviteCheck, { ok: true }>["reason"],
  { stamp: string; tone: "ink" | "warn"; headline: string; body: string }
> = {
  missing: {
    stamp: "No record · 404",
    tone: "ink",
    headline: "We couldn't find that invite.",
    body: "The link may have a typo, or this invite was never created. Ask the person who sent it to generate a new one.",
  },
  expired: {
    stamp: "Past edition · 410",
    tone: "warn",
    headline: "This invite has expired.",
    body: "Invites are good for seven days. Ask the sender to issue a fresh link.",
  },
  used: {
    stamp: "Spent",
    tone: "ink",
    headline: "This invite has already been used.",
    body: "Each invite is single-use. If you already have an account, sign in below.",
  },
  revoked: {
    stamp: "Revoked",
    tone: "warn",
    headline: "This invite was revoked.",
    body: "The sender disabled this link. Ask them to issue a new one if you still need access.",
  },
}

/**
 * Accept an invite — `P.signup`.
 *
 * `?preview=1` renders the design's composition for a SIGNED-IN reader with
 * the submit disabled, because an invite screen is otherwise invisible until
 * you send one: you cannot read its wording, check what it promises about
 * access, or measure it against its design without minting a real token
 * against a live database. The session is the safeguard — a stranger with a
 * bad token still gets the rejection notice below.
 *
 * The rejection states are NOT part of `P.signup`. The design draws the
 * accepted invite and nothing else, so the four refusals — missing, expired,
 * used, revoked — are this product's own and are left as they were. They are
 * the only editorial markup remaining on this route, and they go when someone
 * decides what a refused invite should look like in Counter.
 */
export default async function SignupTokenPage(props: {
  params: Promise<{ token: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { token } = await props.params
  const sp = await props.searchParams

  if (sp.preview === "1") {
    const session = await getServerSession(authOptions)
    if (session) {
      return (
        <>
          <CounterSignupClient
            token={token}
            email="them@example.com"
            accountName="this account"
            inviterName={session.user.name ?? "Someone"}
            expiresLabel="—"
            preview
          />
          <span hidden data-perf-ready="/signup/[token]" />
        </>
      )
    }
  }

  const check = await checkInvite(token)

  if (check.ok) {
    return (
      <>
        <CounterSignupClient
          token={check.token}
          email={check.inviterEmail}
          accountName={check.accountName}
          inviterName={check.inviterName}
          expiresLabel={check.expiresAt.toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
          })}
          preview={false}
        />
        <span hidden data-perf-ready="/signup/[token]" />
      </>
    )
  }

  const copy = NOTICE_COPY[check.reason]
  return (
    <main className="ct-root login" style={{ gridTemplateColumns: "1fr" }}>
      <div className="login__form" style={{ maxWidth: 460 }}>
        <div className="login__logo">
          <Logo />
          <span className="cap">Operations</span>
        </div>
        <h1>{copy.headline}</h1>
        <p className="sub">{copy.body}</p>
        <div className="btnrow" style={{ justifyContent: "center" }}>
          <Link className="btn btn--primary" href="/login">
            Go to sign in
          </Link>
        </div>
        <p className="mono" style={{ textAlign: "center", margin: 0 }}>
          {copy.stamp} · {check.tokenShort}
        </p>
      </div>
    </main>
  )
}
