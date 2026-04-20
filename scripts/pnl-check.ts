import "dotenv/config"
import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local", override: true })

import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const stripSslMode = (raw: string): string => {
  try {
    const url = new URL(raw)
    url.searchParams.delete("sslmode")
    return url.toString()
  } catch {
    return raw
  }
}

const adapter = new PrismaPg({
  connectionString: stripSslMode(process.env.DATABASE_URL!),
  ssl: true,
})
const prisma = new PrismaClient({ adapter })

async function main() {
  const rows = await prisma.$queryRaw<Array<{
    week_start: Date
    store_id: string
    store_name: string
    total_sales: number
    fp_card: number
    fp_cash: number
    tp_uber: number
    tp_doordash: number
    tp_grubhub: number
    day_count: number
  }>>`
    WITH weeks AS (
      SELECT
        date_trunc('week', s.date + interval '1 day') - interval '1 day' AS week_start,
        s."storeId",
        s.date,
        s.platform,
        s."paymentMethod",
        s."fpGrossSales",
        s."tpGrossSales"
      FROM "OtterDailySummary" s
      WHERE s.date >= DATE '2026-03-01' AND s.date < DATE '2026-04-13'
    )
    SELECT
      w.week_start,
      w."storeId" AS store_id,
      st.name AS store_name,
      COALESCE(SUM(w."fpGrossSales") FILTER (WHERE w.platform IN ('css-pos','bnm-web')), 0)::float
        + COALESCE(SUM(w."tpGrossSales") FILTER (WHERE w.platform IN ('ubereats','doordash','grubhub','chownow')), 0)::float
        AS total_sales,
      COALESCE(SUM(w."fpGrossSales") FILTER (WHERE w.platform IN ('css-pos','bnm-web') AND w."paymentMethod" = 'CARD'), 0)::float AS fp_card,
      COALESCE(SUM(w."fpGrossSales") FILTER (WHERE w.platform IN ('css-pos','bnm-web') AND w."paymentMethod" = 'CASH'), 0)::float AS fp_cash,
      COALESCE(SUM(w."tpGrossSales") FILTER (WHERE w.platform = 'ubereats'), 0)::float AS tp_uber,
      COALESCE(SUM(w."tpGrossSales") FILTER (WHERE w.platform = 'doordash'), 0)::float AS tp_doordash,
      COALESCE(SUM(w."tpGrossSales") FILTER (WHERE w.platform = 'grubhub'), 0)::float AS tp_grubhub,
      COUNT(DISTINCT w.date)::int AS day_count
    FROM weeks w
    JOIN "Store" st ON st.id = w."storeId"
    GROUP BY w.week_start, w."storeId", st.name
    ORDER BY st.name, w.week_start
  `
  console.log(JSON.stringify(rows, null, 2))
}

main().finally(() => prisma.$disconnect())
