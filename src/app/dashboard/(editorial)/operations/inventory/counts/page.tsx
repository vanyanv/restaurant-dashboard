import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getStores } from "@/app/actions/store-actions"
import { listStockCounts } from "@/app/actions/inventory/stock-count-actions"
import { EditorialTopbar } from "../../../components/editorial-topbar"

interface PageProps {
  searchParams: Promise<{ storeId?: string }>
}

function fmtDate(d: Date | null) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

const STATUS_LABEL: Record<string, string> = {
  IN_PROGRESS: "IN PROGRESS",
  COMPLETED: "COMPLETED",
  ABANDONED: "ABANDONED",
}

export default async function StockCountsListPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard")

  const params = await searchParams
  const stores = await getStores()
  const storeFilter = params.storeId

  const counts = (await listStockCounts({ storeId: storeFilter, limit: 100 })) ?? []
  const storeNameById = new Map(stores.map((s) => [s.id, s.name]))

  return (
    <div className="flex flex-col h-full">
      <EditorialTopbar
        section="§ 06"
        title="Stock counts"
        stamps={
          <span>
            {counts.length} {counts.length === 1 ? "count" : "counts"}
          </span>
        }
      >
        <Link
          href="/dashboard/operations/inventory/count/new"
          className="font-mono text-[10px] uppercase tracking-[0.18em] border border-[var(--hairline-bold)] px-3 py-1.5 rounded-[2px] hover:bg-[var(--row-hover-bg)] hover:text-[var(--accent)]"
        >
          Start count
        </Link>
      </EditorialTopbar>

      <div className="px-6 py-6">
        <section className="inv-panel inv-panel--flush">
          <div className="grid grid-cols-[140px_1fr_140px_120px_120px] gap-4 px-5 py-2 border-b border-[var(--hairline)] font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            <span>Counted</span>
            <span>Store</span>
            <span>Status</span>
            <span>Completed</span>
            <span className="text-right">Detail</span>
          </div>
          {counts.length === 0 ? (
            <div className="px-5 py-6 text-[var(--ink-muted)]">
              No counts yet. Start one to anchor the inventory model.
            </div>
          ) : (
            counts.map((c) => (
              <Link
                key={c.id}
                href={`/dashboard/operations/inventory/counts/${c.id}`}
                className="grid grid-cols-[140px_1fr_140px_120px_120px] gap-4 items-center px-5 py-3 border-t border-[var(--hairline)] hover:bg-[var(--row-hover-bg)] transition-colors"
              >
                <span className="font-mono text-[12px] text-[var(--ink)]">
                  {fmtDate(c.countedAt)}
                </span>
                <span className="text-[14px] text-[var(--ink)]">
                  {storeNameById.get(c.storeId) ?? c.storeId}
                </span>
                <span
                  className={`font-mono text-[10px] uppercase tracking-[0.18em] ${
                    c.status === "IN_PROGRESS"
                      ? "text-[var(--accent)]"
                      : "text-[var(--ink-muted)]"
                  }`}
                >
                  {STATUS_LABEL[c.status] ?? c.status}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                  {fmtDate(c.completedAt)}
                </span>
                <span className="text-right font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)] hover:text-[var(--accent)]">
                  open →
                </span>
              </Link>
            ))
          )}
        </section>
      </div>
    </div>
  )
}
