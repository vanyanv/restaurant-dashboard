import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { authOptions } from "@/lib/auth"
import { PageHead } from "@/components/mobile/page-head"
import { Panel } from "@/components/mobile/panel"
import { SectionList } from "@/components/mobile/section-list"

export const dynamic = "force-dynamic"

export default async function MobileSettingsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  return (
    <>
      <PageHead
        dept="ACCOUNT"
        title="Settings"
        sub={session.user.email ?? undefined}
      />

      <div className="dock-in dock-in-2">
        <Panel dept="PROFILE" title={session.user.name ?? "Operator"}>
          <p
            style={{
              fontSize: 13,
              color: "var(--ink-muted)",
              lineHeight: 1.6,
              margin: "0 0 12px",
            }}
          >
            Profile, password, and notification preferences are edited on
            desktop. Mobile shows the active values only.
          </p>
          <Link
            href="/dashboard/settings"
            prefetch={false}
            className="toolbar-btn"
            style={{ display: "inline-block" }}
          >
            Open on desktop →
          </Link>
        </Panel>
      </div>

      <div className="dock-in dock-in-3" style={{ marginTop: 14 }}>
        <Panel flush>
          <SectionList
            sections={[
              { href: "/api/auth/signout", label: "Sign out", dept: "SESSION" },
            ]}
          />
        </Panel>
      </div>
    </>
  )
}
