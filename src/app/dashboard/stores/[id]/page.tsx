import { getServerSession } from "next-auth"
import { redirect, notFound } from "next/navigation"
import Link from "next/link"
import { authOptions } from "@/lib/auth"
import { getStoreById, getStores } from "@/app/actions/store-actions"
import {
  Store,
  MapPin,
  Phone,
  BarChart3,
  Edit,
  ArrowLeft,
  CheckCircle,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { StoreSelector } from "@/components/store-selector"
import { StarRatingLarge } from "@/components/ui/star-rating"
import { YelpSyncButton } from "@/components/yelp-sync-button"
import { EditorialTopbar } from "../../components/editorial-topbar"
import { Badge } from "@/components/ui/badge"

export default async function StoreDetailPage(props: {
  params: Promise<{ id: string }>
}) {
  const params = await props.params
  const { id } = params
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect("/login")
  }

  const [store, allStores] = await Promise.all([
    getStoreById(id),
    getStores(),
  ])

  if (!store) {
    notFound()
  }

  return (
    <div className="flex flex-col h-full">
      <EditorialTopbar
        section="§ 05"
        title={store.name}
        stamps={store.address ? <span>{store.address}</span> : undefined}
      >
        <Link href="/dashboard/stores">
          <Button variant="outline" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <StoreSelector stores={allStores} currentStoreId={store.id} />
        <YelpSyncButton
          storeId={store.id}
          storeName={store.name}
          hasAddress={!!store.address}
          lastSync={store.yelpLastSearch}
          size="default"
        />
        <Link href={`/dashboard/stores/${store.id}/edit`}>
          <Button>
            <Edit className="mr-2 h-4 w-4" />
            Edit Store
          </Button>
        </Link>
      </EditorialTopbar>

      <div className="flex flex-1 flex-col gap-4 p-4">

        <div className="inv-panel">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-(--accent-bg) flex items-center justify-center rounded-none">
                <Store className="h-8 w-8 text-(--accent-dark)" aria-hidden />
              </div>
              <div>
                <h2 className="font-display text-2xl text-(--ink) italic">
                  {store.name}
                </h2>
                <div className="flex items-center gap-4 mt-1 text-sm text-(--ink-muted)">
                  {store.address && (
                    <div className="flex items-center gap-1">
                      <MapPin className="h-4 w-4" aria-hidden />
                      {store.address}
                    </div>
                  )}
                  {store.phone && (
                    <div className="flex items-center gap-1">
                      <Phone className="h-4 w-4" aria-hidden />
                      {store.phone}
                    </div>
                  )}
                </div>
                <div className="mt-3">
                  <StarRatingLarge
                    rating={store.yelpRating}
                    reviewCount={store.yelpReviewCount}
                    url={store.yelpUrl}
                    lastUpdated={store.yelpUpdatedAt}
                  />
                </div>
              </div>
            </div>
            <Badge
              variant={store.isActive ? "default" : "secondary"}
              className="text-sm"
            >
              {store.isActive ? (
                <>
                  <CheckCircle className="mr-1 h-3 w-3" aria-hidden />
                  Active
                </>
              ) : (
                <>
                  <XCircle className="mr-1 h-3 w-3" aria-hidden />
                  Inactive
                </>
              )}
            </Badge>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="inv-panel">
            <div className="inv-panel__head">
              <span className="inv-panel__dept">Yelp Rating</span>
              <BarChart3 className="h-4 w-4 text-(--ink-faint)" aria-hidden />
            </div>
            <div className="font-display-tight text-3xl text-(--ink) [font-variant-numeric:tabular-nums_lining-nums]">
              {store.yelpRating ? store.yelpRating.toFixed(1) : "—"}
            </div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint) mt-1">
              {store.yelpReviewCount
                ? `${store.yelpReviewCount.toLocaleString()} reviews`
                : "No Yelp data"}
            </p>
          </div>

          <div className="inv-panel">
            <div className="inv-panel__head">
              <span className="inv-panel__dept">Store Status</span>
              <Store className="h-4 w-4 text-(--ink-faint)" aria-hidden />
            </div>
            <div className="font-display text-2xl italic text-(--ink)">
              {store.isActive ? "Active" : "Inactive"}
            </div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint) mt-1">
              Current operational status
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
