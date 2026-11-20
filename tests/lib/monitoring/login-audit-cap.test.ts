// The sign-in form is public: whatever is typed as the email is stored on
// LoginEvent, capped at 254 characters (2026-11-20).
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: { loginEvent: { create: vi.fn() } } }))

import { prisma } from "@/lib/prisma"
import { recordLoginEvent } from "@/lib/monitoring/login-audit"

describe("recordLoginEvent", () => {
  it("caps emailTried at 254 characters", async () => {
    await recordLoginEvent({ emailTried: "a".repeat(10_000), kind: "SIGN_IN_FAILED" })
    const data = (prisma.loginEvent.create as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0].data
    expect(data.emailTried).toHaveLength(254)
  })
})
