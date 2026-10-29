import localFont from "next/font/local"
import type { ReactNode } from "react"

/**
 * The crew check pages wear the restaurant's own brand (chrisneddys.com's
 * DESIGN.md: counter red, marquee yellow, butcher paper, Bowlby One), not the
 * dashboard's Counter look: crew open them from a poster or a texted link and
 * should see Chris N Eddy's.
 *
 * Bowlby One is self-hosted from the site's file. Not preloaded: no page
 * outside /checks uses it (see the next/font rule in scripts/counter-lint.ts).
 */
const bowlby = localFont({
  src: "../../fonts/bowlby-one-latin.woff2",
  variable: "--font-bowlby",
  display: "swap",
  preload: false,
})

export default function ChecksLayout({ children }: { children: ReactNode }) {
  return <div className={bowlby.variable}>{children}</div>
}
