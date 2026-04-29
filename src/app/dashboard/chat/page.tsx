import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { chatPrisma } from "@/lib/chat/prisma-chat"
import { listConversations } from "@/lib/chat/conversation"
import { ChatPageClient } from "./chat-page-client"

export const dynamic = "force-dynamic"

export default async function ChatPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect("/login")
  if (session.user.role !== "OWNER") redirect("/dashboard")

  const conversations = await listConversations(chatPrisma, session.user.id, 100)

  return (
    <ChatPageClient
      initialConversations={conversations.map((c) => ({
        id: c.id,
        title: c.title,
        // Date objects must be serialized for the client component.
        updatedAt: c.updatedAt.toISOString(),
        createdAt: c.createdAt.toISOString(),
        messageCount: c.messageCount,
      }))}
    />
  )
}
