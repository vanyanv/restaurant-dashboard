import Link from "next/link"
import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { checkInvite } from "../../invite"
import { noticeFor } from "../../notice"
import { CounterPhoneSignupClient, SignupPhoneFrame } from "./counter-phone-signup-client"

export const dynamic = "force-dynamic"

function untilLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" })
}

/**
 * Accept an invite, phone. The proxy rewrites a phone here from
 * `/signup/<token>`, so the link in the email works on either device.
 */
export default async function Page(props: {
  params: Promise<{ token: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { token } = await props.params
  const sp = await props.searchParams

  if (sp.preview === "1") {
    const session = await getServerSession(authOptions)
    if (!session) redirect("/login")
    return (
      <>
        <CounterPhoneSignupClient
          token={token}
          email="them@example.com"
          name=""
          role="OWNER"
          inviterName={session.user.name ?? "Someone"}
          expiresLabel="—"
          preview
        />
        <span hidden data-perf-ready="/signup/phone/[token]" />
      </>
    )
  }

  const check = await checkInvite(token)

  if (check.ok && check.email) {
    return (
      <>
        <CounterPhoneSignupClient
          token={check.token}
          email={check.email}
          name={check.name ?? ""}
          role={check.role}
          inviterName={check.inviterName}
          expiresLabel={untilLabel(check.expiresAt)}
          preview={false}
        />
        <span hidden data-perf-ready="/signup/phone/[token]" />
      </>
    )
  }

  const notice = check.ok
    ? noticeFor({ ok: false, reason: "revoked", tokenShort: "", inviterName: check.inviterName })
    : noticeFor(check)
  return (
    <SignupPhoneFrame foot="Invite only · links work once, for 7 days">
      <div className="su-phead">
        <h1>{notice.headline}</h1>
        <p>{notice.body}</p>
      </div>
      <Link className="mbtn mbtn--primary" href="/m/login">
        {notice.action}
      </Link>
    </SignupPhoneFrame>
  )
}
