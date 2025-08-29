import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getStoreManagers } from "@/app/actions/manager-actions"
import { DailyReportForm } from "./components/daily-report-form"
import { ManagerLogoutButton } from "./components/manager-logout-button"

export default async function ManagerReportPage() {
  const session = await getServerSession(authOptions)
  
  if (!session || session.user.role !== "MANAGER") {
    redirect("/login")
  }

  // Get the manager's assigned stores
  // We'll need to create a new action for this
  // For now, let's assume they have at least one store assignment
  
  return (
    <div className="container mx-auto px-4 py-6 max-w-md">
      <div className="flex items-center justify-between mb-6">
        <div className="text-center flex-1">
          <h1 className="text-2xl font-bold text-foreground">Daily Report</h1>
          <p className="text-muted-foreground">Welcome, {session.user.name}</p>
        </div>
        <ManagerLogoutButton />
      </div>
      
      <DailyReportForm managerId={session.user.id} managerName={session.user.name} />
    </div>
  )
}