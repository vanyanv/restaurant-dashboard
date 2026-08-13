import { cookies } from "next/headers"
import { getServerSession } from "next-auth"
import { Fraunces } from "next/font/google"
import { AppSidebarClient } from "@/components/app-sidebar-client"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { ChatDrawerProvider } from "@/components/chat/chat-drawer-context"
import { ChatDrawerClient } from "@/components/chat/chat-drawer-client"
import { WelcomeMarquee } from "@/components/dashboard/welcome-marquee"
import { PageViewTracker } from "@/components/telemetry/page-view-tracker"
import { authOptions } from "@/lib/auth"
import { consumePendingWelcome } from "@/lib/welcome"
import "@/styles/editorial-tokens.css"
import "@/styles/editorial-dashboard.css"
import "@/styles/welcome-marquee.css"

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"],
})

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const defaultPinned = cookieStore.get("sidebar_state")?.value === "true"

  const session = await getServerSession(authOptions)
  const trackViews =
    session?.user?.id != null &&
    (session.user.role !== "DEVELOPER" ||
      process.env.TRACK_DEVELOPER_PAGE_VIEWS === "1")
  const firstName = session?.user?.firstName ?? null
  const showWelcome =
    session?.user?.id != null &&
    firstName != null &&
    (await consumePendingWelcome(session.user.id))

  return (
    <div className={`${fraunces.variable} editorial-surface`}>
      <ChatDrawerProvider>
        <PageViewTracker enabled={trackViews} />
        <SidebarProvider defaultOpen={defaultPinned}>
          <AppSidebarClient />
          {/* min-w-0 lets the inset shrink beside the fixed rail — without it the
              non-wrapping topbar sets min-content width and the whole page
              overflows the viewport by the rail's 48px */}
          <SidebarInset className="min-w-0">
            {showWelcome && firstName ? (
              <WelcomeMarquee firstName={firstName} />
            ) : null}
            {children}
          </SidebarInset>
        </SidebarProvider>
        <ChatDrawerClient />
      </ChatDrawerProvider>
    </div>
  )
}
