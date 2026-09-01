import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { checkInvite } from "../../invite"
import { CounterPhoneSignupClient } from "./counter-phone-signup-client"

export const dynamic = "force-dynamic"

/**
 * `P.signup.phone()`, at `/signup/phone/<token>` rather than under `/m`.
 *
 * Same reason the phone shutdown notice sits outside that segment: `P.signup`
 * is `bare` on both surfaces, and every route under `/m` inherits the tab bar.
 * An invite screen for someone who does not have an account yet cannot offer
 * five tabs into the account. Next resolves the static `phone` segment ahead
 * of `[token]`, so `/signup/<token>` still reaches the desk page.
 *
 * The invite lookup lives on the desk route; a phone reaches this through the
 * proxy's rewrite, which carries the token with it.
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
          inviterName={session.user.name ?? "Someone"}
          expiresLabel="—"
          preview
        />
        <span hidden data-perf-ready="/signup/phone/[token]" />
      </>
    )
  }

  const check = await checkInvite(token)
  // The four refusals are drawn once, on the desk route. A phone that follows
  // a dead link lands there rather than on a second copy of the same notice.
  if (!check.ok) redirect(`/signup/${encodeURIComponent(token)}?desk=1`)

  return (
    <>
      <CounterPhoneSignupClient
        token={check.token}
        email={check.inviterEmail}
        inviterName={check.inviterName}
        expiresLabel={check.expiresAt.toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
        })}
        preview={false}
      />
      <span hidden data-perf-ready="/signup/phone/[token]" />
    </>
  )
}
