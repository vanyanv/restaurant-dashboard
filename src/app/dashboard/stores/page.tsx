import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getStores } from "@/app/actions/store-actions"
import { Plus, Store } from "lucide-react"
import { Button } from "@/components/ui/button"
import { YelpSyncAllButton } from "@/components/yelp-sync-button"
import { EditorialTopbar } from "../components/editorial-topbar"
import { StoresDirectory } from "./stores-directory"
import type { StoreDossierData } from "./store-dossier"

export default async function StoresPage() {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect("/login")
  }

  const stores = await getStores()
  const isOwner = hasOwnerAccess(session.user.role)

  const directoryStores: StoreDossierData[] = stores.map((s) => ({
    id: s.id,
    name: s.name,
    address: s.address,
    phone: s.phone,
    isActive: s.isActive,
    fixedMonthlyLabor: s.fixedMonthlyLabor,
    fixedMonthlyRent: s.fixedMonthlyRent,
    fixedMonthlyTowels: s.fixedMonthlyTowels,
    fixedMonthlyCleaning: s.fixedMonthlyCleaning,
    uberCommissionRate: s.uberCommissionRate,
    doordashCommissionRate: s.doordashCommissionRate,
    targetCogsPct: s.targetCogsPct,
    yelpRating: s.yelpRating,
    yelpReviewCount: s.yelpReviewCount,
    yelpUrl: s.yelpUrl,
    yelpUpdatedAt: s.yelpUpdatedAt,
    yelpLastSearch: s.yelpLastSearch,
  }))

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
          <StoresDirectory stores={directoryStores} isOwner={isOwner} />
        )}
      </div>
    </div>
  )
}
