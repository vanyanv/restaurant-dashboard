import Link from "next/link"

export type LaborStoreTab = {
  id: string
  name: string
  hasBrand: boolean
}

export function LaborStoreTabs({
  stores,
  activeStoreId,
  weekIso,
}: {
  stores: LaborStoreTab[]
  activeStoreId: string | null
  weekIso?: string
}) {
  const qs = weekIso ? `?week=${weekIso}` : ""
  return (
    <nav className="labor-tabs" aria-label="Store selector">
      <Link
        href={`/dashboard/labor${qs}`}
        className={`labor-tabs__tab${activeStoreId === null ? " labor-tabs__tab--active" : ""}`}
        aria-current={activeStoreId === null ? "page" : undefined}
      >
        All stores
        <span className="labor-tabs__hint">{stores.length}</span>
      </Link>
      {stores.map((s) => {
        const active = activeStoreId === s.id
        if (!s.hasBrand) {
          return (
            <span
              key={s.id}
              className="labor-tabs__tab labor-tabs__tab--disabled"
              aria-disabled="true"
              title="No Harri brand mapping configured for this store"
            >
              {s.name}
              <span className="labor-tabs__hint labor-tabs__hint--off">not connected</span>
            </span>
          )
        }
        return (
          <Link
            key={s.id}
            href={`/dashboard/labor/${s.id}${qs}`}
            className={`labor-tabs__tab${active ? " labor-tabs__tab--active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            {s.name}
          </Link>
        )
      })}
    </nav>
  )
}
