"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ChevronDown } from "lucide-react"
import { StarRatingCompact } from "@/components/ui/star-rating"
import { StoreDossier, type StoreDossierData } from "./store-dossier"

interface StoresDirectoryProps {
  stores: StoreDossierData[]
  isOwner: boolean
}

export function StoresDirectory({ stores, isOwner }: StoresDirectoryProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const focusParam = searchParams?.get("focus") ?? null
  const editParam = searchParams?.get("edit") === "1"

  const [openId, setOpenId] = useState<string | null>(focusParam)
  const initialEditModeRef = useRef<{ id: string | null; edit: boolean }>({
    id: focusParam,
    edit: editParam && !!focusParam,
  })

  useEffect(() => {
    if (focusParam) {
      setOpenId(focusParam)
      initialEditModeRef.current = {
        id: focusParam,
        edit: editParam,
      }
      const target = document.getElementById(`store-${focusParam}`)
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusParam, editParam])

  const updateUrl = (id: string | null) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "")
    if (id) {
      params.set("focus", id)
    } else {
      params.delete("focus")
    }
    params.delete("edit")
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const toggle = (id: string) => {
    const next = openId === id ? null : id
    setOpenId(next)
    if (next === null) {
      initialEditModeRef.current = { id: null, edit: false }
    } else {
      initialEditModeRef.current = { id: next, edit: false }
    }
    updateUrl(next)
  }

  const activeCount = stores.filter((store) => store.isActive).length
  const configuredCount = stores.filter(
    (store) =>
      store.fixedMonthlyLabor != null &&
      store.fixedMonthlyRent != null &&
      store.targetCogsPct != null
  ).length

  return (
    <section className="inv-panel inv-panel--flush stores-ledger">
      <header className="stores-ledger__head">
        <div>
          <span className="inv-panel__dept">Location ledger</span>
          <h2 className="stores-ledger__title">Store operating files</h2>
        </div>
        <div className="stores-ledger__folio" aria-label="Store counts">
          <span>{activeCount} active</span>
          <span>{configuredCount} configured</span>
          <span>{stores.length} total</span>
        </div>
      </header>
      <div role="list">
        {stores.map((store) => {
          const isOpen = openId === store.id
          const fixedMonthly =
            (store.fixedMonthlyLabor ?? 0) +
            (store.fixedMonthlyRent ?? 0) +
            (store.fixedMonthlyTowels ?? 0) +
            (store.fixedMonthlyCleaning ?? 0)
          const fixedLabel =
            fixedMonthly > 0
              ? fixedMonthly.toLocaleString("en-US", {
                  style: "currency",
                  currency: "USD",
                  maximumFractionDigits: 0,
                })
              : "Unset"
          const commissionLabel = [
            `${(store.uberCommissionRate * 100).toFixed(1)}% Uber`,
            `${(store.doordashCommissionRate * 100).toFixed(1)}% DD`,
          ].join(" / ")

          return (
            <div
              key={store.id}
              id={`store-${store.id}`}
              role="listitem"
              className={"store-row" + (isOpen ? " store-row--open" : "")}
              aria-expanded={isOpen}
            >
              <button
                type="button"
                className="store-row__expand"
                aria-controls={`store-dossier-${store.id}`}
                onClick={() => toggle(store.id)}
              >
                <span className="store-row__lede">
                  <span className="store-row__name">
                    <span className="store-row__name-text">{store.name}</span>
                  </span>
                  <span className="store-row__address">
                    {store.address || "Address not set"}
                    {store.phone ? (
                      <>
                        <span aria-hidden> · </span>
                        <span className="normal-case tracking-normal">
                          {store.phone}
                        </span>
                      </>
                    ) : null}
                  </span>
                </span>
                <span className="store-row__figures" aria-label="Configuration summary">
                  <span>
                    <span className="store-row__figure-label">Fixed</span>
                    <span className="store-row__figure-value">{fixedLabel}</span>
                  </span>
                  <span>
                    <span className="store-row__figure-label">COGS</span>
                    <span className="store-row__figure-value">
                      {store.targetCogsPct != null
                        ? `${store.targetCogsPct.toFixed(1)}%`
                        : "Unset"}
                    </span>
                  </span>
                  <span>
                    <span className="store-row__figure-label">Fees</span>
                    <span className="store-row__figure-value">{commissionLabel}</span>
                  </span>
                </span>
                <span className="store-row__trail">
                  {(store.yelpRating || store.yelpReviewCount) && (
                    <span className="store-row__rating">
                      <StarRatingCompact
                        rating={store.yelpRating}
                        reviewCount={store.yelpReviewCount}
                        url={store.yelpUrl}
                      />
                    </span>
                  )}
                  <span
                    className="inv-stamp"
                    data-status={store.isActive ? "MATCHED" : "REJECTED"}
                  >
                    {store.isActive ? "Active" : "Inactive"}
                  </span>
                  <ChevronDown className="store-row__chev" aria-hidden />
                </span>
              </button>

              <div
                id={`store-dossier-${store.id}`}
                className={
                  "detail-collapse" + (isOpen ? " detail-collapse--open" : "")
                }
                aria-hidden={!isOpen}
              >
                <div className="detail-collapse__inner">
                  {/* Mount the dossier only when the row is or has been opened
                      so we don't render N forms eagerly. Re-mount on toggle is
                      desirable: editing state resets between opens. */}
                  {isOpen && (
                    <StoreDossier
                      store={store}
                      isOwner={isOwner}
                      initialEditMode={
                        initialEditModeRef.current.id === store.id &&
                        initialEditModeRef.current.edit
                      }
                    />
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
