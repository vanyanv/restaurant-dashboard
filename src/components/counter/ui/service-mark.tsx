import {
  CalendarDays,
  FlaskConical,
  KeyRound,
  LayoutGrid,
  Lock,
  LockKeyhole,
  ReceiptText,
  ShoppingBag,
  SlidersHorizontal,
  Tv,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import type { ConnectionIcon } from "@/lib/counter/connections"
import type { StackIcon } from "@/lib/counter/stack"
import { BRAND_PATHS, type BrandMark } from "./service-mark-paths"

/** Every icon id the developer page's two lists use. */
export type ServiceMarkId = ConnectionIcon | StackIcon

type Mark = { brand: BrandMark } | { line: LucideIcon }

/**
 * Icon id to drawing. A service with a public mark gets it; one without gets
 * a plain line icon for what it does. Typed as a full record, so an id added
 * to `CONNECTION_ICONS` or `STACK_ICONS` without a drawing fails the build.
 */
export const SERVICE_MARKS: Record<ServiceMarkId, Mark> = {
  // Connections
  database: { brand: "postgresql" },
  redis: { brand: "upstash" },
  bucket: { brand: "cloudflare" },
  orders: { line: ReceiptText },
  labor: { line: Users },
  events: { line: CalendarDays },
  mailbox: { brand: "microsoftoutlook" },
  send: { brand: "resend" },
  openai: { brand: "openai" },
  gemini: { brand: "googlegemini" },
  vercel: { brand: "vercel" },
  github: { brand: "github" },
  shop: { line: ShoppingBag },
  tv: { line: Tv },
  signin: { line: Lock },
  settings: { line: SlidersHorizontal },
  tools: { line: Wrench },
  key: { line: KeyRound },
  // Stack
  next: { brand: "nextdotjs" },
  react: { brand: "react" },
  typescript: { brand: "typescript" },
  postgres: { brand: "postgresql" },
  prisma: { brand: "prisma" },
  counter: { line: LayoutGrid },
  tailwind: { brand: "tailwindcss" },
  icons: { brand: "lucide" },
  lock: { line: LockKeyhole },
  python: { brand: "python" },
  vitest: { brand: "vitest" },
  playwright: { brand: "playwright" },
  testing: { line: FlaskConical },
}

/**
 * The small picture beside a service or package name.
 *
 * Always drawn in `currentColor`, never a brand colour, so it holds in both
 * themes and stays inside Counter's tokens. Decorative: it sits next to the
 * name in words, so it is hidden from a screen reader.
 *
 * `x` and `y` place it inside another `<svg>` (the connections map).
 *
 * Shared block: used by the developer page's map, stack and keys.
 */
export function ServiceMark({
  icon,
  size = 16,
  x,
  y,
  className,
}: {
  icon: ServiceMarkId
  size?: number
  x?: number
  y?: number
  className?: string
}) {
  // An id this build does not know (an older client reading newer data) falls
  // back to the key, never to a blank square.
  const mark: Mark = SERVICE_MARKS[icon] ?? SERVICE_MARKS.key
  const cls = className ? `cu-mark ${className}` : "cu-mark"
  if ("line" in mark) {
    const Icon = mark.line
    return <Icon className={cls} width={size} height={size} x={x} y={y} aria-hidden="true" focusable="false" />
  }
  return (
    <svg
      className={cls}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      x={x}
      y={y}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      data-brand={mark.brand}
    >
      <path d={BRAND_PATHS[mark.brand]} />
    </svg>
  )
}
