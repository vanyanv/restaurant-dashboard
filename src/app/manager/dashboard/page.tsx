import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { ManagerDashboardContent } from "./components/manager-dashboard-content"
import { ManagerSidebar } from "../components/manager-sidebar"

export default async function ManagerDashboardPage() {
  const session = await getServerSession(authOptions)
  
  if (!session || session.user.role !== "MANAGER") {
    redirect("/login")
  }

  return (
    <div className="flex min-h-screen">
      <ManagerSidebar />
      <div className="flex-1 container mx-auto px-4 py-6 max-w-7xl md:ml-0">
        <div className="mb-6 pt-12 md:pt-0">
          <h1 className="text-3xl font-bold text-foreground">Manager Dashboard</h1>
          <p className="text-muted-foreground">Welcome back, {session.user.name}</p>
        </div>
        
        <ManagerDashboardContent managerId={session.user.id} />
      </div>
    </div>
  )
}