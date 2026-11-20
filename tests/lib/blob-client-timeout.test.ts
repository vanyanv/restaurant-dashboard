// The R2 client had no request timeout: the SDK default waits forever, so a
// stalled connection held the invoice sync (or an owner opening a PDF) until
// the function was killed. It is now built with connect and request timeouts.

import { describe, it, expect, vi } from "vitest"

const built = vi.hoisted(() => ({ configs: [] as unknown[] }))

vi.mock("@aws-sdk/client-s3", () => {
  class S3Client {
    constructor(config: unknown) {
      built.configs.push(config)
    }
    send = vi.fn(async () => ({}))
  }
  class Cmd {
    constructor(public input: unknown) {}
  }
  return {
    S3Client,
    PutObjectCommand: Cmd,
    GetObjectCommand: Cmd,
    DeleteObjectCommand: Cmd,
    NoSuchKey: class extends Error {},
  }
})

import { deleteCheckPhoto, R2_CONNECTION_TIMEOUT_MS, R2_REQUEST_TIMEOUT_MS } from "@/lib/blob"

describe("R2 client", () => {
  it("is built with a connection and a request timeout", async () => {
    process.env.R2_BUCKET_NAME = "b"
    process.env.R2_ENDPOINT = "https://r2.example.test"
    process.env.R2_ACCESS_KEY_ID = "k"
    process.env.R2_SECRET_ACCESS_KEY = "s"
    await deleteCheckPhoto("checks/x.jpg").catch(() => {})

    expect(built.configs).toHaveLength(1)
    expect(built.configs[0]).toMatchObject({
      requestHandler: {
        connectionTimeout: R2_CONNECTION_TIMEOUT_MS,
        requestTimeout: R2_REQUEST_TIMEOUT_MS,
        throwOnRequestTimeout: true,
      },
    })
    expect(R2_REQUEST_TIMEOUT_MS).toBeGreaterThan(0)
  })
})
