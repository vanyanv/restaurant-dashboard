import type { S3Client } from "@aws-sdk/client-s3"
import { count, currentSource } from "./meter"

/**
 * Counts each R2 call. The S3 client does not go through `fetch`, so the
 * tracer's fetch spans never see it.
 */
export function countS3(client: S3Client): S3Client {
  client.middlewareStack.add(
    ((next: (args: unknown) => Promise<unknown>) => async (args: unknown) => {
      const source = currentSource()
      count(source, "out:r2")
      try {
        return await next(args)
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
        if (status === 429 || (typeof status === "number" && status >= 500)) {
          count(source, "out:r2:refused")
        }
        throw error
      }
    }) as never,
    { step: "initialize", name: "usageCount" },
  )
  return client
}
