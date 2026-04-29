import Link from "next/link"
import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getStores } from "@/app/actions/store-actions"
import { PageHead } from "@/components/mobile/page-head"
import { Panel } from "@/components/mobile/panel"

export const dynamic = "force-dynamic"

export default async function MobileStoresPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const stores = await getStores()

  return (
    <>
      <PageHead
        dept="PORTFOLIO"
        title="Stores"
        sub={`${stores.length} active`}
      />
      <div className="dock-in dock-in-2">
        <Panel flush>
          {stores.length === 0 ? (
            <div className="m-empty m-empty--flush">
              <strong>No stores yet.</strong> Create one on desktop to begin.
            </div>
          ) : (
            stores.map((s) => (
              <Link
                key={s.id}
                href={`/dashboard/stores`}
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
                      fontSize: 10,
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      color: "var(--ink-faint)",
                    }}
                  >
                    {s.address ? s.address.toString().slice(0, 28) : "—"}
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
    </>
  )
}
