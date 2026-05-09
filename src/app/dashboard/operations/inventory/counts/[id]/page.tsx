import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getCountDetail } from "@/app/actions/inventory/count-detail-actions"
import { EditorialTopbar } from "../../../../components/editorial-topbar"

interface PageProps {
  params: Promise<{ id: string }>
}

function fmtNum(n: number | null, max = 2) {
  if (n == null || !Number.isFinite(n)) return "—"
  return n.toLocaleString(undefined, { maximumFractionDigits: max })
}

function fmtSignedNum(n: number | null, max = 2) {
  if (n == null || !Number.isFinite(n)) return "—"
  const sign = n > 0 ? "+" : ""
  return `${sign}${n.toLocaleString(undefined, { maximumFractionDigits: max })}`
}

function fmtMoney(n: number) {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  })
}

function fmtSignedMoney(n: number | null) {
  if (n == null) return "—"
  const sign = n > 0 ? "+" : n < 0 ? "−" : ""
  const abs = Math.abs(n).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  })
  return `${sign}${abs}`
}

function fmtDate(d: Date | null) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export default async function CountDetailPage({ params }: PageProps) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard")

  const { id } = await params
  const result = await getCountDetail({ stockCountId: id })
  if (!result) redirect("/login")
  if (!result.ok) {
    return (
      <div className="px-6 py-10">
        <div className="inv-panel">
          <p className="text-[var(--ink-muted)]">
            {result.error === "count_not_found" ? "Count not found." : "Not authorized."}
          </p>
        </div>
      </div>
    )
  }

  const data = result.data

  return (
    <div className="flex flex-col h-full">
      <EditorialTopbar
        section="§ 06"
        title={`Count · ${data.storeName} · ${fmtDate(data.countedAt)}`}
        stamps={
          <span>
            {data.lines.length} lines · {data.linesWithDelta} with estimate
          </span>
        }
      >
        <Link
          href="/dashboard/operations/inventory/counts"
          className="font-mono text-[10px] uppercase tracking-[0.18em] hover:text-[var(--accent)]"
        >
          ← all counts
        </Link>
      </EditorialTopbar>

      <div className="px-6 py-6 space-y-6">
        <section className="inv-panel inv-panel--flush">
          <header className="inv-panel__head px-5 pt-4 pb-2 flex items-baseline justify-between">
            <span className="inv-panel__dept">Waste delta</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
              {data.linesWithDelta} of {data.lines.length} lines have an estimate
            </span>
          </header>
          <div className="grid grid-cols-2 border-t border-[var(--hairline)]">
            <div className="px-5 py-4 border-r border-[var(--hairline)]">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                Total qty delta (recipe units)
              </div>
              <div
                className={`text-[28px] tabular-nums mt-1 ${
                  Math.abs(data.totalDeltaQty) > 0.01 ? "text-[var(--accent)]" : "text-[var(--ink)]"
                }`}
                style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
              >
                {fmtSignedNum(data.totalDeltaQty)}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)] mt-1">
                positive = unexplained loss · negative = under-counted depletion
              </div>
            </div>
            <div className="px-5 py-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                Total $ impact
              </div>
              <div
                className={`text-[28px] tabular-nums mt-1 ${
                  data.totalDeltaCost > 0 ? "text-[var(--accent)]" : "text-[var(--ink)]"
                }`}
                style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
              >
                {fmtSignedMoney(data.totalDeltaCost)}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)] mt-1">
                priced via canonical cost-per-recipe-unit
              </div>
            </div>
          </div>
        </section>

        <section className="inv-panel inv-panel--flush">
          <header className="inv-panel__head px-5 pt-4 pb-2 flex items-baseline justify-between">
            <span className="inv-panel__dept">Per ingredient</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
              sorted by absolute $ impact
            </span>
          </header>
          <div className="grid grid-cols-[1fr_100px_100px_100px_120px_120px] gap-4 px-5 py-2 border-t border-[var(--hairline)] font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            <span>Ingredient</span>
            <span className="text-right">Estimated</span>
            <span className="text-right">Actual</span>
            <span className="text-right">Delta</span>
            <span className="text-right">$ impact</span>
            <span className="text-right">Unit</span>
          </div>
          {data.lines.map((line) => {
            const deltaIsNotable =
              line.deltaCost != null && Math.abs(line.deltaCost) > 1
            return (
              <div
                key={line.ingredientId}
                className="grid grid-cols-[1fr_100px_100px_100px_120px_120px] gap-4 items-center px-5 py-2 border-t border-[var(--hairline)] hover:bg-[rgba(220,38,38,0.045)] transition-colors"
              >
                <div>
                  <div className="text-[14px] text-[var(--ink)]">{line.ingredientName}</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                    {line.category}
                  </div>
                </div>
                <div
                  className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
                  style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
                >
                  {fmtNum(line.estimatedQty)}
                </div>
                <div
                  className="text-right text-[13px] tabular-nums text-[var(--ink)]"
                  style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
                >
                  {fmtNum(line.actualQty)}
                </div>
                <div
                  className={`text-right text-[13px] tabular-nums ${
                    deltaIsNotable ? "text-[var(--accent)]" : "text-[var(--ink-muted)]"
                  }`}
                  style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
                >
                  {fmtSignedNum(line.deltaQty)}
                </div>
                <div
                  className={`text-right text-[13px] tabular-nums ${
                    deltaIsNotable ? "text-[var(--accent)]" : "text-[var(--ink-muted)]"
                  }`}
                  style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
                >
                  {line.costPerRecipeUnit != null ? fmtSignedMoney(line.deltaCost) : "no $"}
                </div>
                <div className="text-right font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                  {line.recipeUnit ?? "—"}
                </div>
              </div>
            )
          })}
        </section>

        {data.note && (
          <section className="inv-panel inv-panel--flush">
            <header className="inv-panel__head px-5 pt-4 pb-2">
              <span className="inv-panel__dept">Note</span>
            </header>
            <div className="px-5 py-4 text-[var(--ink-muted)]">{data.note}</div>
          </section>
        )}
      </div>
    </div>
  )
}
