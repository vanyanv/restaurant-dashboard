import Link from "next/link"
import { loadMenuEngineering } from "./data"

function money(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
}

/**
 * The honesty strip: how much revenue the numbers above did NOT see.
 * UNMAPPED items cost $0 until mapped, so every dollar here means the page
 * understates food cost. Links straight to the recipes mapping loop.
 */
export async function CoverageSection({
  storeId,
  days,
}: {
  storeId?: string
  days: number
}) {
  const result = await loadMenuEngineering(storeId, days)
  if (!result?.ok) {
    return (
      <section className="inv-panel dock-in dock-in-4" data-testid="coverage-strip">
        <div className="inv-panel__head">
          <div>
            <span className="inv-panel__dept">§ 14 Menu</span>
            <h2 className="inv-panel__title">Data coverage</h2>
          </div>
        </div>
        <p className="pt-2 text-[13px] text-[var(--ink-muted)]">
          We couldn&apos;t load this section right now. Try refreshing in a
          moment.
        </p>
      </section>
    )
  }
  const { coverage } = result.data

  const gap = coverage.unmappedRevenue + coverage.missingCostRevenue
  const clean = gap < 1 && coverage.partialCostRevenue < 1

  return (
    <section className="inv-panel dock-in dock-in-4" data-testid="coverage-strip">
      <div className="inv-panel__head">
        <div>
          <span className="inv-panel__dept">§ 14 Menu</span>
          <h2 className="inv-panel__title">Data coverage</h2>
        </div>
        <span
          className="text-[15px] font-semibold text-[var(--ink)]"
          style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
        >
          {coverage.coveragePct.toFixed(1)}% costed
        </span>
      </div>

      {clean ? (
        <p className="text-[13px] leading-relaxed text-[var(--ink-muted)]">
          Every dollar sold in this window is backed by a costed recipe. The
          margins above are the real picture.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {coverage.unmappedRevenue >= 1 && (
            <p className="text-[13px] leading-relaxed text-[var(--ink)]">
              <span
                className="font-semibold"
                style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
              >
                {money(coverage.unmappedRevenue)}
              </span>{" "}
              of sales has no recipe yet — its food cost reads $0, so margins
              above are overstated.{" "}
              <Link
                href="/dashboard/recipes?filter=unbuilt"
                className="underline decoration-[var(--hairline-bold)] underline-offset-2 hover:decoration-[var(--ink)]"
              >
                Map those items
              </Link>
              , or use the AI proposals button there for new combos.
            </p>
          )}
          {coverage.missingCostRevenue >= 1 && (
            <p className="text-[13px] leading-relaxed text-[var(--ink-muted)]">
              {money(coverage.missingCostRevenue)} sold on recipes that walk to
              $0 — their ingredients need costs.
            </p>
          )}
          {coverage.partialCostRevenue >= 1 && (
            <p className="text-[13px] leading-relaxed text-[var(--ink-muted)]">
              {money(coverage.partialCostRevenue)} of costed sales carries a
              partial cost (an ingredient price is missing or was
              guard-rejected) — those margins are slight overstatements.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
