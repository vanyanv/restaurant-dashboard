// tests/styles/fixtures/counter-lint/dynamic-imports.tsx
// Proves FIX 2: dynamic import()/require() forms are caught, not just
// static `from "..."` imports.
export async function loadMotion() {
  const { motion } = await import("framer-motion")
  return motion
}

export function loadPrismaSync() {
  const { prisma } = require("@/lib/prisma")
  return prisma
}
