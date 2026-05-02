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

  return (
    <section className="inv-panel inv-panel--flush">
      <header className="inv-panel__head px-5 pt-5 pb-3 sm:px-5">
        <span className="inv-panel__dept">All locations</span>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-(--ink-faint)">
          {stores.length} on file · click to open
        </span>
      </header>
      <div role="list">
        {stores.map((store) => {
          const isOpen = openId === store.id
          return (
            <div
              key={store.id}
              id={`store-${store.id}`}
              role="listitem"
              className="store-row"
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
