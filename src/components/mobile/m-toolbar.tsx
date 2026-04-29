import Link from "next/link"
import {
  MOBILE_PERIODS,
  type MobilePeriod,
} from "@/lib/mobile/period"
import { MobileStoreSelect, type ToolbarStore } from "./m-store-select"

export type { ToolbarStore }

type Props = {
  /** Current pathname (e.g. "/m" or "/m/analytics") — used to keep the
   *  period segments routing back to the same page. */
  pathname: string
  /** All search params currently on the URL. Preserved when the toolbar
   *  swaps store or period so per-page filters (?status, ?platform, etc.)
   *  don't get dropped. */
  searchParams: Record<string, string | undefined>
  stores: ToolbarStore[]
  storeId: string | null
  period: MobilePeriod
}

/**
 * Server-rendered toolbar. The period is a row of <a> tags so navigation is
 * pure URL — back/forward + opening in new tab Just Works. The store
 * selector is a tiny client island only because <select onChange> needs JS.
 */
export function MToolbar({
  pathname,
  searchParams,
  stores,
  storeId,
  period,
}: Props) {
  return (
    <div
      className="dock-in dock-in-1"
      style={{
        margin: "0 -16px 14px",
        padding: "0 16px",
        borderBottom: "1px solid var(--hairline-bold)",
        background: "rgba(255, 253, 247, 0.55)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 0",
        }}
      >
        <span
          style={{
            fontFamily:
              "var(--font-jetbrains-mono), ui-monospace, monospace",
            fontSize: 9.5,
            fontWeight: 500,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--ink-faint)",
          }}
        >
          STORE
        </span>
        <MobileStoreSelect
          stores={stores}
          storeId={storeId}
          pathname={pathname}
          searchParams={searchParams}
        />
      </div>
      <div
        role="tablist"
        aria-label="Period"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          borderTop: "1px solid var(--hairline)",
        }}
      >
        {MOBILE_PERIODS.map((p) => {
          const active = period === p.value
          const next = withParams(searchParams, { period: p.value })
          const href = next ? `${pathname}?${next}` : pathname
          return (
            <Link
              key={p.value}
              href={href}
              role="tab"
              aria-selected={active}
              prefetch={false}
              style={{
                textAlign: "center",
                padding: "10px 4px",
                fontFamily:
                  "var(--font-jetbrains-mono), ui-monospace, monospace",
                fontSize: 9.5,
                fontWeight: 500,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                textDecoration: "none",
                color: active ? "var(--accent-dark)" : "var(--ink-muted)",
                background: active ? "var(--accent-bg)" : "transparent",
                borderRight: "1px solid var(--hairline)",
              }}
            >
              {p.short}
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function withParams(
  current: Record<string, string | undefined>,
  patch: Record<string, string | null | undefined>
): string {
  const merged: Record<string, string> = {}
  for (const [k, v] of Object.entries(current)) {
    if (v != null && v !== "") merged[k] = v
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === "") delete merged[k]
    else merged[k] = v
  }
  const params = new URLSearchParams(merged)
  return params.toString()
}
