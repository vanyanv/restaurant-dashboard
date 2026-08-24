// tests/styles/fixtures/counter-lint/good.tsx
// The same component, written the way Counter requires.
import { Section } from "@/components/counter/surface/section"
import { useEntry } from "@/components/counter/motion/use-entry"

export function Good({ section }: { section: unknown }) {
  useEntry()
  return (
    <Section data={section as never}>
      <div className="rounded-ct bg-ct-paper text-ct-ink" />
    </Section>
  )
}
