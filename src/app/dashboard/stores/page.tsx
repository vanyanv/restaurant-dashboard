import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { authOptions } from "@/lib/auth"
import { getStores } from "@/app/actions/store-actions"
import { Plus, Store } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StoreSelector } from "@/components/store-selector"
import { DeleteStoreButton } from "./delete-store-button"
import { StarRatingCompact } from "@/components/ui/star-rating"
import { YelpSyncAllButton } from "@/components/yelp-sync-button"
import { EditorialTopbar } from "../components/editorial-topbar"

export default async function StoresPage() {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect("/login")
  }

  const stores = await getStores()
  const isOwner = session.user.role === "OWNER"

  return (
    <div className="flex h-full flex-col">
      <EditorialTopbar
        section="§ 05"
        title="Stores"
        stamps={
          <span>
            {stores.length} location{stores.length !== 1 ? "s" : ""}
          </span>
        }
      >
        {isOwner && stores.length > 0 && <YelpSyncAllButton />}
        {isOwner && (
          <Link href="/dashboard/stores/new">
            <Button size="sm">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Store
            </Button>
          </Link>
        )}
      </EditorialTopbar>

      <div className="flex-1 space-y-3 p-3 sm:p-4">
        {stores.length > 0 && (
          <div className="flex items-center gap-3">
            <StoreSelector stores={stores} currentStoreId="all" />
            <div className="hidden text-[12px] text-(--ink-muted) sm:block">
              Select a store to view details, or browse all stores below.
            </div>
          </div>
        )}

        {stores.length === 0 ? (
          <div className="inv-panel">
            <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
              <Store
                className="h-10 w-10 text-(--ink-faint)"
                strokeWidth={1.25}
              />
              <h3 className="font-display text-[22px] italic text-(--ink)">
                No stores yet
              </h3>
              <p className="max-w-sm text-[13px] text-(--ink-muted)">
                {isOwner
                  ? "Get started by adding your first store location."
                  : "You are not assigned to manage any stores yet."}
              </p>
              {isOwner && (
                <Link href="/dashboard/stores/new" className="mt-2">
                  <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Add your first store
                  </Button>
                </Link>
              )}
            </div>
          </div>
        ) : (
          <section className="inv-panel inv-panel--flush">
            <header className="inv-panel__head px-5 pt-5 pb-3 sm:px-5">
              <span className="inv-panel__dept">All locations</span>
            </header>
            <div role="list">
              {stores.map((store) => {
                const addressLine = store.address || "Address not set"
                const phone = store.phone
                const statusLabel = store.isActive ? "Active" : "Inactive"
                const statusTone = store.isActive ? "ok" : "muted"
                return (
                  <div
                    key={store.id}
                    role="listitem"
                    className="store-row"
                  >
                    <Link
                      href={`/dashboard/stores/${store.id}`}
                      className="store-row__main"
                      aria-label={`Open ${store.name}`}
                    >
                      <span className="store-row__name">
                        <span className="store-row__name-text">
                          {store.name}
                        </span>
                      </span>
                      <span className="store-row__address">
                        {addressLine}
                        {phone ? (
                          <>
                            <span aria-hidden> · </span>
                            <span className="normal-case tracking-normal">
                              {phone}
                            </span>
                          </>
                        ) : null}
                      </span>
                      {(store.yelpRating || store.yelpReviewCount) && (
                        <span className="store-row__rating">
                          <StarRatingCompact
                            rating={store.yelpRating}
                            reviewCount={store.yelpReviewCount}
                            url={store.yelpUrl}
                          />
                        </span>
                      )}
                    </Link>

                    <span className="store-row__stamp-cell">
                      <span
                        className="inv-stamp"
                        data-tone={statusTone}
                      >
                        {statusLabel}
                      </span>
                    </span>

                    <div className="store-row__actions">
                      {isOwner && (
                        <>
                          <Link
                            href={`/dashboard/pnl/${store.id}`}
                            className="toolbar-btn"
                          >
                            P&amp;L
                          </Link>
                          <Link
                            href={`/dashboard/stores/${store.id}/edit`}
                            className="toolbar-btn"
                          >
                            Edit
                          </Link>
                          <DeleteStoreButton
                            storeId={store.id}
                            storeName={store.name}
                          />
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
