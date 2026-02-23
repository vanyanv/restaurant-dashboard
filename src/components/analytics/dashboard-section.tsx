import { cn } from "@/lib/utils"

export function DashboardSection({
  title,
  children,
  className,
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("space-y-4", className)}>
      <h2 className="text-base font-semibold tracking-tight text-foreground/80">{title}</h2>
      {children}
    </section>
  )
}
