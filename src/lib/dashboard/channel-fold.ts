import type { StoreSummaryRow } from "@/types/analytics"

/**
 * Fold the ledger's channel rows to one row per ordering platform.
 *
 * `getDashboardAnalytics` keys channel rows `platform|||paymentMethod`, which
 * splits first-party sales four ways — Otter POS (card), Otter POS (cash),
 * Otter POS (prepaid), Otter Online Ordering (card). That split is what the
 * reconciliation view needs and exactly what the overview does not: an owner
 * reading the day wants to know how much came through DoorDash, not how many
 * tender types the in-house channel has.
 *
 * First-party platforms collapse into one "In-house" line, third-party keep
 * their own identity so the platform stamps mean something.
 */

export type ChannelKind = "in-house" | "doordash" | "ubereats" | "grubhub" | "other"

export interface FoldedChannel {
  kind: ChannelKind
  label: string
  orders: number
  gross: number
  discounts: number
  net: number
  fees: number
  payout: number
}

const FP_PLATFORMS = new Set(["css-pos", "bnm-web"])

const KIND_LABEL: Record<ChannelKind, string> = {
  "in-house": "In-house",
  doordash: "DoorDash",
  ubereats: "UberEats",
  grubhub: "Grubhub",
  other: "Other",
}

/** In-house first, then third-party alphabetically, "Other" last. */
const KIND_ORDER: ChannelKind[] = ["in-house", "doordash", "grubhub", "ubereats", "other"]

/**
 * Split `<storeId>|||<platform>|||<paymentMethod>` (per-store rows) or
 * `<platform>|||<paymentMethod>` (account-wide rows). The per-store form has
 * three parts, so the platform is the middle one.
 */
export function splitChannelKey(key: string): { storeId: string | null; platform: string } {
  const parts = key.split("|||")
  return parts.length >= 3
    ? { storeId: parts[0], platform: parts[1] }
    : { storeId: null, platform: parts[0] }
}

export function channelKindOf(compositeKey: string): ChannelKind {
  const { platform } = splitChannelKey(compositeKey)
  if (FP_PLATFORMS.has(platform)) return "in-house"
  if (platform === "doordash") return "doordash"
  if (platform === "ubereats") return "ubereats"
  if (platform === "grubhub") return "grubhub"
  return "other"
}

/**
 * Fold per-store channel rows into one list per store id. Rows whose key has no
 * store segment are dropped rather than silently pooled under some store.
 */
export function foldChannelRowsByStore(
  rows: StoreSummaryRow[]
): Map<string, FoldedChannel[]> {
  const byStore = new Map<string, StoreSummaryRow[]>()
  for (const r of rows) {
    const { storeId } = splitChannelKey(r.storeId)
    if (!storeId) continue
    const bucket = byStore.get(storeId) ?? []
    bucket.push(r)
    byStore.set(storeId, bucket)
  }
  const out = new Map<string, FoldedChannel[]>()
  for (const [storeId, bucket] of byStore) {
    out.set(storeId, foldChannelRows(bucket))
  }
  return out
}

export function foldChannelRows(rows: StoreSummaryRow[]): FoldedChannel[] {
  const byKind = new Map<ChannelKind, FoldedChannel>()

  for (const r of rows) {
    const kind = channelKindOf(r.storeId)
    const acc =
      byKind.get(kind) ??
      {
        kind,
        label: KIND_LABEL[kind],
        orders: 0,
        gross: 0,
        discounts: 0,
        net: 0,
        fees: 0,
        payout: 0,
      }
    acc.orders += r.fulfilledOrders
    acc.gross += r.grossSales
    acc.discounts += r.discounts
    acc.net += r.netSales
    acc.fees += r.commissionFees
    acc.payout += r.expectedDeposit
    byKind.set(kind, acc)
  }

  return KIND_ORDER.filter((k) => byKind.has(k)).map((k) => byKind.get(k)!)
}

/** Stamp colour per channel. Paired with the text label — never colour alone. */
export function channelStampColor(kind: ChannelKind): string {
  switch (kind) {
    case "doordash":
      return "var(--platform-doordash)"
    case "ubereats":
      return "var(--platform-ubereats)"
    case "grubhub":
      return "var(--platform-grubhub)"
    default:
      return "var(--platform-neutral)"
  }
}
