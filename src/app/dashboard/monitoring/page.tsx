import { Masthead } from "@/components/monitoring/masthead"
import { FrontPageLede } from "@/components/monitoring/front-page-lede"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import "@/components/monitoring/monitoring.css"

export const dynamic = "force-dynamic"

export default async function MonitoringPage() {
  const session = await getServerSession(authOptions)

  const stores = await prisma.store.findMany({
    where: { accountId: session!.user.accountId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local"
  const tzLabel = "PT"

  return (
    <main className="px-6 max-w-275 mx-auto pb-16">
      <Masthead stores={stores} commitSha={commitSha} tzLabel={tzLabel} />
      <FrontPageLede />
      <div className="space-y-6">
        <PanelPlaceholder label="SYNCS" />
        <PanelPlaceholder label="ERRORS" />
        <PanelPlaceholder label="AI SPEND" />
        <PanelPlaceholder label="CHAT" />
        <PanelPlaceholder label="DATABASE" />
        <PanelPlaceholder label="CACHE" />
      </div>
    </main>
  )
}

function PanelPlaceholder({ label }: { label: string }) {
  return (
    <section className="inv-panel">
      <div className="inv-panel__head">
        <span className="inv-panel__dept">{label}</span>
      </div>
      <p
        className="font-mono uppercase tracking-[0.12em] text-[10px] text-(--ink-faint) mt-3"
      >
        — phase 7b will land this panel —
      </p>
    </section>
  )
}
