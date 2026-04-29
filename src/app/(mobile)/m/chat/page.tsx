import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { chatPrisma } from "@/lib/chat/prisma-chat"
import { listConversations } from "@/lib/chat/conversation"
import { MobileChatClient } from "./mobile-chat-client"

export const dynamic = "force-dynamic"

export default async function MobileChatPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect("/login")
  if (session.user.role !== "OWNER") redirect("/m")

  const conversations = await listConversations(chatPrisma, session.user.accountId, 30)

  return (
    <MobileChatClient
      conversations={conversations.map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt.toISOString(),
        messageCount: c.messageCount,
      }))}
    />
  )
}
