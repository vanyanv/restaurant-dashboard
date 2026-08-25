import { CachePanel } from "@/components/monitoring/cache-panel"
import { getCacheStats } from "@/lib/monitoring/queries"
import { getRedisLive } from "@/lib/monitoring/redis-stats"

export const dynamic = "force-dynamic"

export default async function CachePage() {
  const [redis, prefixes] = await Promise.all([
    getRedisLive(),
    getCacheStats(168),
  ])
  return (
    <div className="flex flex-col gap-6">
      <CachePanel redis={redis} prefixes={prefixes} />
    </div>
  )
}
