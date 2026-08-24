// tests/styles/fixtures/counter-lint/bad.tsx
// Every line below violates exactly one rule. The linter must find all five.
import { prisma } from "@/lib/prisma"
import { motion } from "framer-motion"
import { getCogs } from "@/app/actions/cogs-actions"

export function Bad({ section }: { section: { status: string } }) {
  if (section.status === "loading") return null
  return <div className="bg-sky-500" style={{ color: "#1a1613" }} />
}
