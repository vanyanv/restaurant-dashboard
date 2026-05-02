import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3"
import { prisma } from "@/lib/prisma"

let client: S3Client | null = null

function getClient(): { client: S3Client; bucket: string } {
  const bucket = process.env.R2_BUCKET_NAME
  if (!bucket) throw new Error("R2_BUCKET_NAME is not set")
  if (client) return { client, bucket }
  const accountId = process.env.R2_ACCOUNT_ID
  const endpoint =
    process.env.R2_ENDPOINT ??
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined)
  if (!endpoint) throw new Error("R2_ENDPOINT or R2_ACCOUNT_ID is required")
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required")
  }
  client = new S3Client({
    region: process.env.R2_REGION ?? "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  })
  return { client, bucket }
}

export type R2BucketStats = {
  totalBytes: bigint
  objectCount: number
  byPrefix: Record<string, { bytes: number; count: number }>
}

/** Walk the entire bucket via paginated ListObjectsV2 and aggregate by
 * top-level prefix. Cheap to call once a day; do not call this on a hot
 * path. */
export async function collectR2Stats(): Promise<R2BucketStats> {
  const { client, bucket } = getClient()
  const byPrefix: Record<string, { bytes: number; count: number }> = {}
  let totalBytes = BigInt(0)
  let objectCount = 0
  let continuationToken: string | undefined

  do {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      }),
    )
    for (const obj of result.Contents ?? []) {
      const size = obj.Size ?? 0
      const key = obj.Key ?? ""
      const slash = key.indexOf("/")
      const prefix = slash >= 0 ? key.slice(0, slash + 1) : "(root)"
      totalBytes += BigInt(size)
      objectCount += 1
      const cur = byPrefix[prefix] ?? { bytes: 0, count: 0 }
      cur.bytes += size
      cur.count += 1
      byPrefix[prefix] = cur
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined
  } while (continuationToken)

  return { totalBytes, objectCount, byPrefix }
}

export async function getLatestR2Snapshot() {
  return prisma.r2BucketSnapshot.findFirst({ orderBy: { capturedAt: "desc" } })
}

export async function getR2SnapshotHistory(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000)
  return prisma.r2BucketSnapshot.findMany({
    where: { capturedAt: { gte: since } },
    orderBy: { capturedAt: "asc" },
    select: { capturedAt: true, totalBytes: true, objectCount: true },
  })
}
