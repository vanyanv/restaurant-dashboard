import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { IdentityForm } from "./components/identity-form"
import { CredentialsForm } from "./components/credentials-form"

export default async function AccountPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect("/login")

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      email: true,
      phone: true,
      timezone: true,
      avatarUrl: true,
      updatedAt: true,
    },
  })

  if (!user) redirect("/login")

  const lastUpdated = user.updatedAt.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  })

  return (
    <div className="space-y-8 max-w-3xl">
      <header className="dock-in dock-in-1 flex items-baseline justify-between gap-4">
        <div>
          <div className="editorial-section-label">§ 08.1</div>
          <h1 className="font-display text-[34px] italic leading-tight mt-2">
            Account
          </h1>
          <p className="text-[13px] text-[var(--ink-muted)] mt-2 max-w-[56ch]">
            The editor&rsquo;s file card. Identity and credentials — kept in
            two stacks so nothing in the second reaches the first.
          </p>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-faint)] hidden md:block">
          Last revision · {lastUpdated}
        </div>
      </header>

      <section className="editorial-card dock-in dock-in-2 p-7">
        <div className="settings-card-header">
          <div>
            <div className="card-eyebrow">I · Identity</div>
            <div className="card-title">Who&rsquo;s on the masthead</div>
          </div>
        </div>
        <IdentityForm
          name={user.name}
          email={user.email}
          phone={user.phone}
          timezone={user.timezone}
          avatarUrl={user.avatarUrl}
        />
      </section>

      <section className="editorial-card dock-in dock-in-3 p-7">
        <div className="settings-card-header">
          <div>
            <div className="card-eyebrow">II · Credentials</div>
            <div className="card-title">Rotate the key</div>
          </div>
        </div>
        <CredentialsForm />
      </section>
    </div>
  )
}
