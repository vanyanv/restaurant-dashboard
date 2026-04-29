import Link from "next/link"
import type { MobileSection } from "@/lib/mobile/tabs"

export function SectionList({ sections }: { sections: MobileSection[] }) {
  return (
    <nav aria-label="More sections">
      {sections.map((s) => (
        <Link key={s.href} href={s.href} className="m-section-row">
          <span className="m-section-row__dept">{s.dept}</span>
          <span className="m-section-row__name">{s.label}</span>
          <span className="m-section-row__chev" aria-hidden>
            ›
          </span>
        </Link>
      ))}
    </nav>
  )
}
