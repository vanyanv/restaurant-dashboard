import Image from "next/image"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { SignupForm } from "./components/signup-form"
import logo from "../../../../public/logo.png"

export const dynamic = "force-dynamic"

type InviteCheck =
  | {
      ok: true
      token: string
      accountName: string
      inviterName: string
      inviterEmail: string
      expiresAt: Date
    }
  | {
      ok: false
      reason: "missing" | "expired" | "used" | "revoked"
      inviterEmail?: string
      tokenShort: string
    }

async function checkInvite(token: string): Promise<InviteCheck> {
  const invite = await prisma.invite.findUnique({
    where: { token },
    select: {
      token: true,
      expiresAt: true,
      usedAt: true,
      revokedAt: true,
      account: { select: { name: true } },
      createdBy: { select: { name: true, email: true } },
    },
  })

  const tokenShort = shortToken(token)

  if (!invite) return { ok: false, reason: "missing", tokenShort }
  if (invite.revokedAt)
    return {
      ok: false,
      reason: "revoked",
      inviterEmail: invite.createdBy.email,
      tokenShort,
    }
  if (invite.usedAt)
    return {
      ok: false,
      reason: "used",
      inviterEmail: invite.createdBy.email,
      tokenShort,
    }
  if (invite.expiresAt.getTime() < Date.now())
    return {
      ok: false,
      reason: "expired",
      inviterEmail: invite.createdBy.email,
      tokenShort,
    }

  return {
    ok: true,
    token: invite.token,
    accountName: invite.account.name,
    inviterName: invite.createdBy.name || invite.createdBy.email,
    inviterEmail: invite.createdBy.email,
    expiresAt: invite.expiresAt,
  }
}

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

export default async function SignupTokenPage(props: {
  params: Promise<{ token: string }>
}) {
  const { token } = await props.params
  const check = await checkInvite(token)

  return (
    <div className="flex min-h-svh w-full items-center justify-center px-5 py-10">
      <div className="login-shell dock-in dock-in-1">
        <div className="dock-in dock-in-2 login-issue-line">
          Vol. 01 · Press Pass · {new Date().getFullYear()}
        </div>

        <div className="dock-in dock-in-3 mt-5 flex justify-center">
          <Image
            src={logo}
            alt="ChrisnEddys"
            width={200}
            height={116}
            className="object-contain"
            priority
          />
        </div>

        {check.ok ? (
          <>
            <h1 className="dock-in dock-in-4 login-headline mt-5">
              Cut your <em>credentials</em>.
            </h1>
            <p className="dock-in dock-in-5 login-subtitle mt-3">
              Owner access to{" "}
              <em className="font-display italic">{check.accountName}</em>.
            </p>

            <div className="dock-in dock-in-6 invite-envelope">
              <span className="invite-envelope__field">Issued by</span>
              <span className="invite-envelope__value">{check.inviterName}</span>
              <span className="invite-envelope__field">Expires</span>
              <span className="invite-envelope__value">
                {formatExpiry(check.expiresAt)}
              </span>
            </div>

            <div className="dock-in dock-in-7 invite-folio">
              Folio · {shortToken(check.token)}
            </div>

            <div className="dock-in dock-in-8 perforation mt-7">
              <span className="font-mono text-[9px] tracking-[0.22em] uppercase">
                Credentials
              </span>
            </div>

            <SignupForm token={check.token} />
          </>
        ) : (
          <>
            <h1 className="dock-in dock-in-4 login-headline mt-5">
              Invite{" "}
              <em>
                {check.reason === "expired"
                  ? "expired"
                  : check.reason === "used"
                    ? "spent"
                    : check.reason === "revoked"
                      ? "revoked"
                      : "missing"}
              </em>
              .
            </h1>

            <div
              className="dock-in dock-in-5 invite-notice"
              role="alert"
              aria-live="polite"
            >
              <span
                className="invite-notice__stamp"
                data-tone={NOTICE_COPY[check.reason].tone}
              >
                {NOTICE_COPY[check.reason].stamp}
              </span>
              <h2 className="invite-notice__headline">
                {NOTICE_COPY[check.reason].headline}
              </h2>
              <p className="invite-notice__body">
                {NOTICE_COPY[check.reason].body}
              </p>
              <div className="invite-notice__footnote">
                <span>Folio · {check.tokenShort}</span>
                {check.inviterEmail ? (
                  <a href={`mailto:${check.inviterEmail}`}>
                    Email the sender
                  </a>
                ) : null}
                <Link href="/login">
                  {check.reason === "used" ? "Sign in" : "Return to sign in"}
                </Link>
              </div>
            </div>
          </>
        )}

        <div className="dock-in dock-in-12 login-colophon">
          ChrisnEddys · Management Console
        </div>
      </div>
    </div>
  )
}

function shortToken(token: string): string {
  if (token.length <= 6) return token.toUpperCase()
  return token.slice(-6).toUpperCase()
}

function formatExpiry(d: Date): string {
  const ms = d.getTime() - Date.now()
  if (ms <= 0) return "expired"
  const days = Math.floor(ms / 86_400_000)
  if (days === 0) {
    const hours = Math.max(1, Math.floor(ms / 3_600_000))
    return `in ${hours} hour${hours === 1 ? "" : "s"}`
  }
  if (days === 1) return "tomorrow"
  if (days < 14) return `in ${days} days`
  // Long-lived invites get an absolute date instead of "in 24 days"
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}
