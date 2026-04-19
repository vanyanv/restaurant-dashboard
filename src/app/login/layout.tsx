import { Fraunces } from "next/font/google"
import "../dashboard/editorial.css"

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"],
})

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className={`${fraunces.variable} editorial-surface min-h-svh`}>
      {children}
    </div>
  )
}
