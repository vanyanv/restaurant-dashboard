/**
 * Smoke test for the conversation persistence layer. Creates a fresh
 * conversation, appends user + assistant + tool messages, lists, fetches
 * by id, asserts foreign-owner read fails, then deletes and confirms
 * cascade. Uses DATABASE_URL2 (the chat-layer Neon branch).
 *
 * Run: npx tsx --env-file=.env.local scripts/chat-smoke/test-conversation.ts
 */

if (process.env.DATABASE_URL2) {
  process.env.DATABASE_URL = process.env.DATABASE_URL2
}

async function main() {
  const { prisma } = await import("../../src/lib/prisma")
  const {
    createConversation,
    appendMessage,
    listConversations,
    getConversation,
    setConversationTitle,
    deleteConversation,
    ConversationAccessError,
  } = await import("../../src/lib/chat/conversation")

  const owner = await prisma.user.findFirst({
    where: { ownedStores: { some: {} } },
    select: { id: true, email: true },
  })
  if (!owner) throw new Error("no owner with stores found")
  console.log("owner:", owner.email)

  const otherOwner = await prisma.user.findFirst({
    where: { id: { not: owner.id } },
    select: { id: true, email: true },
  })

  console.log("--- create ---")
  const { id: convId } = await createConversation(prisma, owner.id)
  console.log("conversation:", convId)

  console.log("--- append user message ---")
  await appendMessage(prisma, {
    conversationId: convId,
    role: "user",
    content: "How was Saturday at the Brooklyn store?",
  })

  console.log("--- append assistant message with tool calls ---")
  await appendMessage(prisma, {
    conversationId: convId,
    role: "assistant",
    content: "Saturday net sales at Brooklyn were $4,221 across 178 orders.",
    toolCalls: [
      {
        toolName: "listStores",
        args: {},
        result: [{ id: "fake", name: "Brooklyn", address: null }],
        durationMs: 12,
      },
      {
        toolName: "getDailySales",
        args: {
          storeIds: ["fake"],
          dateRange: { from: "2026-04-26", to: "2026-04-26" },
        },
        result: [{ date: "2026-04-26", net: 4221, count: 178 }],
        durationMs: 84,
      },
    ],
  })

  console.log("--- set title ---")
  await setConversationTitle(prisma, convId, "Saturday at Brooklyn")

  console.log("--- get by id ---")
  const detail = await getConversation(prisma, owner.id, convId)
  console.log("messageCount:", detail.messageCount)
  console.log("title:", detail.title)
  console.log(
    "first message role:",
    detail.messages[0]?.role,
    "content:",
    detail.messages[0]?.content.slice(0, 40),
  )
  console.log(
    "assistant tool calls:",
    detail.messages[1]?.toolCalls.map((t) => t.toolName),
  )
  if (detail.messageCount !== 2) throw new Error("expected 2 messages")
  if (detail.messages[1]?.toolCalls.length !== 2)
    throw new Error("expected 2 tool calls on assistant message")

  console.log("--- list ---")
  const list = await listConversations(prisma, owner.id, 10)
  console.log(
    "conversations:",
    list.length,
    "newest first id matches:",
    list[0]?.id === convId,
  )
  if (list[0]?.id !== convId) throw new Error("just-touched conversation should be first")

  if (otherOwner) {
    console.log("--- foreign-owner read rejected ---")
    try {
      await getConversation(prisma, otherOwner.id, convId)
      throw new Error("FAIL: should have thrown")
    } catch (err) {
      if (err instanceof ConversationAccessError && err.code === "NOT_OWNED") {
        console.log("ok — threw NOT_OWNED")
      } else {
        throw err
      }
    }
  } else {
    console.log("--- foreign-owner read: skipped (no second user) ---")
  }

  console.log("--- not-found rejected ---")
  try {
    await getConversation(prisma, owner.id, "clxnotrealnotrealnotreal0000")
    throw new Error("FAIL: should have thrown")
  } catch (err) {
    if (err instanceof ConversationAccessError && err.code === "NOT_FOUND") {
      console.log("ok — threw NOT_FOUND")
    } else {
      throw err
    }
  }

  console.log("--- delete cascades ---")
  await deleteConversation(prisma, owner.id, convId)
  const remaining = await prisma.message.count({
    where: { conversationId: convId },
  })
  if (remaining !== 0) throw new Error("cascade did not delete messages")
  const remainingCalls = await prisma.toolCall.count({
    where: { message: { conversationId: convId } },
  })
  if (remainingCalls !== 0) throw new Error("cascade did not delete tool calls")
  console.log("ok — cascade verified")

  console.log("\nall conversation ops ok")
  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  process.exit(1)
})
