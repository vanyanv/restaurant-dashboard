import Link from "next/link"
import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { StockCountStatus } from "@/generated/prisma/client"
import { PageHead } from "@/components/mobile/page-head"
import { Panel } from "@/components/mobile/panel"
import { CountFlow, type CountIngredient } from "./count-flow"
import { StartSessionForm } from "./start-session-form"

export const dynamic = "force-dynamic"

export default async function MobileCountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/m")

  const sp = await searchParams
  const requestedSessionId = sp.session && sp.session !== "" ? sp.session : null
  const accountId = session.user.accountId

  const stores = await prisma.store.findMany({
    where: { accountId, isActive: true },
    select: { id: true, name: true },
    orderBy: { createdAt: "desc" },
  })
  if (stores.length === 0) {
    return (
      <div>
        <PageHead dept="OPERATIONS" title="Stock count" sub="No stores yet" />
        <div className="inv-panel inv-panel--empty">
          Create a store before opening a count session.
        </div>
      </div>
    )
  }

  if (requestedSessionId) {
    return (
      <SessionView sessionId={requestedSessionId} accountId={accountId} />
    )
  }

  // Landing — open sessions + start new.
  const openSessions = await prisma.stockCount.findMany({
    where: {
      status: StockCountStatus.IN_PROGRESS,
      store: { accountId },
    },
    select: {
      id: true,
      startedAt: true,
      store: { select: { id: true, name: true } },
      _count: { select: { lines: true } },
    },
    orderBy: { startedAt: "desc" },
    take: 5,
  })

  return (
    <div data-perf-ready="/m/count">
      <PageHead
        dept="OPERATIONS · § COUNTS"
        title="Stock count"
        sub={
          sp.done === "1"
            ? "Last session completed"
            : "Walk the cooler and record what you see"
        }
      />

      {openSessions.length > 0 ? (
        <Panel dept="RESUME · OPEN SESSIONS">
          {openSessions.map((s) => (
            <Link
              key={s.id}
              href={`/m/count?session=${s.id}`}
              className="inv-row m-count-resume"
              style={{
                gridTemplateColumns:
                  "[rule] 8px [name] minmax(0, 1fr) [meta] auto",
                gap: 12,
                padding: "12px 4px",
                textDecoration: "none",
              }}
            >
              <div />
              <div style={{ minWidth: 0 }}>
                <div className="inv-row__vendor-name">{s.store.name}</div>
                <div
                  style={{
                    fontFamily:
                      "var(--font-jetbrains-mono), ui-monospace, monospace",
                    fontSize: 9.5,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "var(--ink-faint)",
                    marginTop: 4,
                    fontVariantNumeric: "tabular-nums lining-nums",
                  }}
                >
                  started {s.startedAt.toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}{" "}
                  · {s._count.lines} line{s._count.lines === 1 ? "" : "s"}
                </div>
              </div>
              <div className="inv-row__total">resume</div>
            </Link>
          ))}
        </Panel>
      ) : null}

      <div style={{ marginTop: 14 }}>
        <Panel dept="START NEW · COUNT SESSION">
          <StartSessionForm stores={stores} defaultStoreId={stores[0].id} />
        </Panel>
      </div>

      <div style={{ marginTop: 14 }}>
        <Panel dept="HOW IT WORKS">
          <ol className="m-count-howto">
            <li>Pick a store and start a session.</li>
            <li>
              Walk the cooler. Tap each ingredient&apos;s qty on the keypad and
              save.
            </li>
            <li>
              Counted zero of something? You&apos;ll be prompted to log
              theft / expiry / damage / supplier return.
            </li>
            <li>When every ingredient is counted or skipped, complete the session.</li>
          </ol>
        </Panel>
      </div>
    </div>
  )
}

async function SessionView({
  sessionId,
  accountId,
}: {
  sessionId: string
  accountId: string
}) {
  const stockCount = await prisma.stockCount.findFirst({
    where: { id: sessionId, store: { accountId } },
    select: {
      id: true,
      status: true,
      storeId: true,
      store: { select: { id: true, name: true } },
      lines: {
        select: { canonicalIngredientId: true, qtyInRecipeUnit: true },
      },
    },
  })

  if (!stockCount) {
    return (
      <div>
        <PageHead
          dept="OPERATIONS · § COUNTS"
          title="Session not found"
          sub="It may have been completed or abandoned"
        />
        <div className="inv-panel inv-panel--empty">
          <Link href="/m/count" className="m-count-link">
            ← Back to stock count
          </Link>
        </div>
      </div>
    )
  }

  if (stockCount.status !== StockCountStatus.IN_PROGRESS) {
    return (
      <div>
        <PageHead
          dept="OPERATIONS · § COUNTS"
          title={`Session ${stockCount.status.toLowerCase().replace("_", " ")}`}
          sub={stockCount.store.name}
        />
        <div className="inv-panel inv-panel--empty">
          This session is no longer editable.{" "}
          <Link href="/m/count" className="m-count-link">
            Start a new one
          </Link>
          .
        </div>
      </div>
    )
  }

  const ingredients = await prisma.canonicalIngredient.findMany({
    where: { accountId },
    select: {
      id: true,
      name: true,
      category: true,
      recipeUnit: true,
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  })

  const list: CountIngredient[] = ingredients.map((i) => ({
    id: i.id,
    name: i.name,
    category: i.category,
    recipeUnit: i.recipeUnit,
  }))

  return (
    <div data-perf-ready="/m/count" data-session={sessionId}>
      <PageHead
        dept="OPERATIONS · § COUNTS"
        title="Counting"
        sub={`${stockCount.store.name} · ${list.length} ingredient${list.length === 1 ? "" : "s"}`}
      />
      <CountFlow
        sessionId={stockCount.id}
        storeId={stockCount.storeId}
        storeName={stockCount.store.name}
        ingredients={list}
        initialLines={stockCount.lines.map((l) => ({
          ingredientId: l.canonicalIngredientId,
          qty: l.qtyInRecipeUnit,
        }))}
      />
    </div>
  )
}
