import { prisma } from "@/lib/prisma"

/** Stable identifier for each Hobby-plan quota — matches the labels on
 * vercel.com/dashboard/usage. */
export type QuotaKey =
  | "blobAdvancedOps"
  | "fluidActiveCpu"
  | "functionInvocations"
  | "edgeRequests"
  | "imageOptimizationCacheReads"
  | "fastOriginTransfer"
  | "blobDataStorage"
  | "isrReads"
  | "fluidProvisionedMemory"
  | "blobSimpleOps"

export type Quota = {
  label: string
  used: number | null
  limit: number | null
  unit: "count" | "bytes" | "ms" | "gbHours" | "cpuMs"
}

export type VercelUsageMetrics = Record<QuotaKey, Quota>

const QUOTA_DEFS: Record<QuotaKey, Pick<Quota, "label" | "unit">> = {
  blobAdvancedOps:             { label: "Blob Advanced Operations",       unit: "count" },
  fluidActiveCpu:              { label: "Fluid Active CPU",               unit: "cpuMs" },
  functionInvocations:         { label: "Function Invocations",           unit: "count" },
  edgeRequests:                { label: "Edge Requests",                  unit: "count" },
  imageOptimizationCacheReads: { label: "Image Optimization Cache Reads", unit: "count" },
  fastOriginTransfer:          { label: "Fast Origin Transfer",           unit: "bytes" },
  blobDataStorage:             { label: "Blob Data Storage",              unit: "bytes" },
  isrReads:                    { label: "ISR Reads",                      unit: "count" },
  fluidProvisionedMemory:      { label: "Fluid Provisioned Memory",       unit: "gbHours" },
  blobSimpleOps:               { label: "Blob Simple Operations",         unit: "count" },
}

const VERCEL_API = "https://api.vercel.com"

function token(): string {
  const t = process.env.VERCEL_TOKEN
  if (!t) throw new Error("VERCEL_TOKEN is not set")
  return t
}

function teamQuery(): string {
  const team = process.env.VERCEL_TEAM_ID
  return team ? `?teamId=${encodeURIComponent(team)}` : ""
}

async function vercelFetch<T = unknown>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${VERCEL_API}${path}`, {
      headers: { Authorization: `Bearer ${token()}` },
      cache: "no-store",
    })
    if (!res.ok) {
      console.warn(`[vercel-usage] ${path} -> ${res.status}`)
      return null
    }
    return (await res.json()) as T
  } catch (err) {
    console.warn(`[vercel-usage] ${path} threw`, err)
    return null
  }
}

function emptyMetrics(): VercelUsageMetrics {
  const out = {} as VercelUsageMetrics
  for (const [k, def] of Object.entries(QUOTA_DEFS)) {
    out[k as QuotaKey] = { ...def, used: null, limit: null }
  }
  return out
}

/** Pull current-cycle usage. Always returns a complete-shape object —
 * fields are null when Vercel doesn't surface them. */
export async function fetchVercelUsage(): Promise<{
  billingCycle: string
  metrics: VercelUsageMetrics
}> {
  const metrics = emptyMetrics()
  const now = new Date()
  const billingCycle = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`

  const raw = await vercelFetch<Record<string, unknown>>(`/v1/usage${teamQuery()}`)
  if (!raw) return { billingCycle, metrics }

  const lookup = (...keys: string[]): { used: number | null; limit: number | null } => {
    for (const k of keys) {
      const v = raw[k] as Record<string, unknown> | undefined
      if (v && typeof v === "object") {
        const used = typeof v.used === "number" ? v.used : null
        const limit = typeof v.limit === "number" ? v.limit : null
        if (used !== null || limit !== null) return { used, limit }
      }
    }
    return { used: null, limit: null }
  }

  Object.assign(metrics.blobAdvancedOps,             lookup("blobAdvancedOps", "blob_advanced_ops"))
  Object.assign(metrics.fluidActiveCpu,              lookup("fluidActiveCpu", "fluid_active_cpu", "activeCpu"))
  Object.assign(metrics.functionInvocations,         lookup("functionInvocations", "function_invocations"))
  Object.assign(metrics.edgeRequests,                lookup("edgeRequests", "edge_requests"))
  Object.assign(metrics.imageOptimizationCacheReads, lookup("imageOptimizationCacheReads", "image_optimization_cache_reads"))
  Object.assign(metrics.fastOriginTransfer,          lookup("fastOriginTransfer", "fast_origin_transfer"))
  Object.assign(metrics.blobDataStorage,             lookup("blobDataStorage", "blob_data_storage"))
  Object.assign(metrics.isrReads,                    lookup("isrReads", "isr_reads"))
  Object.assign(metrics.fluidProvisionedMemory,      lookup("fluidProvisionedMemory", "fluid_provisioned_memory"))
  Object.assign(metrics.blobSimpleOps,               lookup("blobSimpleOps", "blob_simple_ops"))

  return { billingCycle, metrics }
}

export async function getLatestVercelSnapshot() {
  return prisma.vercelUsageSnapshot.findFirst({ orderBy: { capturedAt: "desc" } })
}

/** Compute the at-risk subset (≥ thresholdPct of limit). */
export function selectAtRiskQuotas(
  metrics: VercelUsageMetrics,
  thresholdPct = 70,
): Array<{ key: QuotaKey } & Quota & { pct: number }> {
  const out: Array<{ key: QuotaKey } & Quota & { pct: number }> = []
  for (const [k, q] of Object.entries(metrics) as Array<[QuotaKey, Quota]>) {
    if (q.used == null || q.limit == null || q.limit === 0) continue
    const pct = (q.used / q.limit) * 100
    if (pct >= thresholdPct) out.push({ key: k, ...q, pct })
  }
  return out.sort((a, b) => b.pct - a.pct)
}
