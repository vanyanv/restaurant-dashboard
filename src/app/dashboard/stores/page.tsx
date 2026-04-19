import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { authOptions } from "@/lib/auth"
import { getStores } from "@/app/actions/store-actions"
import { MapPin, Phone, Plus, Edit, Eye, Receipt, Store } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StoreSelector } from "@/components/store-selector"
import { DeleteStoreButton } from "./delete-store-button"
import { StarRatingCompact } from "@/components/ui/star-rating"
import { YelpSyncAllButton } from "@/components/yelp-sync-button"
import { EditorialTopbar } from "../components/editorial-topbar"
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
    <div className="flex flex-col h-full">
      <EditorialTopbar
        section="§ 05"
        title="Stores"
        stamps={
          <span>
            {stores.length} location{stores.length !== 1 ? "s" : ""}
          </span>
        }
      >
        {session.user.role === "OWNER" && stores.length > 0 && (
          <YelpSyncAllButton />
        )}
        {session.user.role === "OWNER" && (
          <Link href="/dashboard/stores/new">
            <Button size="sm">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Store
            </Button>
          </Link>
        )}
      </EditorialTopbar>

      <div className="flex-1 p-3 sm:p-4 space-y-3">
        {/* Store Selector */}
        {stores.length > 0 && (
          <div className="flex items-center gap-3">
            <StoreSelector stores={stores} currentStoreId="all" />
            <div className="text-sm text-muted-foreground hidden sm:block">
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
                  <TableHead>Rating</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Phone</TableHead>
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
                      <StarRatingCompact
                        rating={store.yelpRating}
                        reviewCount={store.yelpReviewCount}
                        url={store.yelpUrl}
                      />
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
                            <Link href={`/dashboard/pnl/${store.id}`}>
                              <Button variant="outline" size="sm">
                                <Receipt className="mr-1 h-3 w-3" />
                                P&amp;L
                              </Button>
                            </Link>
                            <Link href={`/dashboard/stores/${store.id}/edit`}>
                              <Button variant="outline" size="sm">
                                <Edit className="mr-1 h-3 w-3" />
                                Edit
                              </Button>
                            </Link>
                            <DeleteStoreButton
                              storeId={store.id}
                              storeName={store.name}
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
