import Link from "next/link"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { checkInvite } from "../invite"
import { noticeFor } from "../notice"
import { CounterSignupClient, SignupDeskFrame } from "./counter-signup-client"

export const dynamic = "force-dynamic"

function untilLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" })
}

/**
 * Accept an invite, desk. A link that works shows the form; one that cannot
 * be used says why in the same frame, so nobody lands on a page that looks
 * like a different product.
 *
 * `?preview=1` while signed in draws the form with a placeholder email and
 * creates nothing; the fidelity suite and a developer checking the look use it.
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
            name=""
            role="OWNER"
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

  if (check.ok && check.email) {
    return (
      <>
        <CounterSignupClient
          token={check.token}
          email={check.email}
          name={check.name ?? ""}
          role={check.role}
          inviterName={check.inviterName}
          expiresLabel={untilLabel(check.expiresAt)}
          preview={false}
        />
        <span hidden data-perf-ready="/signup/[token]" />
      </>
    )
  }

  // An invite from before People existed names nobody, so it cannot be
  // redeemed safely: it reads as "ask for a fresh link".
  const notice = check.ok
    ? noticeFor({ ok: false, reason: "revoked", tokenShort: "", inviterName: check.inviterName })
    : noticeFor(check)
  return (
    <SignupDeskFrame
      eyebrow="Invited sign-up"
      foot="Invite only. Nothing on this page is anyone’s data."
      facts={[
        { k: "Access", v: "Invite only" },
        { k: "Links last", v: "7 days" },
        { k: "Each link", v: "Works once" },
      ]}
    >
      <div className="login__head">
        <h1>{notice.headline}</h1>
        <p className="sub">{notice.body}</p>
      </div>
      <div className="login__fields">
        <Link className="btn btn--primary login__go" href="/login">
          <span className="login__label">{notice.action}</span>
        </Link>
      </div>
    </SignupDeskFrame>
  )
}
