import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { chatPrisma } from "@/lib/chat/prisma-chat"
import {
  createConversation,
  deleteAllConversations,
  searchConversations,
} from "@/lib/chat/conversation"

/**
 * Lists the authenticated owner's conversations, newest-updated first.
 * `?q=` searches titles and the text of the turns inside each thread; an
 * absent or blank query returns the plain listing.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const q = new URL(req.url).searchParams.get("q") ?? ""
  const rows = await searchConversations(
    chatPrisma,
    session.user.accountId,
    q,
    100,
  )
  return NextResponse.json({ conversations: rows })
}

/** Creates a fresh conversation. Returns the new id. */
export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const c = await createConversation(
    chatPrisma,
    session.user.id,
    session.user.accountId,
  )
  return NextResponse.json({ id: c.id })
}

/** Deletes every conversation for the authenticated account. */
export async function DELETE() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const deletedCount = await deleteAllConversations(
    chatPrisma,
    session.user.accountId,
  )
  return NextResponse.json({ ok: true, deletedCount })
}
