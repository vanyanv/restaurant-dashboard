import Link from "next/link"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { EditorialTopbar } from "../components/editorial-topbar"

export default async function CogsLandingPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (session.user.role !== "OWNER") redirect("/dashboard")

  const stores = await prisma.store.findMany({
    where: { ownerId: session.user.id, isActive: true },
    select: { id: true, name: true, targetCogsPct: true },
    orderBy: { name: "asc" },
  })

  if (stores.length === 1) redirect(`/dashboard/cogs/${stores[0].id}`)

  return (
    <div className="flex flex-col h-full">
      <EditorialTopbar section="§ 13" title="COGS" />
      <div className="flex-1 overflow-auto px-4 pb-8 pt-4 sm:px-6 sm:pt-5">
        <div className="cogs-page">
          <div className="font-label mb-3">Pick a store</div>
          <ul className="divide-y divide-(--hairline) border-t border-b border-(--hairline-bold)">
            {stores.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/dashboard/cogs/${s.id}`}
                  className="flex items-baseline justify-between py-3 hover:bg-[rgba(26,22,19,0.02)] px-2"
                >
                  <span className="font-display italic text-[18px]">
                    {s.name}
                  </span>
                  <span className="font-mono text-[11px] text-(--ink-muted)">
                    target ·{" "}
                    {s.targetCogsPct != null
                      ? `${s.targetCogsPct.toFixed(1)}%`
                      : "—"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
