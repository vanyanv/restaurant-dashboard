import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { DailyReportForm } from "./components/daily-report-form"
import { ManagerSidebar } from "../components/manager-sidebar"

export default async function ManagerReportPage() {
  const session = await getServerSession(authOptions)
  
  if (!session || session.user.role !== "MANAGER") {
    redirect("/login")
  }

  // Get the manager's assigned stores
  // We'll need to create a new action for this
  // For now, let's assume they have at least one store assignment
  
  return (
    <div className="flex min-h-screen">
      <ManagerSidebar />
      <div className="flex-1 container mx-auto px-4 py-6 max-w-2xl md:ml-0">
        <div className="mb-6 pt-12 md:pt-0">
          <h1 className="text-2xl font-bold text-foreground">Daily Report</h1>
          <p className="text-muted-foreground">Welcome, {session.user.name}</p>
        </div>
        
        <DailyReportForm managerId={session.user.id} managerName={session.user.name} />
      </div>
    </div>
  )
}