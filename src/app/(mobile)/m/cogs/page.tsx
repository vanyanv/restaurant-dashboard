import Link from "next/link"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { PageHead } from "@/components/mobile/page-head"
import { Panel } from "@/components/mobile/panel"

export const dynamic = "force-dynamic"

export default async function MobileCogsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (session.user.role !== "OWNER") redirect("/m")

  const stores = await prisma.store.findMany({
    where: { accountId: session.user.accountId, isActive: true },
    select: { id: true, name: true, targetCogsPct: true },
    orderBy: { name: "asc" },
  })

  return (
    <>
      <PageHead
        dept="COSTS · § 13"
        title="COGS"
        sub={`${stores.length} ${stores.length === 1 ? "store" : "stores"} · pick one`}
      />

      <div className="dock-in dock-in-2">
        <Panel flush>
          {stores.length === 0 ? (
            <div className="m-empty m-empty--flush">
              <strong>No active stores.</strong>
            </div>
          ) : (
            stores.map((s) => (
              <Link
                key={s.id}
                href={`/dashboard/cogs/${s.id}`}
                prefetch={false}
                className="inv-row"
                style={{
                  gridTemplateColumns: "1fr auto",
                  gap: 14,
                  padding: "16px 18px",
                }}
              >
                <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="inv-row__vendor-name">{s.name}</span>
                  <span
                    style={{
                      fontFamily:
                        "var(--font-jetbrains-mono), ui-monospace, monospace",
                      fontSize: 9.5,
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      color: "var(--ink-faint)",
                    }}
                  >
                    Target ·{" "}
                    {s.targetCogsPct != null
                      ? `${s.targetCogsPct.toFixed(1)}%`
                      : "not set"}
                  </span>
                </span>
                <span className="m-section-row__chev" aria-hidden>
                  ›
                </span>
              </Link>
            ))
          )}
        </Panel>
      </div>

      <div className="dock-in dock-in-3" style={{ marginTop: 14 }}>
        <div className="m-readonly-note">
          Mobile shows summaries · the per-store ledger is on desktop
        </div>
      </div>
    </>
  )
}
