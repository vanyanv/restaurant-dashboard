import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { TimezoneForm } from "./components/timezone-form"

export default async function PreferencesPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect("/login")

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      phone: true,
      avatarUrl: true,
      timezone: true,
    },
  })

  if (!user) redirect("/login")

  return (
    <div className="space-y-8 max-w-3xl">
      <header className="dock-in dock-in-1">
        <div className="editorial-section-label">§ 08.3</div>
        <h1 className="font-display text-[34px] italic leading-tight mt-2">
          Preferences
        </h1>
        <p className="text-[13px] text-[var(--ink-muted)] mt-2 max-w-[60ch]">
          Settings that change how the dashboard reads dates and cut-off hours.
        </p>
      </header>

      <section className="editorial-card dock-in dock-in-2 p-7">
        <div className="settings-card-header">
          <div>
            <div className="card-eyebrow">In print</div>
            <div className="card-title">Publication time zone</div>
          </div>
        </div>
        <TimezoneForm
          name={user.name}
          phone={user.phone}
          avatarUrl={user.avatarUrl}
          timezone={user.timezone}
        />
      </section>

    </div>
  )
}
