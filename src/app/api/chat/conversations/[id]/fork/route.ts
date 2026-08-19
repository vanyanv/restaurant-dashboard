import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { chatPrisma } from "@/lib/chat/prisma-chat"
import { forkConversation } from "@/lib/chat/conversation"

/**
 * Branches a thread at one turn: copies everything up to and including
 * `throughMessageId` into a fresh conversation and returns its id.
 *
 * Ownership is enforced inside `forkConversation`, which loads the source
 * through the same account-checked path every other read uses.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!hasOwnerAccess(session.user.role)) {
    return NextResponse.json({ error: "Chat is owner-only" }, { status: 403 })
  }

  const { id } = await params
  let body: { throughMessageId?: string }
  try {
    body = (await req.json()) as { throughMessageId?: string }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (!body.throughMessageId) {
    return NextResponse.json(
      { error: "throughMessageId required" },
      { status: 400 },
    )
  }

  try {
    const branch = await forkConversation(
      chatPrisma,
      session.user.id,
      session.user.accountId,
      id,
      body.throughMessageId,
    )
    return NextResponse.json({ id: branch.id })
  } catch (err) {
    const code = (err as { code?: string }).code
    const status = code === "NOT_OWNED" ? 403 : 404
    return NextResponse.json({ error: code ?? "not found" }, { status })
  }
}
