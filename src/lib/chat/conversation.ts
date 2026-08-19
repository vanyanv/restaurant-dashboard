import type { Prisma, PrismaClient } from "@/generated/prisma/client"

/**
 * Conversation persistence layer for the chat. Every read and write is
 * owner-scoped: the route handler resolves `ownerId` from the session, and
 * these helpers throw `ConversationAccessError` when a conversation
 * doesn't exist or isn't owned by the caller. Never trust an id from the
 * client without going through `getConversation`.
 */

export class ConversationAccessError extends Error {
  readonly code: "NOT_FOUND" | "NOT_OWNED"
  constructor(code: "NOT_FOUND" | "NOT_OWNED", message: string) {
    super(message)
    this.code = code
  }
}

export interface ToolCallRecord {
  toolName: string
  args: unknown
  result: unknown
  durationMs: number
}

export interface AppendMessageInput {
  conversationId: string
  role: "user" | "assistant" | "tool"
  content: string
  toolCalls?: ToolCallRecord[]
}

export interface ConversationSummary {
  id: string
  title: string | null
  createdAt: Date
  updatedAt: Date
  messageCount: number
}

export interface ConversationDetail extends ConversationSummary {
  messages: Array<{
    id: string
    role: string
    content: string
    createdAt: Date
    toolCalls: Array<{
      id: string
      toolName: string
      args: Prisma.JsonValue
      result: Prisma.JsonValue
      durationMs: number
    }>
  }>
}

export async function createConversation(
  prisma: PrismaClient,
  ownerId: string,
  accountId: string,
): Promise<{ id: string }> {
  if (!ownerId) {
    throw new ConversationAccessError("NOT_OWNED", "missing ownerId")
  }
  const c = await prisma.conversation.create({
    data: { ownerId, accountId },
    select: { id: true },
  })
  return c
}

/**
 * Copies a thread up to and including one turn into a fresh conversation, so
 * the owner can take a different direction from a given answer without losing
 * the thread they already have.
 *
 * Everything after the chosen turn is dropped — that is the branch. Tool calls
 * are deliberately NOT copied: they are provenance for a call that happened in
 * the source thread at a particular moment, and re-attributing them to a
 * conversation where that call never ran would make the branch's history claim
 * something untrue. The copied text is what the model needs for context.
 */
export async function forkConversation(
  prisma: PrismaClient,
  ownerId: string,
  accountId: string,
  conversationId: string,
  throughMessageId: string,
): Promise<{ id: string }> {
  // Enforces the account boundary and throws NOT_FOUND / NOT_OWNED.
  const source = await getConversation(prisma, accountId, conversationId)

  const cut = source.messages.findIndex((m) => m.id === throughMessageId)
  if (cut === -1) {
    throw new ConversationAccessError(
      "NOT_FOUND",
      "message not in this conversation",
    )
  }

  const branch = await createConversation(prisma, ownerId, accountId)

  // Sequential on purpose: Message rows order by createdAt, and firing the
  // creates in parallel would let them land out of order within the same
  // millisecond, scrambling the branch's history.
  for (const m of source.messages.slice(0, cut + 1)) {
    await prisma.message.create({
      data: {
        conversationId: branch.id,
        role: m.role,
        content: m.content,
      },
      select: { id: true },
    })
  }

  if (source.title) {
    await setConversationTitle(prisma, branch.id, `${source.title} (branch)`)
  }

  return branch
}

/**
 * Searches conversations on the caller's account by title AND by the text of
 * any turn inside them, newest-updated first.
 *
 * Searching turn content is the whole point. Titles are auto-generated, so a
 * thread the owner remembers by a number in the answer ("the one where produce
 * came out at twelve thousand") is unreachable by title alone — the failure
 * every ChatGPT write-up names once a user passes a few dozen threads. A blank
 * query degrades to a plain listing so the rail can use one code path.
 */
