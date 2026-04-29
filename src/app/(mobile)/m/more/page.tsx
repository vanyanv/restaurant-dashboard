import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getMoreForRole } from "@/lib/mobile/tabs"
import { PageHead } from "@/components/mobile/page-head"
import { Panel } from "@/components/mobile/panel"
import { SectionList } from "@/components/mobile/section-list"
import { SwitchToDesktopButton } from "./switch-to-desktop"

export const dynamic = "force-dynamic"

export default async function MobileMorePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sections = getMoreForRole(session.user.role)

  return (
    <>
      <PageHead dept="MORE" title="All sections" />

      <div className="dock-in dock-in-2">
        <Panel flush>
          <SectionList sections={sections} />
        </Panel>
      </div>

      <div className="dock-in dock-in-3" style={{ marginTop: 14 }}>
        <Panel dept="VIEW" title="Switch surface">
          <p
            style={{
              fontSize: 13,
              color: "var(--ink-muted)",
              lineHeight: 1.6,
              margin: "0 0 12px",
            }}
          >
            Mobile is the default for this device. Switch to the desktop view
            for heavy editing — recipes, ingredient pricing, menu builder.
          </p>
          <SwitchToDesktopButton />
        </Panel>
      </div>
    </>
  )
}
