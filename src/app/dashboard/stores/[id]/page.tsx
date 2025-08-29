import { getServerSession } from "next-auth"
import { redirect, notFound } from "next/navigation"
import Link from "next/link"
import { authOptions } from "@/lib/auth"
import { getStoreById, getStores } from "@/app/actions/store-actions"
import { getStoreManagers } from "@/app/actions/manager-actions"
import { 
  Store, 
  MapPin, 
  Phone, 
  Users, 
  BarChart3, 
  Edit, 
  ArrowLeft,
  CheckCircle,
  XCircle,
  Calendar,
  Mail,
  UserX
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { StoreSelector } from "@/components/store-selector"
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

interface PageProps {
  params: {
    id: string
  }
}

export default async function StoreDetailPage({ params }: PageProps) {
  const session = await getServerSession(authOptions)
  
  if (!session) {
    redirect("/login")
  }

  const [store, allStores, storeManagers] = await Promise.all([
    getStoreById(params.id),
    getStores(),
    getStoreManagers(params.id)
  ])

  if (!store) {
    notFound()
  }

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
                <BreadcrumbLink href="/dashboard/stores">Stores</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{store.name}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        {/* Header with Store Selector and Actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard/stores">
              <Button variant="outline" size="icon">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <StoreSelector stores={allStores} currentStoreId={store.id} />
          </div>
          {session.user.role === "OWNER" && (
            <Link href={`/dashboard/stores/${store.id}/edit`}>
              <Button>
                <Edit className="mr-2 h-4 w-4" />
                Edit Store
              </Button>
            </Link>
          )}
        </div>

        {/* Store Information Header */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-primary/10 rounded-lg flex items-center justify-center">
                  <Store className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-2xl">{store.name}</CardTitle>
                  <CardDescription className="flex items-center gap-4 mt-1">
                    {store.address && (
                      <div className="flex items-center gap-1">
                        <MapPin className="h-4 w-4" />
                        {store.address}
                      </div>
                    )}
                    {store.phone && (
                      <div className="flex items-center gap-1">
                        <Phone className="h-4 w-4" />
                        {store.phone}
                      </div>
                    )}
                  </CardDescription>
                </div>
              </div>
              <Badge variant={store.isActive ? "default" : "secondary"} className="text-sm">
                {store.isActive ? (
                  <>
                    <CheckCircle className="mr-1 h-3 w-3" />
                    Active
                  </>
                ) : (
                  <>
                    <XCircle className="mr-1 h-3 w-3" />
                    Inactive
                  </>
                )}
              </Badge>
            </div>
          </CardHeader>
        </Card>

        {/* Key Metrics */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Assigned Managers</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{store._count.managers}</div>
              <p className="text-xs text-muted-foreground">
                Active manager assignments
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Reports</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{store._count.reports}</div>
              <p className="text-xs text-muted-foreground">
                Daily reports submitted
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Store Status</CardTitle>
              <Store className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {store.isActive ? "Active" : "Inactive"}
              </div>
              <p className="text-xs text-muted-foreground">
                Current operational status
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Manager Assignments */}
        <Card>
          <CardHeader>
            <CardTitle>Manager Assignments</CardTitle>
            <CardDescription>
              Managers currently assigned to this store
            </CardDescription>
          </CardHeader>
          <CardContent>
            {storeManagers.length === 0 ? (
              <div className="text-center py-8 border-2 border-dashed border-muted-foreground/25 rounded-lg">
                <UserX className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground">No managers assigned to this store</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Managers can be assigned from the Store Management page
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {storeManagers.map((manager: any) => (
                  <div key={manager.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                        <Users className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <div className="font-medium">{manager.name}</div>
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Mail className="h-3 w-3" />
                          {manager.email}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant="secondary" className="mb-1">
                        {manager._count.reports} reports
                      </Badge>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        Assigned {new Date(manager.assignedAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity / Reports Section */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>
              Latest reports and activities from this store
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8 text-muted-foreground">
              <BarChart3 className="h-8 w-8 mx-auto mb-2" />
              <p>Recent reports will appear here</p>
              <p className="text-sm">Reports functionality coming soon</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}