import { Fraunces } from "next/font/google"
import "@/styles/editorial.css"

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"],
})

export default function SignupLayout({
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
