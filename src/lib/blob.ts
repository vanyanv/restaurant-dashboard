import { randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"

export type InvoicePdfUpload = {
  pathname: string
  url: string
  size: number
  uploadedAt: Date
}

export type InvoicePdfFetch = {
  statusCode: number
  stream: ReadableStream<Uint8Array>
}

let client: S3Client | null = null

function getR2Client(): { client: S3Client; bucket: string; endpoint: string } {
  const bucket = process.env.R2_BUCKET_NAME
  if (!bucket) throw new Error("R2_BUCKET_NAME is not set")

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

  if (!client) {
    client = new S3Client({
      region: process.env.R2_REGION ?? "auto",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    })
  }

  return { client, bucket, endpoint }
}

function toEmptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close()
    },
  })
}

function toWebStream(body: unknown): ReadableStream<Uint8Array> {
  if (body instanceof ReadableStream) return body
  if (body instanceof Readable) {
    return Readable.toWeb(body) as ReadableStream<Uint8Array>
  }
  const webBody = body as { transformToWebStream?: unknown }
  if (body && typeof webBody.transformToWebStream === "function") {
    return (webBody as { transformToWebStream: () => ReadableStream<Uint8Array> })
      .transformToWebStream()
  }
  throw new Error("R2 response body is not a readable stream")
}

function buildPrivateObjectUrl(endpoint: string, bucket: string, key: string): string {
  return `${endpoint.replace(/\/$/, "")}/${bucket}/${key}`
}

export async function putInvoicePdf(
  emailMessageId: string,
  pdfBytes: Buffer,
): Promise<InvoicePdfUpload> {
  const { client, bucket, endpoint } = getR2Client()
  const safeId = emailMessageId.replace(/[^A-Za-z0-9._-]/g, "_")
  const key = `invoices/${safeId}-${randomUUID()}.pdf`

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: pdfBytes,
      ContentType: "application/pdf",
    }),
  )

  return {
    pathname: key,
    url: buildPrivateObjectUrl(endpoint, bucket, key),
    size: pdfBytes.byteLength,
    uploadedAt: new Date(),
  }
}

export async function getInvoicePdfStream(pathname: string): Promise<InvoicePdfFetch> {
  const { client, bucket } = getR2Client()

  try {
    const result = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: pathname,
      }),
    )

    return {
      statusCode: result.$metadata.httpStatusCode ?? 200,
      stream: toWebStream(result.Body),
    }
  } catch (err) {
    if (err instanceof NoSuchKey || (err as { name?: string }).name === "NoSuchKey") {
      return { statusCode: 404, stream: toEmptyStream() }
    }
    throw err
  }
}

// --- Product photos (one per CanonicalIngredient) ----------------------------

const PRODUCT_PHOTO_CONTENT_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const

export type ProductPhotoContentType = keyof typeof PRODUCT_PHOTO_CONTENT_TYPES

export type ProductPhotoUpload = {
  pathname: string
  size: number
  uploadedAt: Date
}

export type ProductPhotoFetch = {
  statusCode: number
  stream: ReadableStream<Uint8Array>
  contentType: string | null
}

export function isProductPhotoContentType(value: string): value is ProductPhotoContentType {
  return value in PRODUCT_PHOTO_CONTENT_TYPES
}

export async function putProductPhoto(
  canonicalIngredientId: string,
  photoBytes: Buffer,
  contentType: ProductPhotoContentType,
): Promise<ProductPhotoUpload> {
  const { client, bucket } = getR2Client()
  const safeId = canonicalIngredientId.replace(/[^A-Za-z0-9._-]/g, "_")
  const ext = PRODUCT_PHOTO_CONTENT_TYPES[contentType]
  const key = `products/${safeId}-${randomUUID()}.${ext}`

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: photoBytes,
      ContentType: contentType,
    }),
  )

  return {
    pathname: key,
    size: photoBytes.byteLength,
    uploadedAt: new Date(),
  }
}

export async function getProductPhotoStream(pathname: string): Promise<ProductPhotoFetch> {
  const { client, bucket } = getR2Client()

  try {
    const result = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: pathname,
      }),
    )

    return {
      statusCode: result.$metadata.httpStatusCode ?? 200,
      stream: toWebStream(result.Body),
      contentType: result.ContentType ?? null,
    }
  } catch (err) {
    if (err instanceof NoSuchKey || (err as { name?: string }).name === "NoSuchKey") {
      return { statusCode: 404, stream: toEmptyStream(), contentType: null }
    }
    throw err
  }
}

/**
 * Best-effort delete. Swallows NoSuchKey so callers can safely replace photos
 * without checking existence first; any other error propagates.
 */
export async function deleteProductPhoto(pathname: string): Promise<void> {
  const { client, bucket } = getR2Client()
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: pathname,
      }),
    )
  } catch (err) {
    if (err instanceof NoSuchKey || (err as { name?: string }).name === "NoSuchKey") return
    throw err
  }
}

// --- Store check photos (one per checklist section) --------------------------

/**
 * Where a check photo lives when R2 is not configured: a folder on local disk.
 * Development and tests only — production without R2 refuses the upload
 * rather than writing to a serverless function's throwaway filesystem.
 */
function localCheckPhotoDir(): string | null {
  if (process.env.R2_BUCKET_NAME) return null
  if (process.env.NODE_ENV === "production" && !process.env.CHECK_PHOTOS_LOCAL_DIR) return null
  return process.env.CHECK_PHOTOS_LOCAL_DIR ?? `${process.cwd()}/.check-photos`
}

export async function putCheckPhoto(
  storeId: string,
  photoBytes: Buffer,
  contentType: ProductPhotoContentType,
): Promise<ProductPhotoUpload> {
  const safeId = storeId.replace(/[^A-Za-z0-9._-]/g, "_")
  const key = `checks/${safeId}/${randomUUID()}.${PRODUCT_PHOTO_CONTENT_TYPES[contentType]}`

  const localDir = localCheckPhotoDir()
  if (localDir) {
    const { mkdir, writeFile } = await import("node:fs/promises")
    const path = `${localDir}/${key}`
    await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true })
    await writeFile(path, photoBytes)
    return { pathname: key, size: photoBytes.byteLength, uploadedAt: new Date() }
  }

  const { client, bucket } = getR2Client()
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: photoBytes, ContentType: contentType }),
  )
  return { pathname: key, size: photoBytes.byteLength, uploadedAt: new Date() }
}

export async function getCheckPhotoStream(pathname: string): Promise<ProductPhotoFetch> {
  const localDir = localCheckPhotoDir()
  if (localDir) {
    const { readFile } = await import("node:fs/promises")
    try {
      const bytes = await readFile(`${localDir}/${pathname}`)
      return {
        statusCode: 200,
        stream: new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(bytes))
            c.close()
          },
        }),
        contentType: null,
      }
    } catch {
      return { statusCode: 404, stream: toEmptyStream(), contentType: null }
    }
  }
  return getProductPhotoStream(pathname)
}
