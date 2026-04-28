import type { ReactNode } from "react"

/**
 * Shared chrome for every AI analytics route page. Holds the page title,
 * scope selector, route nav, and "last updated" stamp. Pages slot their
 * route-specific content into `children`.
 *
 * This component is intentionally not a card or a panel — the topbar is the
 * frame; sections inside use `.inv-panel`. No nested chrome.
 */
export function AiPageFrame({
  topbar,
  routeNav,
  lastUpdated,
  children,
}: {
  topbar: ReactNode
  routeNav: ReactNode
  lastUpdated: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col h-full">
      {topbar}
      <div className="flex-1 overflow-auto px-4 pb-12 pt-4 sm:px-6 sm:pt-5">
        <div className="mx-auto w-full max-w-[1100px]">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            {routeNav}
            {lastUpdated}
          </div>
          <div className="space-y-6">{children}</div>
        </div>
      </div>
    </div>
  )
}
