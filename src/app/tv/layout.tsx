import type { Metadata, Viewport } from "next"
import type { ReactNode } from "react"
import "./tv.css"

export const metadata: Metadata = {
  title: "Screens",
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
}

/** The TV player: full screen, nothing else on it. No sign-in; see /api/tv/content. */
export default function TvLayout({ children }: { children: ReactNode }) {
  return <div className="tv">{children}</div>
}