export async function searchConversations(
  prisma: PrismaClient,
  accountId: string,
  query: string,
  limit = 50,
): Promise<ConversationSummary[]> {
  const q = query.trim()
  const rows = await prisma.conversation.findMany({
    where: {
      accountId,
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" as const } },
              {
                messages: {
                  some: { content: { contains: q, mode: "insensitive" as const } },
                },
              },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  })
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    messageCount: r._count.messages,
  }))
}

/** Lists conversations on the caller's account, newest-updated first. */
export async function listConversations(
  prisma: PrismaClient,
  accountId: string,
  limit = 50,
): Promise<ConversationSummary[]> {
  const rows = await prisma.conversation.findMany({
    where: { accountId },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  })
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    messageCount: r._count.messages,
  }))
}

/** Loads one conversation with all messages + tool calls. Throws if the
 * conversation isn't on `accountId`. */
export async function getConversation(
  prisma: PrismaClient,
  accountId: string,
  conversationId: string,
): Promise<ConversationDetail> {
  const c = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      accountId: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
          toolCalls: {
            select: {
              id: true,
              toolName: true,
              args: true,
              result: true,
              durationMs: true,
            },
          },
        },
      },
    },
  })
  if (!c) {
    throw new ConversationAccessError("NOT_FOUND", "conversation not found")
  }
  if (c.accountId !== accountId) {
    throw new ConversationAccessError(
      "NOT_OWNED",
      "conversation not on this account",
    )
  }
  return {
    id: c.id,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    messageCount: c._count.messages,
    messages: c.messages,
  }
}

/** Lightweight ownership check for hot paths that only need to confirm the
 * conversation exists on the caller's account. Loading messages here adds
 * avoidable latency before /api/chat can start streaming. */
export async function assertConversationAccess(
  prisma: PrismaClient,
  accountId: string,
  conversationId: string,
): Promise<void> {
  const c = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { accountId: true },
  })
  if (!c) {
    throw new ConversationAccessError("NOT_FOUND", "conversation not found")
  }
  if (c.accountId !== accountId) {
    throw new ConversationAccessError(
      "NOT_OWNED",
      "conversation not on this account",
    )
  }
}

/** Append one message to a conversation. Caller must have already verified
 * ownership via `getConversation` or `assertConversationAccess`. Does not
 * bump conversation.updatedAt — Prisma's `@updatedAt` does that automatically
 * when we touch the row, so we re-save the title (or a sentinel) to trigger
 * it. */
export async function appendMessage(
  prisma: PrismaClient,
  input: AppendMessageInput,
): Promise<{ id: string }> {
  const message = await prisma.message.create({
    data: {
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      toolCalls: input.toolCalls?.length
        ? {
            create: input.toolCalls.map((tc) => ({
              toolName: tc.toolName,
              args: tc.args as Prisma.InputJsonValue,
              result: tc.result as Prisma.InputJsonValue,
              durationMs: tc.durationMs,
            })),
          }
        : undefined,
    },
    select: { id: true },
  })

  // Touch the conversation so updatedAt advances and the rail re-orders.
  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: { updatedAt: new Date() },
    select: { id: true },
  })

  return message
}

/** Sets the conversation title. Used after the first assistant turn to
 * generate a short label for the rail. Caller must verify ownership. */
export async function setConversationTitle(
  prisma: PrismaClient,
  conversationId: string,
  title: string,
): Promise<void> {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { title },
    select: { id: true },
  })
}

/** Deletes a conversation. Cascades to messages + tool calls. Owner check
 * happens via `getConversation` upstream. */
export async function deleteConversation(
  prisma: PrismaClient,
  accountId: string,
  conversationId: string,
): Promise<void> {
  await getConversation(prisma, accountId, conversationId)
  await prisma.conversation.delete({ where: { id: conversationId } })
}

/** Deletes every conversation on the caller's account. Cascades to messages
 * and tool calls through the Conversation -> Message -> ToolCall relations. */
export async function deleteAllConversations(
  prisma: PrismaClient,
  accountId: string,
): Promise<number> {
  const result = await prisma.conversation.deleteMany({
    where: { accountId },
  })
  return result.count
}
