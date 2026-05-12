import Link from "next/link"
import type { MobileSection } from "@/lib/mobile/tabs"

export function SectionList({ sections }: { sections: MobileSection[] }) {
  const groups = sections.reduce<Array<{ label: string; items: MobileSection[] }>>(
    (acc, section) => {
      const group = acc.find((g) => g.label === section.group)
      if (group) {
        group.items.push(section)
      } else {
        acc.push({ label: section.group, items: [section] })
      }
      return acc
    },
    [],
  )

  return (
    <nav aria-label="More sections">
      {groups.map((group) => (
        <section key={group.label} className="m-section-group">
          <div className="m-section-group__label">{group.label}</div>
          {group.items.map((s) => (
            <Link key={s.href} href={s.href} className="m-section-row">
              <span className="m-section-row__dept">{s.dept}</span>
              <span className="m-section-row__name">{s.label}</span>
              <span className="m-section-row__chev" aria-hidden>
                ›
              </span>
            </Link>
          ))}
        </section>
      ))}
    </nav>
  )
}
