import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { TimezoneForm } from "./components/timezone-form"

const PLACEHOLDERS: Array<{ title: string; description: string }> = [
  {
    title: "Palette & typeface",
    description:
      "The editorial theme — cream paper, Fraunces display, red accent — is the house style and fixed for this issue.",
  },
  {
    title: "Date format",
    description:
      "Medium English dates are used throughout. Regional formats appear in a later printing.",
  },
  {
    title: "Default store",
    description:
      "Every dashboard currently opens to all stores. A default per-editor selector is planned.",
  },
]

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
          What&rsquo;s in print today, and a short list of what&rsquo;s been set
          for a future issue.
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

      <section className="editorial-card dock-in dock-in-3 p-7">
        <div className="settings-card-header">
          <div>
            <div className="card-eyebrow">Awaiting printing</div>
            <div className="card-title">Set for the next issue</div>
          </div>
          <span className="editorial-next-issue-stamp">Next issue</span>
        </div>

        <div>
          {PLACEHOLDERS.map((row) => (
            <div key={row.title} className="placeholder-row">
              <div>
                <div className="placeholder-title">{row.title}</div>
                <div className="placeholder-desc">{row.description}</div>
              </div>
              <span className="editorial-next-issue-stamp">Pending</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
