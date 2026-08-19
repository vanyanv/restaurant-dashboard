import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getStores } from "@/app/actions/store-actions"
import { getDecisionsView } from "@/app/actions/decisions/get-decisions-view"
import { EditorialTopbar } from "../components/editorial-topbar"
import { DecisionsStorePicker } from "./components/decisions-store-picker"
import { DecisionWeekCalendar } from "./components/decision-week-calendar"
import { DecisionBriefing } from "./components/decision-briefing"
import { DecisionVerdict } from "./components/decision-verdict"
import { ActionRow } from "./components/action-row"
import { ForecastScorecard } from "./components/forecast-scorecard"
import { DecisionLedger } from "./components/decision-ledger"
import { ConfidenceDots } from "./components/confidence-dots"
import "./decisions.css"

interface PageProps {
  searchParams: Promise<{ storeId?: string }>
}

export default async function DecisionsPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard")

  const params = await searchParams
  const storeId: string | undefined = params.storeId

  const [stores, result] = await Promise.all([
    getStores(),
    getDecisionsView({ storeId }),
  ])

  if (stores.length === 0) {
    return (
      <div className="px-6 py-10">
        <div className="inv-panel decisions-empty">
          No stores configured yet. Create a store to start seeing decisions.
        </div>
      </div>
    )
  }

  if (storeId && !stores.some((s) => s.id === storeId)) {
    redirect("/dashboard/decisions")
  }

  if (!result.ok) {
    return (
      <div className="px-6 py-10">
        <div className="inv-panel decisions-empty">
          We couldn&apos;t load this view right now. Try refreshing in a moment.
        </div>
      </div>
    )
  }

  const data = result.data

  return (
    <div className="flex flex-col h-full">
      <EditorialTopbar
        section="§ 07"
        title={`Decisions · ${data.storeName}`}
        stamps={
          <span className="inline-flex items-center gap-2">
            7-day outlook
            <ConfidenceDots count={data.confidence} label="Forecast confidence" />
          </span>
        }
      >
        <DecisionsStorePicker
          stores={stores.map((s) => ({ id: s.id, name: s.name }))}
          selectedStoreId={storeId}
        />
      </EditorialTopbar>

      <div className="decisions-page">
        {/* Act I. The page used to open with three panels at equal weight and
            no reading order; hierarchy is verdict -> week -> actions. */}
        <DecisionVerdict
          line={data.verdict.line}
          sources={data.verdict.sources}
          vitals={data.vitals}
        />

        {data.days.length === 0 ? (
          <div className="inv-panel decisions-empty">
            We don&apos;t have a forecast for this week yet. New stores need a
            few days of orders before predictions begin.
          </div>
        ) : (
          <DecisionWeekCalendar days={data.days} storeName={data.storeName} />
        )}

        {/* What the verdict didn't absorb. Absent entirely when it took the lot. */}
        {data.briefing.length > 0 ? (
          <DecisionBriefing lines={data.briefing} storeName={data.storeName} />
        ) : null}

        <section aria-label="Actions to consider">
          <header className="decisions-section-head">
            <h2 className="decisions-section-head__title">
              <em>What to do this week</em>
            </h2>
            <span className="decisions-section-head__meta">
              {data.actions.length === 0
                ? "no actions queued"
                : `top ${data.actions.length}`}
            </span>
          </header>

          {data.actions.length === 0 ? (
            <div className="inv-panel decisions-empty">
              No action recommendations queued for this week. Nothing urgent —
              keep an eye on the calendar above.
            </div>
          ) : (
            <>
              {/* Five cards each said "+$X/wk" and never added up. */}
              <div className="decisions-pot">
                <div>
                  <span className="decisions-pot__label">This week&apos;s pot</span>
                  <span className="decisions-pot__amt">
                    {data.potUsdPerWeek.toLocaleString(undefined, {
                      style: "currency",
                      currency: "USD",
                      maximumFractionDigits: 0,
                    })}
                  </span>
                </div>
                <span className="decisions-pot__meta">
                  across {data.actions.length} action
                  {data.actions.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="decisions-led">
                {data.actions.map((action, i) => (
                  <ActionRow
                    key={action.id}
                    action={action}
                    rank={i + 1}
                    asOf={data.asOf}
                  />
                ))}
              </div>
            </>
          )}
        </section>

        {/* What was already decided, and what came of it. */}
        <DecisionLedger decisions={data.decisions} />

        {/* The forecast's own track record, shown last and shown honestly. */}
        {data.scorecard ? <ForecastScorecard scorecard={data.scorecard} /> : null}
      </div>
    </div>
  )
}
