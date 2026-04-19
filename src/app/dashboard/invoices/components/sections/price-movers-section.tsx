import { PriceMoversCard } from "../price-movers-card"
import { fetchPriceMovers } from "./data"

export async function PriceMoversSection() {
  const rows = await fetchPriceMovers()
  return <PriceMoversCard rows={rows} />
}
