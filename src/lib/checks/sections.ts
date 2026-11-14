import { prisma } from "@/lib/prisma"
import type { CrewSection } from "./crew"
import type { CheckKindName } from "./time"

/** A check's list as it stands now: sections in order, each with its tasks, empty and switched-off sections left out. */
export async function loadSections(storeId: string, kind: CheckKindName): Promise<CrewSection[]> {
  const tpl = await prisma.checkTemplate.findUnique({
    where: { storeId_kind: { storeId, kind } },
    select: {
      sections: {
        where: { enabled: true },
        orderBy: { position: "asc" },
        select: {
          id: true, nameEn: true, nameEs: true,
          items: { orderBy: { position: "asc" }, select: { id: true, textEn: true, textEs: true, photoRequired: true } },
        },
      },
    },
  })
  return (tpl?.sections ?? [])
    .filter((s) => s.items.length > 0)
    .map((s) => ({
      id: s.id,
      en: s.nameEn,
      es: s.nameEs,
      items: s.items.map((i) => ({ id: i.id, en: i.textEn, es: i.textEs, photoRequired: i.photoRequired })),
    }))
}
