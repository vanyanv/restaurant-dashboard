import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getStores } from "@/app/actions/store-actions"
import { getManagers } from "@/app/actions/manager-actions"
import {
  Users,
  Store,
  UserPlus,
  Building2,
  CheckCircle,
  UserX,
} from "lucide-react"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default async function AssignmentsPage() {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect("/login")
  }

  if (session.user.role !== "OWNER") {
    redirect("/dashboard")
  }

  const [stores, managers] = await Promise.all([
    getStores(),
    getManagers(),
  ])

  // Create assignment matrix data
  const assignmentMatrix = stores.map((store) => {
    const assignedManagers = managers.filter((manager) =>
      manager.managedStores.some((assignment) => assignment.store.id === store.id)
    )
    return {
      store,
      assignedManagers,
      availableSlots: Math.max(0, 3 - assignedManagers.length),
    }
  })

  const unassignedManagers = managers.filter(
    (manager) => manager.managedStores.length === 0
  )

  const totalAssignments = managers.reduce(
    (total, manager) => total + manager.managedStores.length,
    0
  )

  const kpiCards = [
    {
      label: "Total Stores",
      value: stores.length,
      icon: Store,
      borderColor: "hsl(221, 83%, 53%)",
      bgTint: "hsla(221, 83%, 53%, 0.04)",
      sub: "Active store locations",
    },
    {
      label: "Total Managers",
      value: managers.length,
      icon: Users,
      borderColor: "hsl(142, 71%, 45%)",
      bgTint: "hsla(142, 71%, 45%, 0.04)",
      sub: "Available managers",
    },
    {
      label: "Unassigned",
      value: unassignedManagers.length,
      icon: UserX,
      borderColor: "hsl(35, 85%, 45%)",
      bgTint: "hsla(35, 85%, 45%, 0.04)",
      sub: "Without assignments",
    },
    {
      label: "Active Assignments",
      value: totalAssignments,
      icon: CheckCircle,
      borderColor: "hsl(280, 70%, 50%)",
      bgTint: "hsla(280, 70%, 50%, 0.04)",
      sub: "Manager-store pairs",
    },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Sticky Header */}
      <div className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="px-3 sm:px-4 py-2 flex items-center gap-3">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-4" />
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" />
            <h1 className="text-lg font-semibold tracking-tight">Manager Assignments</h1>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-block w-1 h-1 rounded-full bg-muted-foreground/50" />
            <span>{stores.length} stores · {managers.length} managers</span>
          </div>
        </div>
      </div>

      <div className="flex-1 p-3 sm:p-4 space-y-3">
        {/* KPI Summary Cards */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpiCards.map((kpi) => (
            <Card
              key={kpi.label}
              className="relative overflow-hidden border-t-[3px] py-3"
              style={{ borderTopColor: kpi.borderColor, backgroundColor: kpi.bgTint }}
            >
              <CardContent className="p-3">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {kpi.label}
                </span>
                <div className="mt-1 font-mono-numbers text-xl font-bold tracking-tight sm:text-2xl">
                  {kpi.value}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{kpi.sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Assignment Matrix */}
        <Card>
          <CardHeader>
            <CardTitle>Store Assignment Overview</CardTitle>
            <CardDescription>
              Current manager assignments across all store locations
            </CardDescription>
          </CardHeader>
          <CardContent>
            {stores.length === 0 ? (
              <div className="text-center py-8 border-2 border-dashed border-muted-foreground/25 rounded-lg">
                <Building2 className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground">No stores available</p>
                <p className="text-sm text-muted-foreground">
                  Create stores first to manage assignments
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {assignmentMatrix.map(({ store, assignedManagers, availableSlots }) => (
                  <div key={store.id} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Store className="h-5 w-5 text-primary" />
                        <h3 className="font-semibold">{store.name}</h3>
                        <Badge variant={store.isActive ? "default" : "secondary"}>
                          {store.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {assignedManagers.length} assigned · {availableSlots} available
                      </div>
                    </div>

                    <div className="grid gap-2 md:grid-cols-3">
                      {assignedManagers.map((manager) => (
                        <div key={manager.id} className="flex items-center gap-2 p-2 bg-primary/5 rounded border">
                          <Users className="h-4 w-4 text-primary" />
                          <div className="flex-1">
                            <div className="font-medium text-sm">{manager.name}</div>
                            <div className="text-xs text-muted-foreground">{manager.email}</div>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {manager._count.reports} reports
                          </Badge>
                        </div>
                      ))}

                      {/* Show available slots */}
                      {Array.from({ length: availableSlots }).map((_, index) => (
                        <div key={`empty-${index}`} className="flex items-center gap-2 p-2 border-2 border-dashed border-muted-foreground/25 rounded">
                          <UserPlus className="h-4 w-4 text-muted-foreground" />
                          <div className="text-sm text-muted-foreground">Available slot</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Unassigned Managers */}
        {unassignedManagers.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Unassigned Managers</CardTitle>
              <CardDescription>
                Managers who are not currently assigned to any store
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {unassignedManagers.map((manager) => (
                  <div key={manager.id} className="flex items-center gap-3 p-3 border rounded-lg">
                    <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                      <Users className="h-5 w-5 text-orange-600" />
                    </div>
                    <div className="flex-1">
                      <div className="font-medium">{manager.name}</div>
                      <div className="text-sm text-muted-foreground">{manager.email}</div>
                      <Badge variant="outline" className="text-xs mt-1">
                        {manager._count.reports} reports
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Instructions */}
        <Card>
          <CardHeader>
            <CardTitle>How to Assign Managers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>· Go to <strong>Store Management</strong> to view individual stores</p>
              <p>· Click <strong>&quot;View Details&quot;</strong> on any store to see current assignments</p>
              <p>· Use the <strong>&quot;Manage Staff&quot;</strong> button to assign or remove managers</p>
              <p>· Create new managers from the <strong>Manager Management</strong> section</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
