"use client"

import { usePathname } from "next/navigation"
import { phoneHref } from "@/lib/phone-routes"

/**
 * Which surface a shared client is drawn on. The desk and phone routes of a
 * feature render the SAME client (Store checks, Shop, Count & waste…), so a
 * link inside it has to know whether to stay on `/m` or on `/dashboard`.
 */
export function useOnPhone(): boolean {
  const p = usePathname() ?? ""
  return p === "/m" || p.startsWith("/m/")
}

/**
 * Maps a desk path to the one to link to on this surface: itself on the desk,
 * its phone page on the phone (or the desk path, with the bottom bar, while
 * the page has no phone version). Query strings ride along.
 */
export function useSurfaceHref(): (deskPath: string) => string {
  const phone = useOnPhone()
  return (deskPath) => {
    if (!phone) return deskPath
    const [path, query] = deskPath.split("?")
    const mapped = phoneHref(path)
    return query ? `${mapped}?${query}` : mapped
  }
}
