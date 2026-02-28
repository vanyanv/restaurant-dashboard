import { cookies } from "next/headers"
import { AppSidebarClient } from "@/components/app-sidebar-client"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const defaultPinned = cookieStore.get("sidebar_state")?.value === "true"

  return (
    <SidebarProvider defaultOpen={defaultPinned}>
      <AppSidebarClient />
      <SidebarInset>
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}
