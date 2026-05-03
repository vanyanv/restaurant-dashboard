import { loadEnvLocal } from "./audit/lib"

async function main() {
  loadEnvLocal()
  const { prisma } = await import("@/lib/prisma")
  const rows = await prisma.otterDailySummary.findMany({
    take: 200,
    orderBy: { date: "desc" },
    select: {
      date: true,
      fpFees: true,
      tpFees: true,
      fpTaxRemitted: true,
      tpTaxRemitted: true,
      fpTaxCollected: true,
      tpTaxCollected: true,
      fpDiscounts: true,
      tpDiscounts: true,
      tpRefundsAdjustments: true,
      tillPaidOut: true,
      tillPaidIn: true,
    },
  })

  function describe(name: string, vals: Array<number | null>) {
    const nonNull = vals.filter((v): v is number => v != null)
    if (nonNull.length === 0) {
      console.log(`  ${name.padEnd(22)} ALL NULL`)
      return
    }
    const pos = nonNull.filter((v) => v > 0).length
    const neg = nonNull.filter((v) => v < 0).length
    const zero = nonNull.filter((v) => v === 0).length
    const min = Math.min(...nonNull)
    const max = Math.max(...nonNull)
    console.log(
      `  ${name.padEnd(22)} n=${nonNull.length}  pos=${pos} neg=${neg} zero=${zero}  min=${min.toFixed(2)} max=${max.toFixed(2)}`
    )
  }

  describe("fpFees", rows.map((r) => r.fpFees))
  describe("tpFees", rows.map((r) => r.tpFees))
  describe("fpTaxCollected", rows.map((r) => r.fpTaxCollected))
  describe("tpTaxCollected", rows.map((r) => r.tpTaxCollected))
  describe("fpTaxRemitted", rows.map((r) => r.fpTaxRemitted))
  describe("tpTaxRemitted", rows.map((r) => r.tpTaxRemitted))
  describe("fpDiscounts", rows.map((r) => r.fpDiscounts))
  describe("tpDiscounts", rows.map((r) => r.tpDiscounts))
  describe("tpRefundsAdjustments", rows.map((r) => r.tpRefundsAdjustments))
  describe("tillPaidIn", rows.map((r) => r.tillPaidIn))
  describe("tillPaidOut", rows.map((r) => r.tillPaidOut))
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
