import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { StandingOrdersForm } from "./components/standing-orders-form"

export default async function NotificationsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect("/login")

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      email: true,
      notifyInvoices: true,
      notifyWeeklyReport: true,
      notifyAnomaly: true,
    },
  })

  if (!user) redirect("/login")

  return (
    <div className="space-y-8 max-w-3xl">
      <header className="dock-in dock-in-1">
        <div className="editorial-section-label">§ 08.2</div>
        <h1 className="font-display text-[34px] italic leading-tight mt-2">
          Standing Orders
        </h1>
        <p className="text-[13px] text-[var(--ink-muted)] mt-2 max-w-[60ch]">
          The subscription ledger. Tick only what should arrive at{" "}
          <span className="font-mono text-[12px] text-[var(--ink)]">
            {user.email}
          </span>
          . Orders come via email; each can be turned off independently.
        </p>
      </header>

      <section className="editorial-card dock-in dock-in-2 p-7">
        <div className="settings-card-header">
          <div>
            <div className="card-eyebrow">Subscription ledger</div>
            <div className="card-title">Your standing dispatches</div>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-faint)]">
            3 entries
          </span>
        </div>

        <StandingOrdersForm
          initial={{
            notifyInvoices: user.notifyInvoices,
            notifyWeeklyReport: user.notifyWeeklyReport,
            notifyAnomaly: user.notifyAnomaly,
          }}
        />
      </section>
    </div>
  )
}
