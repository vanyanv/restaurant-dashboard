import { notFound, redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { listInvites } from "@/app/actions/invite-actions"
import { CreateInviteButton } from "./components/create-invite-button"
import { RevokeInviteButton } from "./components/revoke-invite-button"

export const dynamic = "force-dynamic"

const NUM_CLASS =
  "[font-variant-numeric:tabular-nums_lining-nums] [font-feature-settings:'tnum','lnum']"

export default async function InvitesPage() {
  if (process.env.NODE_ENV === "production") notFound()

  const session = await getServerSession(authOptions)
  if (!session?.user) redirect("/login")
  if (session.user.role !== "OWNER") notFound()

  const invites = await listInvites()
  const pending = invites.filter((i) => i.status === "pending")
  const history = invites.filter((i) => i.status !== "pending")

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <div
          className="text-[11px] uppercase tracking-[0.12em]"
          style={{ fontFamily: "var(--font-mono)", color: "var(--ink-faint)" }}
        >
          § Local-only · invites
        </div>
        <h1
          className="font-display italic text-[40px] leading-tight"
          style={{ color: "var(--ink)" }}
        >
          Invite a peer
        </h1>
        <p
          className="text-[14px] max-w-prose"
          style={{ color: "var(--ink-muted)" }}
        >
          Generate a single-use signup link valid for seven days. Anyone who
          opens it can create an account on{" "}
          <em className="font-display italic">your</em> data — they will see
          every store, invoice, and recipe you do. This page is only available
          locally; production returns 404.
        </p>
      </header>

      <section
        className="inv-panel"
        style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div
          className="text-[11px] uppercase tracking-[0.1em]"
          style={{ fontFamily: "var(--font-mono)", color: "var(--ink-faint)" }}
        >
          New link
        </div>
        <CreateInviteButton />
      </section>

      <section
        className="inv-panel"
        style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 16 }}
      >
        <div className="flex items-baseline justify-between">
          <h2
            className="font-display italic text-[22px]"
            style={{ color: "var(--ink)" }}
          >
            Pending
          </h2>
          <span
            className={`text-[12px] ${NUM_CLASS}`}
            style={{ fontFamily: "var(--font-mono)", color: "var(--ink-faint)" }}
          >
            {pending.length}
          </span>
        </div>

        {pending.length === 0 ? (
          <p className="text-[13px]" style={{ color: "var(--ink-muted)" }}>
            No pending invites.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-2 px-3 py-3"
                style={{
                  border: "1px solid var(--hairline)",
                  borderRadius: 2,
                  background: "var(--paper)",
                }}
              >
                <div className="flex items-center gap-3">
                  <code
                    className="flex-1 text-[12px] truncate"
                    style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}
                  >
                    {row.url}
                  </code>
                  <RevokeInviteButton id={row.id} />
                </div>
                <div
                  className={`flex gap-4 text-[11px] uppercase tracking-[0.08em] ${NUM_CLASS}`}
                  style={{ fontFamily: "var(--font-mono)", color: "var(--ink-faint)" }}
                >
                  <span>created {row.createdAt.toLocaleString()}</span>
                  <span>expires {row.expiresAt.toLocaleString()}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        className="inv-panel"
        style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 16 }}
      >
        <div className="flex items-baseline justify-between">
          <h2
            className="font-display italic text-[22px]"
            style={{ color: "var(--ink)" }}
          >
            History
          </h2>
          <span
            className={`text-[12px] ${NUM_CLASS}`}
            style={{ fontFamily: "var(--font-mono)", color: "var(--ink-faint)" }}
          >
            {history.length}
          </span>
        </div>

        {history.length === 0 ? (
          <p className="text-[13px]" style={{ color: "var(--ink-muted)" }}>
            Nothing yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {history.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-4 px-3 py-2"
                style={{
                  borderTop: "1px solid var(--hairline)",
                }}
              >
                <span
                  className="text-[11px] uppercase tracking-[0.08em] w-20"
                  style={{
                    fontFamily: "var(--font-mono)",
                    color:
                      row.status === "used"
                        ? "var(--ink)"
                        : row.status === "revoked"
                          ? "var(--accent)"
                          : "var(--ink-faint)",
                  }}
                >
                  {row.status}
                </span>
                <span
                  className="flex-1 text-[12px] truncate"
                  style={{ color: "var(--ink-muted)" }}
                >
                  {row.usedByEmail ?? "—"}
                </span>
                <span
                  className={`text-[11px] uppercase tracking-[0.08em] ${NUM_CLASS}`}
                  style={{ fontFamily: "var(--font-mono)", color: "var(--ink-faint)" }}
                >
                  {(row.usedAt ?? row.revokedAt ?? row.expiresAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
