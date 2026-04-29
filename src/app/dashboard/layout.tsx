import { cookies } from "next/headers"
import { Fraunces } from "next/font/google"
import { AppSidebarClient } from "@/components/app-sidebar-client"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { ChatDrawerProvider } from "@/components/chat/chat-drawer-context"
import { ChatDrawer } from "@/components/chat/chat-drawer"
import "@/styles/editorial.css"
import "@/components/chat/chat.css"

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

  return (
    <div className={`${fraunces.variable} editorial-surface`}>
      <ChatDrawerProvider>
        <SidebarProvider defaultOpen={defaultPinned}>
          <AppSidebarClient />
          <SidebarInset>{children}</SidebarInset>
        </SidebarProvider>
        <ChatDrawer />
      </ChatDrawerProvider>
    </div>
  )
}
