import { redirect } from "next/navigation"
import { unstable_cache } from "next/cache"
import { getServerSession } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { chatPrisma } from "@/lib/chat/prisma-chat"
import { listConversations } from "@/lib/chat/conversation"
import { ChatPageClient } from "./chat-page-client"

/** Conversations are per-account but largely static; fresh-enough at 30s.
 * Tag is invalidated when chat actions create/rename a conversation
 * (revalidateTag in those server actions once we wire that up). The
 * cache key is keyed on accountId, and we serialize Dates to ISO strings
 * here so the cached payload is JSON-stable. */
const getCachedConversations = unstable_cache(
  async (accountId: string) => {
    const rows = await listConversations(chatPrisma, accountId, 100)
    return rows.map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt.toISOString(),
      createdAt: c.createdAt.toISOString(),
      messageCount: c.messageCount,
    }))
  },
  ["chat-conversations-by-account"],
  { revalidate: 30, tags: ["chat-conversations"] }
)

export default async function ChatPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard")

  const initialConversations = await getCachedConversations(
    session.user.accountId
  )

  return <ChatPageClient initialConversations={initialConversations} />
}
