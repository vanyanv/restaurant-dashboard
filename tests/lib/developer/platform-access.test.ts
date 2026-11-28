// The keys belong to the whole platform, and DEVELOPER is a role inside one
// account. Pinned: only a developer of the one account named by
// DEVELOPER_PORTAL_ACCOUNT_ID may read a value, and with that setting missing
// nobody may.

import { describe, it, expect } from "vitest"
import {
  canSeeDeveloperPortal,
  canUseKeys,
  keysAccessFor,
  portalAccountId,
} from "@/lib/developer/platform-access"

const dev = (accountId: string) => ({ user: { id: "u1", role: "DEVELOPER", accountId } })
const owner = (accountId: string) => ({ user: { id: "u2", role: "OWNER", accountId } })
const PINNED = { DEVELOPER_PORTAL_ACCOUNT_ID: "acc_platform" }
const UNSET = {}

describe("portalAccountId", () => {
  it("reads the setting, trimmed, and treats blank as missing", () => {
    expect(portalAccountId(PINNED)).toBe("acc_platform")
    expect(portalAccountId({ DEVELOPER_PORTAL_ACCOUNT_ID: "  acc_platform \n" })).toBe("acc_platform")
    expect(portalAccountId({ DEVELOPER_PORTAL_ACCOUNT_ID: "   " })).toBeNull()
    expect(portalAccountId(UNSET)).toBeNull()
  })
})

describe("keysAccessFor", () => {
  it("is available only to the named account", () => {
    expect(keysAccessFor("acc_platform", PINNED)).toEqual({ available: true })
    expect(keysAccessFor("acc_other", PINNED)).toEqual({ available: false, reason: "otherAccount" })
  })

  it("is off for everyone, saying so, when the setting is missing", () => {
    expect(keysAccessFor("acc_platform", UNSET)).toEqual({ available: false, reason: "notSetUp" })
    expect(keysAccessFor("", UNSET)).toEqual({ available: false, reason: "notSetUp" })
  })

  it("never matches a missing account id", () => {
    for (const bad of ["", null, undefined]) {
      expect(keysAccessFor(bad, PINNED)).toEqual({ available: false, reason: "otherAccount" })
    }
  })
})

describe("canUseKeys", () => {
  it("is true for a developer of the named account", () => {
    expect(canUseKeys(dev("acc_platform"), PINNED)).toBe(true)
  })

  it("is false for another account's developer", () => {
    expect(canUseKeys(dev("acc_other"), PINNED)).toBe(false)
  })

  it("is false for everyone when the setting is missing", () => {
    expect(canUseKeys(dev("acc_platform"), UNSET)).toBe(false)
    expect(canUseKeys(dev("acc_platform"), { DEVELOPER_PORTAL_ACCOUNT_ID: "" })).toBe(false)
  })

  it("is false for an owner of the named account and for nobody at all", () => {
    expect(canUseKeys(owner("acc_platform"), PINNED)).toBe(false)
    expect(canUseKeys(null, PINNED)).toBe(false)
    expect(canUseKeys(undefined, PINNED)).toBe(false)
    expect(canUseKeys({ user: null }, PINNED)).toBe(false)
  })
})

describe("canSeeDeveloperPortal", () => {
  it("shows the page to a developer of the named account", () => {
    expect(canSeeDeveloperPortal(dev("acc_platform"), PINNED)).toBe(true)
  })

  it("hides the page from another account's developer", () => {
    expect(canSeeDeveloperPortal(dev("acc_other"), PINNED)).toBe(false)
  })

  it("shows the page, with the keys off, while the setting is missing", () => {
    expect(canSeeDeveloperPortal(dev("acc_any"), UNSET)).toBe(true)
    expect(canUseKeys(dev("acc_any"), UNSET)).toBe(false)
  })

  it("never shows it to an owner or a signed-out visitor", () => {
    for (const env of [PINNED, UNSET]) {
      expect(canSeeDeveloperPortal(owner("acc_platform"), env)).toBe(false)
      expect(canSeeDeveloperPortal(null, env)).toBe(false)
    }
  })
})
