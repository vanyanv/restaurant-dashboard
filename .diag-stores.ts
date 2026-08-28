import fs from "fs"
import path from "path"
function loadEnv(){const p=path.resolve(process.cwd(),".env.local");for(const l of fs.readFileSync(p,"utf-8").split("\n")){const t=l.trim();if(!t||t.startsWith("#"))continue;const i=t.indexOf("=");if(i===-1)continue;const k=t.slice(0,i).trim();if(!process.env[k])process.env[k]=t.slice(i+1).trim().replace(/^["']|["']$/g,"")}}
loadEnv()
async function main(){
  const { prisma: p } = await import("./src/lib/prisma")
  const stores = await p.store.findMany({ select: { id: true, name: true, isActive: true } })
  for (const s of stores) {
    const m = await p.$queryRawUnsafe<any[]>(`SELECT "otterStoreId","lastSyncAt" FROM "OtterStore" WHERE "storeId"=$1`, s.id)
    console.log(`${s.id} | ${s.name} | active=${s.isActive} | uuids=${m.map(x=>x.otterStoreId).join(",")} | lastSync=${m.map(x=>x.lastSyncAt?.toISOString?.()??"null").join(",")}`)
  }
  const maxDaily = await p.$queryRawUnsafe<any[]>(`SELECT MAX(date) d, COUNT(*) c FROM "OtterDailySummary"`)
  console.log("OtterDailySummary max date:", maxDaily[0])
  await p.$disconnect()
}
main()
