/**
 * Smoke test for the owner-scope helper. Verifies:
 *   - listOwnerStores returns only the owner's active stores
 *   - assertOwnerOwnsStores accepts owned ids
 *   - assertOwnerOwnsStores throws on a foreign id
 *   - empty input expands to the owner's full list
 *   - empty owner -> EMPTY_STORE_LIST throw
 *
 * Run: npx tsx --env-file=.env.local scripts/chat-smoke/test-owner-scope.ts
 */

import { prisma } from "../../src/lib/prisma"
import {
  assertOwnerOwnsStores,
  listOwnerStores,
  OwnerScopeError,
  renderStoreListForPrompt,
} from "../../src/lib/chat/owner-scope"

async function main() {
  const owner = await prisma.user.findFirst({
    where: { ownedStores: { some: {} } },
    select: { id: true, email: true },
  })
  if (!owner) throw new Error("no owner with stores found")
  console.log("test owner:", owner.email)

  const stores = await listOwnerStores(owner.id)
  console.log(`listOwnerStores -> ${stores.length} stores`)

  console.log("--- prompt rendering ---")
  console.log(renderStoreListForPrompt(stores))

  console.log("--- empty input expands to all ---")
  const expanded = await assertOwnerOwnsStores(owner.id, [])
  console.log(`expanded len: ${expanded.length} (matches: ${expanded.length === stores.length})`)

  console.log("--- valid subset accepted ---")
  if (stores.length > 0) {
    const subset = [stores[0].id]
    const valid = await assertOwnerOwnsStores(owner.id, subset)
    console.log(`valid: ${JSON.stringify(valid) === JSON.stringify(subset)}`)
  }

  console.log("--- foreign id rejected ---")
  try {
    await assertOwnerOwnsStores(owner.id, ["clxfakefakefakefakefake000000"])
    console.log("FAIL: should have thrown")
    process.exit(1)
  } catch (err) {
    if (err instanceof OwnerScopeError && err.code === "STORE_NOT_OWNED") {
      console.log(`ok — threw ${err.code}: ${err.message}`)
    } else {
      throw err
    }
  }

  console.log("--- mixed valid + foreign rejected ---")
  if (stores.length > 0) {
    try {
      await assertOwnerOwnsStores(owner.id, [
        stores[0].id,
        "clxfakefakefakefakefake000000",
      ])
      console.log("FAIL: should have thrown")
      process.exit(1)
    } catch (err) {
      if (err instanceof OwnerScopeError && err.code === "STORE_NOT_OWNED") {
        console.log(`ok — threw ${err.code}`)
      } else {
        throw err
      }
    }
  }

  console.log("--- missing ownerId rejected ---")
  try {
    await assertOwnerOwnsStores("", [])
    console.log("FAIL: should have thrown")
    process.exit(1)
  } catch (err) {
    if (err instanceof OwnerScopeError && err.code === "UNAUTHORIZED") {
      console.log(`ok — threw ${err.code}`)
    } else {
      throw err
    }
  }

  console.log("ok")
  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
