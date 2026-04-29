import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { chatPrisma } from "@/lib/chat/prisma-chat"
import {
  ConversationAccessError,
  deleteConversation,
  getConversation,
  setConversationTitle,
} from "@/lib/chat/conversation"

interface Ctx {
  params: Promise<{ id: string }>
}

/** Loads one conversation with messages + tool calls. */
export async function GET(_req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await ctx.params
  try {
    const detail = await getConversation(chatPrisma, session.user.id, id)
    return NextResponse.json({ conversation: detail })
  } catch (err) {
    if (err instanceof ConversationAccessError) {
      return NextResponse.json(
        { error: err.code },
        { status: err.code === "NOT_OWNED" ? 403 : 404 },
      )
    }
    throw err
  }
}

/** Renames a conversation. Body: `{ title: string }` (1-80 chars). */
export async function PATCH(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await ctx.params

  let body: { title?: unknown }
  try {
    body = (await req.json()) as { title?: unknown }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const raw = typeof body.title === "string" ? body.title.trim() : ""
  if (raw.length < 1 || raw.length > 80) {
    return NextResponse.json(
      { error: "title must be 1-80 characters" },
      { status: 400 },
    )
  }

  try {
    // Asserts ownership before we mutate.
    await getConversation(chatPrisma, session.user.id, id)
    await setConversationTitle(chatPrisma, id, raw)
    return NextResponse.json({ ok: true, title: raw })
  } catch (err) {
    if (err instanceof ConversationAccessError) {
      return NextResponse.json(
        { error: err.code },
        { status: err.code === "NOT_OWNED" ? 403 : 404 },
      )
    }
    throw err
  }
}

/** Deletes a conversation. Cascades to messages + tool calls. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await ctx.params
  try {
    await deleteConversation(chatPrisma, session.user.id, id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof ConversationAccessError) {
      return NextResponse.json(
        { error: err.code },
        { status: err.code === "NOT_OWNED" ? 403 : 404 },
      )
    }
    throw err
  }
}
