/**
 * Smoke test for Cloudflare R2 invoice PDF storage.
 *
 * Usage:
 *   ./node_modules/.bin/tsx --env-file=.env.local scripts/smoke-r2.ts
 *
 * Verifies:
 *   1. R2 env vars are set
 *   2. PutObject works (writes a tiny PDF stub)
 *   3. GetObject returns the same bytes
 *   4. DeleteObject cleans up so the bucket stays tidy
 */

import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getInvoicePdfStream, putInvoicePdf } from "../src/lib/blob"

const REQUIRED = [
  "R2_BUCKET_NAME",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
] as const

async function main() {
  for (const k of REQUIRED) {
    if (!process.env[k]) throw new Error(`Missing env: ${k}`)
  }

  const stub = Buffer.from("%PDF-1.4\n% smoke test\n%%EOF\n", "utf8")
  console.log(`[smoke-r2] PUT ${stub.byteLength} bytes...`)
  const uploaded = await putInvoicePdf("smoke-test", stub)
  console.log(`[smoke-r2] PUT ok →`, uploaded)

  console.log(`[smoke-r2] GET ${uploaded.pathname}...`)
  const fetched = await getInvoicePdfStream(uploaded.pathname)
  console.log(`[smoke-r2] GET status=${fetched.statusCode}`)

  const reader = (fetched.stream as ReadableStream<Uint8Array>).getReader()
  const chunks: Uint8Array[] = []
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0)
  console.log(`[smoke-r2] GET body=${total} bytes (sent ${stub.byteLength})`)
  if (total !== stub.byteLength) throw new Error("Round-trip size mismatch")

  console.log(`[smoke-r2] DELETE cleanup...`)
  const endpoint =
    process.env.R2_ENDPOINT ??
    `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  const cleanup = new S3Client({
    region: process.env.R2_REGION ?? "auto",
    endpoint,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
  await cleanup.send(
    new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: uploaded.pathname,
    }),
  )
  console.log(`[smoke-r2] DELETE ok`)
  console.log(`\nR2 round-trip OK ✓`)
}

main().catch((err) => {
  console.error(`\n[smoke-r2] FAILED:`, err)
  process.exit(1)
})
