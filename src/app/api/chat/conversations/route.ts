import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { chatPrisma } from "@/lib/chat/prisma-chat"
import {
  createConversation,
  listConversations,
} from "@/lib/chat/conversation"

/** Lists the authenticated owner's conversations. Newest-updated first. */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const rows = await listConversations(chatPrisma, session.user.accountId, 100)
  return NextResponse.json({ conversations: rows })
}

/** Creates a fresh conversation. Returns the new id. */
export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const c = await createConversation(chatPrisma, session.user.id, session.user.accountId)
  return NextResponse.json({ id: c.id })
}
