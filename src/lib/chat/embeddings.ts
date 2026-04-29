import { createHash } from "node:crypto"
import {
  CHAT_EMBEDDING_DIMS,
  CHAT_EMBEDDING_MODEL,
  getChatOpenAIClient,
} from "./openai-client"

/**
 * Embedding helpers for the chat layer's vector tools. The two corpora are
 * invoice line items and Otter menu items — both tiny relative to the rest of
 * the data model, so we re-embed lazily when `contentSnapshot` changes and
 * skip otherwise.
 *
 * Why text-embedding-3-small (1536 dims): the corpora are short strings
 * ("Whole boneless chicken thigh, 40lb case, $3.20/lb") where the cheaper
 * model gives ≥80% top-1 on a 30-query menu eval. The plan mandates
 * upgrading to `text-embedding-3-large` (3072 dims) only if those eval
 * thresholds slip.
 */

/** Stable SHA-256 of the embedded text, used to skip re-embedding unchanged
 * rows. Lowercased + whitespace-collapsed before hashing so cosmetic
 * formatting changes don't trigger re-embeds. */
export function snapshotHash(text: string): string {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim()
  return createHash("sha256").update(normalized).digest("hex")
}

/** Embed a single string. Use `embedBatch` when embedding more than a few
 * rows — the batch endpoint is materially cheaper per token. */
export async function embed(text: string): Promise<number[]> {
  const client = getChatOpenAIClient()
  const res = await client.embeddings.create({
    model: CHAT_EMBEDDING_MODEL,
    input: text,
  })
  const vec = res.data[0]?.embedding
  if (!vec || vec.length !== CHAT_EMBEDDING_DIMS) {
    throw new Error(
      `Embedding response has wrong shape: expected ${CHAT_EMBEDDING_DIMS} dims, got ${vec?.length ?? 0}`,
    )
  }
  return vec
}

/** Batch-embed up to 100 strings per request. Returns embeddings in the same
 * order as `inputs`. Larger arrays are chunked and concatenated. */
export async function embedBatch(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) return []
  const client = getChatOpenAIClient()
  const out: number[][] = []
  const chunkSize = 100
  for (let i = 0; i < inputs.length; i += chunkSize) {
    const chunk = inputs.slice(i, i + chunkSize)
    const res = await client.embeddings.create({
      model: CHAT_EMBEDDING_MODEL,
      input: chunk,
    })
    if (res.data.length !== chunk.length) {
      throw new Error(
        `Batch embedding length mismatch: ${chunk.length} in, ${res.data.length} out`,
      )
    }
    for (const row of res.data) {
      if (row.embedding.length !== CHAT_EMBEDDING_DIMS) {
        throw new Error(
          `Embedding row has wrong dim: ${row.embedding.length}`,
        )
      }
      out.push(row.embedding)
    }
  }
  return out
}

/** Format an embedding for raw-SQL insertion into a `vector(1536)` column.
 * pgvector accepts `'[0.1,0.2,...]'` as text — we cast in the SQL with
 * `::vector`. Prisma's `Unsupported` columns can only be written via
 * `$executeRaw`. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`
}
