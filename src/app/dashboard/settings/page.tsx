import Link from "next/link"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export default async function SettingsMastheadPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect("/login")

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      email: true,
      role: true,
      createdAt: true,
      avatarUrl: true,
      _count: {
        select: {
          ownedStores: true,
          invoices: true,
          recipes: true,
        },
      },
    },
  })

  if (!user) redirect("/login")

  const initials = deriveInitials(user.name)
  const memberSince = user.createdAt.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  })

  const folios: Array<{
    index: string
    title: string
    description: string
    href: string
  }> = [
    {
      index: "§ 08.1",
      title: "Account",
      description:
        "Edit identity — name, contact, timezone, avatar — and rotate your password.",
      href: "/dashboard/settings/account",
    },
    {
      index: "§ 08.2",
      title: "Standing Orders",
      description:
        "Decide which dispatches land in your inbox: invoice arrivals, the weekly report, anomaly alerts.",
      href: "/dashboard/settings/notifications",
    },
    {
      index: "§ 08.3",
      title: "Preferences",
      description:
        "Timezone and a short list of settings still awaiting their issue — theme, date format, default store.",
      href: "/dashboard/settings/preferences",
    },
  ]

  return (
    <div className="space-y-10">
      <section className="settings-masthead-grid dock-in dock-in-1">
        <div className="flex items-start gap-6">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.name}
              className="settings-masthead-monogram object-cover"
            />
          ) : (
            <div
              className="settings-masthead-monogram"
              aria-label={`${user.name} monogram`}
            >
              {initials}
            </div>
          )}
          <div className="settings-owner-meta">
            <div className="owner-issue">Vol. 01 · The Editor</div>
            <div className="owner-name">{user.name}</div>
            <div className="owner-email">{user.email}</div>
            <div className="owner-stamp">
              {user.role.toLowerCase()} · since {memberSince}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="editorial-section-label">The cabinet</div>
          {folios.map((folio) => (
            <Link
              key={folio.href}
              href={folio.href}
              className="settings-folio-card dock-in dock-in-2"
            >
              <span className="folio-index">{folio.index}</span>
              <div>
                <div className="folio-title">{folio.title}</div>
                <div className="folio-description">{folio.description}</div>
              </div>
              <span className="folio-chevron" aria-hidden="true">
                →
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="settings-masthead-counts dock-in dock-in-3">
        <div className="count-cell">
          <div className="count-label">Stores under ownership</div>
          <div className="count-value">
            {formatCount(user._count.ownedStores)}
          </div>
        </div>
        <div className="count-cell">
          <div className="count-label">Invoices archived</div>
          <div className="count-value">
            {formatCount(user._count.invoices)}
          </div>
        </div>
        <div className="count-cell">
          <div className="count-label">Recipes catalogued</div>
          <div className="count-value">
            {formatCount(user._count.recipes)}
          </div>
        </div>
      </section>
    </div>
  )
}

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return "·"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatCount(n: number): string {
  return n.toLocaleString("en-US")
}
