import { notFound } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Masthead } from "@/components/monitoring/masthead"
import { TabStrip } from "@/components/monitoring/bridge/tab-strip"
import "@/components/monitoring/monitoring.css"

export default async function MonitoringLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)
  if (session?.user.role !== "DEVELOPER") notFound()

  const stores = await prisma.store.findMany({
    where: { accountId: session.user.accountId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local"

  return (
    <main className="px-4 lg:px-6 max-w-350 mx-auto pb-16">
      <Masthead stores={stores} commitSha={commitSha} tzLabel="PT" />
      <TabStrip />
      {children}
    </main>
  )
}
