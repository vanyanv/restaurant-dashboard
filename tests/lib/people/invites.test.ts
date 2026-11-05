// Admin > People: the rules a developer relies on, without a database.

import { describe, it, expect } from "vitest"
import {
  daysLeft,
  inviteEmailContent,
  inviteExpiry,
  inviteState,
  newInviteToken,
  removalBlocked,
  roleChangeBlocked,
  INVITE_TTL_MS,
} from "@/lib/people/invites"
import { passwordStrength } from "@/app/signup/signup-fields"

const NOW = new Date("2026-11-05T12:00:00Z")

describe("invite links", () => {
  it("last seven days", () => {
    expect(inviteExpiry(NOW).getTime() - NOW.getTime()).toBe(INVITE_TTL_MS)
    expect(daysLeft(inviteExpiry(NOW), NOW)).toBe(7)
  })

  it("never say 0 days left while the link still works", () => {
    expect(daysLeft(new Date(NOW.getTime() + 60_000), NOW)).toBe(1)
  })

  it("are long, URL-safe and different every time", () => {
    const a = newInviteToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(newInviteToken()).not.toBe(a)
  })

  it("read used before cancelled before ran out", () => {
    const past = new Date(NOW.getTime() - 1)
    const future = new Date(NOW.getTime() + 1)
    expect(inviteState({ usedAt: past, revokedAt: past, expiresAt: past }, NOW)).toBe("used")
    expect(inviteState({ usedAt: null, revokedAt: past, expiresAt: past }, NOW)).toBe("cancelled")
    expect(inviteState({ usedAt: null, revokedAt: null, expiresAt: NOW }, NOW)).toBe("ran_out")
    expect(inviteState({ usedAt: null, revokedAt: null, expiresAt: future }, NOW)).toBe("waiting")
  })
})

describe("removing access", () => {
  const owner = { id: "u_owner", role: "OWNER" as const, removedAt: null }
  const dev = { id: "u_dev", role: "DEVELOPER" as const, removedAt: null }

  it("refuses removing yourself", () => {
    expect(removalBlocked({ actorId: "u_dev", target: dev, activeDevelopers: 2 })).toMatch(/your own/)
  })

  it("refuses removing the last developer", () => {
    expect(removalBlocked({ actorId: "u_x", target: dev, activeDevelopers: 1 })).toMatch(/last developer/)
  })

  it("lets a developer remove an owner, or another developer when one stays", () => {
    expect(removalBlocked({ actorId: "u_dev", target: owner, activeDevelopers: 1 })).toBeNull()
    expect(removalBlocked({ actorId: "u_x", target: dev, activeDevelopers: 2 })).toBeNull()
  })

  it("does not remove twice", () => {
    expect(removalBlocked({ actorId: "u_dev", target: { ...owner, removedAt: NOW }, activeDevelopers: 1 })).toMatch(/already/)
  })
})

describe("changing a role", () => {
  it("refuses demoting the last developer, and changing your own", () => {
    const dev = { id: "u_dev2", role: "DEVELOPER" as const }
    expect(roleChangeBlocked({ actorId: "u_x", target: dev, to: "OWNER", activeDevelopers: 1 })).toMatch(/last developer/)
    expect(roleChangeBlocked({ actorId: "u_dev2", target: dev, to: "OWNER", activeDevelopers: 3 })).toMatch(/your own/)
    expect(roleChangeBlocked({ actorId: "u_x", target: { id: "u_o", role: "OWNER" }, to: "DEVELOPER", activeDevelopers: 1 })).toBeNull()
  })
})

describe("the invite email", () => {
  it("names who sent it, the one link, and when it stops, and escapes what was typed", () => {
    const m = inviteEmailContent({
      to: "ana@example.com",
      name: "Ana <b>Reyes</b>",
      inviterName: "Vardan",
      role: "OWNER",
      link: "https://dashboard.example.com/signup/abc",
      expiresAt: new Date("2026-11-12T20:00:00Z"),
    })
    expect(m.subject).toContain("invited")
    expect(m.text).toContain("Vardan invited you")
    expect(m.text).toContain("https://dashboard.example.com/signup/abc")
    expect(m.text).toContain("November 12")
    expect(m.html).not.toContain("<b>Reyes")
    expect(m.html.match(/href=/g)).toHaveLength(1)
  })
})

describe("password strength on the sign-up form", () => {
  it("is zero under ten characters, whatever they are", () => {
    expect(passwordStrength("Ab1!Ab1!")).toBe(0)
  })
  it("climbs with length, digits and symbols", () => {
    expect(passwordStrength("aaaaaaaaaa")).toBe(1)
    expect(passwordStrength("burgers4ever")).toBe(2)
    expect(passwordStrength("burgers4ever!")).toBe(3)
    expect(passwordStrength("burgers4ever!!xx")).toBe(4)
  })
})
