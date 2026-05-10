// One-time store geocoding helper.
//
// Default mode is review-only:
//   ./node_modules/.bin/tsx scripts/geocode-stores.ts
//
// Persist coordinates after reviewing output:
//   ./node_modules/.bin/tsx scripts/geocode-stores.ts --write

import fs from "fs"
import path from "path"
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

type GeocodeResult = {
  latitude: number
  longitude: number
  confidence: number | null
  provider: string
  label: string
}

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[key]) process.env[key] = value
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function geocode(address: string): Promise<GeocodeResult | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search")
  url.searchParams.set("q", address)
  url.searchParams.set("format", "jsonv2")
  url.searchParams.set("limit", "1")
  url.searchParams.set("addressdetails", "0")

  const res = await fetch(url, {
    headers: {
      "User-Agent": "restaurant-dashboard-geocode/1.0",
      Accept: "application/json",
    },
  })
  if (!res.ok) throw new Error(`geocode failed ${res.status}: ${await res.text()}`)
  const rows = (await res.json()) as Array<{
    lat: string
    lon: string
    importance?: number
    display_name?: string
  }>
  const first = rows[0]
  if (!first) return null
  return {
    latitude: Number(first.lat),
    longitude: Number(first.lon),
    confidence: first.importance ?? null,
    provider: "nominatim",
    label: first.display_name ?? address,
  }
}

async function main(): Promise<void> {
  loadEnvLocal()
  const write = process.argv.includes("--write")
  const onlyMissing = !process.argv.includes("--all")
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("DATABASE_URL is required")

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, ssl: true }),
  })
  try {
    const stores = await prisma.store.findMany({
      where: {
        isActive: true,
        address: { not: null },
        ...(onlyMissing ? { OR: [{ latitude: null }, { longitude: null }] } : {}),
      },
      select: {
        id: true,
        name: true,
        address: true,
        latitude: true,
        longitude: true,
      },
      orderBy: { name: "asc" },
    })

    console.log(`geocode-stores ${write ? "write" : "review"} mode · ${stores.length} store(s)`)
    for (const store of stores) {
      if (!store.address) continue
      const result = await geocode(store.address)
      if (!result) {
        console.log(JSON.stringify({ storeId: store.id, name: store.name, status: "not_found" }))
      } else {
        console.log(
          JSON.stringify({
            storeId: store.id,
            name: store.name,
            address: store.address,
            latitude: result.latitude,
            longitude: result.longitude,
            confidence: result.confidence,
            provider: result.provider,
            label: result.label,
            write,
          }),
        )
        if (write) {
          await prisma.store.update({
            where: { id: store.id },
            data: {
              latitude: result.latitude,
              longitude: result.longitude,
              geocodeProvider: result.provider,
              geocodeConfidence: result.confidence,
              geocodedAt: new Date(),
            },
          })
        }
      }
      await sleep(1100)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
