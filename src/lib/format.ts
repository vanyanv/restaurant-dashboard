const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

export function formatCurrency(amount: number): string {
  return currencyFormatter.format(amount)
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

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value)
}
