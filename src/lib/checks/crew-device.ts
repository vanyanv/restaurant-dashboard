import type { NextRequest, NextResponse } from "next/server"

/**
 * A random id per phone, so wrong-try budgets are per phone, not per store
 * Wi-Fi (`pin-guard.ts`, `forgot-pin.ts`). Not a sign-in and carries nothing:
 * a phone that drops it just gets a new one, and the per-address ceilings
 * still hold.
 */
export const DEVICE_COOKIE = "crew_dev"
const DEVICE_ID = /^[0-9a-f-]{36}$/

export function readDevice(request: NextRequest): { id: string; isNew: boolean } {
  const v = request.cookies.get(DEVICE_COOKIE)?.value
  if (v && DEVICE_ID.test(v)) return { id: v, isNew: false }
  return { id: crypto.randomUUID(), isNew: true }
}

/** Hand a new phone its id on the way out. */
export function setDeviceCookie(res: NextResponse, device: { id: string; isNew: boolean }): NextResponse {
  if (device.isNew) {
    res.cookies.set(DEVICE_COOKIE, device.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/checks",
      maxAge: 400 * 24 * 60 * 60,
    })
  }
  return res
}
