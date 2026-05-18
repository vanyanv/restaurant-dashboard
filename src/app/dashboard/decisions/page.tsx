import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getStores } from "@/app/actions/store-actions"
import { getDecisionsView } from "@/app/actions/decisions/get-decisions-view"
import { EditorialTopbar } from "../components/editorial-topbar"
import { DecisionsStorePicker } from "./components/decisions-store-picker"
import { DecisionWeekCalendar } from "./components/decision-week-calendar"
import { DecisionBriefing } from "./components/decision-briefing"
import { ActionCard } from "./components/action-card"
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
        {data.days.length === 0 ? (
          <div className="inv-panel decisions-empty">
            We don&apos;t have a forecast for this week yet. New stores need a
            few days of orders before predictions begin.
          </div>
        ) : (
          <DecisionWeekCalendar days={data.days} storeName={data.storeName} />
        )}

        <DecisionBriefing lines={data.briefing} storeName={data.storeName} />

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
            <div className="decisions-actions-grid">
              {data.actions.map((action) => (
                <ActionCard key={action.id} action={action} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
