const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

export function formatCurrency(amount: number): string {
  return currencyFormatter.format(amount)
}

const wholeCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

/** USD with no cents — the mobile-page KPI style ("$1,235"). */
export function formatCurrencyWhole(amount: number): string {
  return wholeCurrencyFormatter.format(amount)
}

// ─── Null-safe family (chat artifacts / cards) ───
// Missing values render as an em dash; negatives use U+2212, not a hyphen.

export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—"
  const abs = Math.abs(n)
  return (
    (n < 0 ? "−" : "") +
    "$" +
    abs.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
}

export function fmtCount(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—"
  return Math.round(n).toLocaleString()
}

/** Takes a 0-1 ratio (not a pre-scaled percent — that's formatPct). */
export function fmtPctFromRatio(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—"
  return `${(n * 100).toFixed(digits)}%`
}

export function fmtSignedMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—"
  if (n === 0) return "$0.00"
  return (n > 0 ? "+" : "") + fmtMoney(n)
}

export function formatCompact(amount: number): string {
  const abs = Math.abs(amount)
  const sign = amount < 0 ? "-" : ""
  if (abs >= 1_000_000) {
    const val = abs / 1_000_000
    return `${sign}$${val % 1 === 0 ? val.toFixed(0) : val.toFixed(1)}M`
  }
  if (abs >= 1_000) {
    const val = abs / 1_000
    return `${sign}$${val % 1 === 0 ? val.toFixed(0) : val.toFixed(1)}K`
  }
  return `${sign}$${abs.toFixed(0)}`
}

export function formatPct(value: number, decimals = 1): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}%`
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00")
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function formatDateUS(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00")
  return date.toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  })
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value)
}
