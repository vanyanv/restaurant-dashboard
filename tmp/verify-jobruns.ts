import fs from "fs"
import path from "path"

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  const content = fs.readFileSync(envPath, "utf-8")
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[key]) process.env[key] = val
  }
}
loadEnvLocal()

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const stores = await prisma.store.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  })
  const nameById = new Map(stores.map((s) => [s.id, s.name]))

  console.log("=== Recent otter.metrics.sync JobRun rows (last 10) ===")
  const recent = await prisma.jobRun.findMany({
    where: { jobName: "otter.metrics.sync" },
    orderBy: { startedAt: "desc" },
    take: 10,
    select: {
      id: true,
      storeId: true,
      triggeredBy: true,
      status: true,
      durationMs: true,
      rowsWritten: true,
      startedAt: true,
      completedAt: true,
    },
  })
  for (const r of recent) {
    const sname = r.storeId ? nameById.get(r.storeId) ?? r.storeId : "(global)"
    const dur = r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"
    console.log(
      `  ${r.startedAt.toISOString()}  ${r.status.padEnd(8)} ${sname.padEnd(28)} dur=${dur}  rows=${r.rowsWritten ?? "—"}  via=${r.triggeredBy}`,
    )
  }

  console.log("\n=== otter.orders.drain JobRun rows (last 5) ===")
  const drains = await prisma.jobRun.findMany({
    where: { jobName: "otter.orders.drain" },
    orderBy: { startedAt: "desc" },
    take: 5,
    select: {
      storeId: true,
      status: true,
      durationMs: true,
      rowsWritten: true,
      metadata: true,
      startedAt: true,
    },
  })
  for (const r of drains) {
    const sname = r.storeId ? nameById.get(r.storeId) ?? r.storeId : "(global)"
    const dur = r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"
    console.log(
      `  ${r.startedAt.toISOString()}  ${r.status.padEnd(8)} ${sname.padEnd(28)} dur=${dur}  rows=${r.rowsWritten ?? "—"}`,
    )
  }

  console.log("\n=== Latest run per (jobName, storeId) — what the monitoring grid will show ===")
  for (const s of stores) {
    for (const job of [
      "otter.metrics.sync",
      "otter.orders.sync",
      "otter.hourly.sync",
      "otter.orders.drain",
      "cogs.sweep",
    ]) {
      const r = await prisma.jobRun.findFirst({
        where: { jobName: job, storeId: s.id },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true, status: true, durationMs: true, rowsWritten: true },
      })
      const cell = r
        ? `${r.status.padEnd(7)}  dur=${r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s`.padEnd(7) : "—".padEnd(7)} rows=${String(r.rowsWritten ?? "—").padEnd(5)} ${r.startedAt.toISOString()}`
        : "(no per-store row)"
      console.log(`  ${s.name.padEnd(28)} ${job.padEnd(22)} ${cell}`)
    }
  }

  console.log("\n=== Pending OtterOrder.detailsFetchedAt = null per store ===")
  const pending = await prisma.otterOrder.groupBy({
    by: ["storeId"],
    where: { detailsFetchedAt: null },
    _count: { _all: true },
  })
  for (const p of pending) {
    console.log(`  ${(nameById.get(p.storeId) ?? p.storeId).padEnd(28)} ${p._count._all}`)
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
