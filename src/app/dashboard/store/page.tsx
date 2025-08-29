import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getStores } from "@/app/actions/store-actions"
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
import { Store } from "lucide-react"

export default async function StoreDashboardPage() {
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
                <BreadcrumbPage>Store Dashboard</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        {stores.length === 0 ? (
          <div className="text-center py-16">
            <Store className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">No Stores Available</h2>
            <p className="text-muted-foreground">
              {session.user.role === "OWNER" 
                ? "Create your first store to view store-specific dashboards."
                : "You are not assigned to manage any stores yet."
              }
            </p>
          </div>
        ) : (
          <div className="text-center py-16">
            <Store className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-4">Select a Store</h2>
            <p className="text-muted-foreground mb-6">
              Choose a store to view its detailed dashboard and analytics.
            </p>
            <div className="flex justify-center">
              <StoreSelector 
                stores={stores} 
                currentStoreId={null}
                redirectTo="/dashboard/store"
                placeholder="Select a store..."
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}