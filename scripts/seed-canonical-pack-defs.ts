/**
 * One-shot seeder: hydrate CanonicalIngredient pack-definition fields from
 * the most recent matched InvoiceLineItem.
 *
 *   case-tier        caseUnit + recipeUnitsPerCase
 *   inner-pack-tier  innerPackUnit + innerPacksPerCase (optional)
 *
 * Per the catch-weight refactor (commit e713845) every `InvoiceLineItem` now
 * carries `packSize × unitSize unitSizeUom` for catch-weight meat too. This
 * script reads the most recent line per canonical and writes a pack def
 * when units line up cleanly with the canonical's `recipeUnit`.
 *
 * Default is dry-run. Pass `--apply` to mutate.
 */
import { prisma } from "../src/lib/prisma"

const args = new Set(process.argv.slice(2))
const APPLY = args.has("--apply")

type Plan = {
  canonicalId: string
  name: string
  recipeUnit: string | null
  fromLineId: string
  caseUnit: string
  recipeUnitsPerCase: number
  innerPackUnit: string | null
  innerPacksPerCase: number | null
}

type Skip = {
  canonicalId: string
  name: string
  reason: string
}

const CASE_UOMS = new Set(["CS", "BX", "CT", "EA", "PK"])

function normalizeUnit(u: string | null): string | null {
  if (!u) return null
  const t = u.trim().toUpperCase()
  if (t === "") return null
  if (t === "POUND" || t === "POUNDS" || t === "LBS") return "LB"
  if (t === "OUNCE" || t === "OUNCES" || t === "OZS") return "OZ"
  if (t === "EACH" || t === "CT") return "EA"
  return t
}

function unitsMatch(a: string | null, b: string | null): boolean {
  const na = normalizeUnit(a)
  const nb = normalizeUnit(b)
  if (!na || !nb) return false
  return na === nb
}

async function main() {
  const canonicals = await prisma.canonicalIngredient.findMany({
    where: { caseUnit: null },
    select: { id: true, name: true, recipeUnit: true },
    orderBy: { name: "asc" },
  })

  const plans: Plan[] = []
  const skips: Skip[] = []

  for (const c of canonicals) {
    const line = await prisma.invoiceLineItem.findFirst({
      where: {
        canonicalIngredientId: c.id,
        packSize: { not: null, gt: 0 },
        unitSize: { not: null, gt: 0 },
        unitSizeUom: { not: null },
      },
      orderBy: { invoice: { invoiceDate: "desc" } },
      select: {
        id: true,
        unit: true,
        packSize: true,
        unitSize: true,
        unitSizeUom: true,
      },
    })

    if (!line || line.packSize == null || line.unitSize == null) {
      skips.push({
        canonicalId: c.id,
        name: c.name,
        reason: "no matched line with pack data",
      })
      continue
    }

    const packSize = line.packSize
    const unitSize = line.unitSize
    const unitSizeUom = normalizeUnit(line.unitSizeUom)
    const recipeUnit = normalizeUnit(c.recipeUnit)

    if (!recipeUnit) {
      skips.push({
        canonicalId: c.id,
        name: c.name,
        reason: "canonical has no recipeUnit",
      })
      continue
    }

    // Catch-weight signature: unit=LB && packSize>=1 && unitSizeUom=LB.
    // recipeUnitsPerCase = unitSize (LB per case).
    // No inner-pack tier — operator counts loose pounds + whole cases.
    if (
      normalizeUnit(line.unit) === "LB" &&
      unitSizeUom === "LB" &&
      recipeUnit === "LB"
    ) {
      plans.push({
        canonicalId: c.id,
        name: c.name,
        recipeUnit,
        fromLineId: line.id,
        caseUnit: "CS",
        recipeUnitsPerCase: unitSize,
        innerPackUnit: null,
        innerPacksPerCase: null,
      })
      continue
    }

    // Bulk case (packSize=1, unitSize in recipe-unit). 25 LB sack of tomato.
    if (packSize === 1 && unitsMatch(unitSizeUom, recipeUnit)) {
      plans.push({
        canonicalId: c.id,
        name: c.name,
        recipeUnit,
        fromLineId: line.id,
        caseUnit: "CS",
        recipeUnitsPerCase: unitSize,
        innerPackUnit: null,
        innerPacksPerCase: null,
      })
      continue
    }

    // 9 × 8 CT bread: pack of CT canonicals counted as 'each'.
    if (
      packSize > 1 &&
      unitSizeUom &&
      CASE_UOMS.has(unitSizeUom) &&
      recipeUnit === "EA"
    ) {
      plans.push({
        canonicalId: c.id,
        name: c.name,
        recipeUnit,
        fromLineId: line.id,
        caseUnit: "CS",
        recipeUnitsPerCase: packSize * unitSize,
        innerPackUnit: "PK",
        innerPacksPerCase: packSize,
      })
      continue
    }

    // packSize > 1 with weight-unit inner pack (e.g. 4 × 5 LB)
    if (packSize > 1 && unitsMatch(unitSizeUom, recipeUnit)) {
      plans.push({
        canonicalId: c.id,
        name: c.name,
        recipeUnit,
        fromLineId: line.id,
        caseUnit: "CS",
        recipeUnitsPerCase: packSize * unitSize,
        innerPackUnit: "PK",
        innerPacksPerCase: packSize,
      })
      continue
    }

    skips.push({
      canonicalId: c.id,
      name: c.name,
      reason: `unit mismatch (line ${line.unit ?? "—"}/${line.unitSizeUom ?? "—"} vs canonical ${c.recipeUnit ?? "—"})`,
    })
  }

  process.stdout.write(`\nFound ${canonicals.length} canonicals without pack defs.\n`)
  process.stdout.write(`  would-update: ${plans.length}\n`)
  process.stdout.write(`  needs-review: ${skips.length}\n\n`)

  if (plans.length > 0) {
    process.stdout.write("--- WOULD UPDATE ---\n")
    for (const p of plans) {
      process.stdout.write(
        [
          p.name.padEnd(38),
          `${p.caseUnit.padEnd(3)} × ${p.recipeUnitsPerCase.toFixed(2).padStart(8)} ${p.recipeUnit}`,
          p.innerPackUnit
            ? `(${p.innerPacksPerCase} ${p.innerPackUnit}/CS)`
            : "",
        ].join("  ") + "\n",
      )
    }
  }

  if (skips.length > 0) {
    process.stdout.write("\n--- NEEDS REVIEW ---\n")
    for (const s of skips) {
      process.stdout.write(`${s.name.padEnd(38)}  ${s.reason}\n`)
    }
  }

  if (!APPLY) {
    process.stdout.write("\nDry run. Pass --apply to write.\n")
    return
  }

  process.stdout.write("\nApplying...\n")
  let updated = 0
  for (const p of plans) {
    await prisma.canonicalIngredient.update({
      where: { id: p.canonicalId },
      data: {
        caseUnit: p.caseUnit,
        recipeUnitsPerCase: p.recipeUnitsPerCase,
        innerPackUnit: p.innerPackUnit,
        innerPacksPerCase: p.innerPacksPerCase,
      },
    })
    updated++
  }
  process.stdout.write(`Applied ${updated} updates.\n`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
