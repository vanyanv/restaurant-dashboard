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
  UserX
} from "lucide-react"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
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
    getManagers()
  ])

  // Create assignment matrix data
  const assignmentMatrix = stores.map(store => {
    const assignedManagers = managers.filter(manager => 
      manager.managedStores.some(assignment => assignment.store.id === store.id)
    )
    return {
      store,
      assignedManagers,
      availableSlots: Math.max(0, 3 - assignedManagers.length) // Assume max 3 managers per store
    }
  })

  const unassignedManagers = managers.filter(manager => 
    manager.managedStores.length === 0
  )

  return (
    <div>
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>Manager Assignments</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Manager Assignment Center</h1>
          <p className="text-muted-foreground">
            Manage which managers are assigned to which store locations
          </p>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Stores</CardTitle>
              <Store className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stores.length}</div>
              <p className="text-xs text-muted-foreground">
                Active store locations
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Managers</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{managers.length}</div>
              <p className="text-xs text-muted-foreground">
                Available managers
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Unassigned</CardTitle>
              <UserX className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{unassignedManagers.length}</div>
              <p className="text-xs text-muted-foreground">
                Managers without assignments
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Assignments</CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {managers.reduce((total, manager) => total + manager.managedStores.length, 0)}
              </div>
              <p className="text-xs text-muted-foreground">
                Total manager-store pairs
              </p>
            </CardContent>
          </Card>
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
                        {assignedManagers.length} assigned • {availableSlots} available
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
              <p>• Go to <strong>Store Management</strong> to view individual stores</p>
              <p>• Click <strong>"View Details"</strong> on any store to see current assignments</p>
              <p>• Use the <strong>"Manage Staff"</strong> button to assign or remove managers</p>
              <p>• Create new managers from the <strong>Manager Management</strong> section</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}