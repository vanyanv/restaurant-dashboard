import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { authOptions } from "@/lib/auth"
import { getStores } from "@/app/actions/store-actions"
import { Store, MapPin, Phone, Plus, Users, BarChart3, Edit, Trash2, Eye } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StoreSelector } from "@/components/store-selector"
import { DeleteStoreButton } from "./delete-store-button"
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
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"

export default async function StoresPage() {
  const session = await getServerSession(authOptions)
  
  if (!session) {
    redirect("/login")
  }

  const stores = await getStores()

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
                <BreadcrumbPage>Stores</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Store Management</h1>
            <p className="text-muted-foreground">
              Manage your restaurant locations and their details
            </p>
          </div>
          {session.user.role === "OWNER" && (
            <Link href="/dashboard/stores/new">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add New Store
              </Button>
            </Link>
          )}
        </div>

        {/* Store Selector */}
        {stores.length > 0 && (
          <div className="flex items-center gap-4">
            <StoreSelector stores={stores} currentStoreId="all" />
            <div className="text-sm text-muted-foreground">
              Select a store to view details, or browse all stores below
            </div>
          </div>
        )}

        {stores.length === 0 ? (
          <div className="rounded-xl border bg-card text-card-foreground shadow p-12">
            <div className="text-center">
              <Store className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No stores found</h3>
              <p className="text-muted-foreground mb-4">
                {session.user.role === "OWNER" 
                  ? "Get started by adding your first store location."
                  : "You are not assigned to manage any stores yet."
                }
              </p>
              {session.user.role === "OWNER" && (
                <Link href="/dashboard/stores/new">
                  <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Your First Store
                  </Button>
                </Link>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border bg-card">
            <Table>
              <TableCaption>A list of all your restaurant locations</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Store Name</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Managers</TableHead>
                  <TableHead>Reports</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stores.map((store) => (
                  <TableRow key={store.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
                          <Store className="h-4 w-4 text-primary" />
                        </div>
                        {store.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm">
                        <MapPin className="h-3 w-3 text-muted-foreground" />
                        {store.address || "Not specified"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm">
                        <Phone className="h-3 w-3 text-muted-foreground" />
                        {store.phone || "Not specified"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        {store._count.managers}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <BarChart3 className="h-4 w-4 text-muted-foreground" />
                        {store._count.reports}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={store.isActive ? "default" : "secondary"}>
                        {store.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/dashboard/stores/${store.id}`}>
                          <Button variant="outline" size="sm">
                            <Eye className="mr-1 h-3 w-3" />
                            View
                          </Button>
                        </Link>
                        {session.user.role === "OWNER" && (
                          <>
                            <Link href={`/dashboard/stores/${store.id}/edit`}>
                              <Button variant="outline" size="sm">
                                <Edit className="mr-1 h-3 w-3" />
                                Edit
                              </Button>
                            </Link>
                            <DeleteStoreButton 
                              storeId={store.id} 
                              storeName={store.name}
                              hasReports={store._count.reports > 0}
                              hasManagers={store._count.managers > 0}
                            />
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}