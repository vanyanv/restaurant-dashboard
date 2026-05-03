# Ingredient Cost Deep Dive - 2026-05-02T10:59:56.062Z

Read-only audit of recipe-used ingredient costs, invoice-derived unit costs, pack metadata, and estimated COGS impact since 2026-01-01.

## Summary

- Findings: 27
- Fix now: 1
- Owner review: 20
- Guardrails: 1
- Impact rows: 3
- Invoice outlier rows: 26

## Top Findings

- **FIX_NOW / CRITICAL** chris & eddy's house sauce derives $2.93/oz from Bear State Kitchen #1076 2026-01-15 sku=17211. Impact: $95,996.73. Ratio: 14.8x.
  unitSizeUom disagrees with sibling lines (OZ vs LB)
- **OWNER_REVIEW / WARNING** packer lettuce boston hydroponic current cost $0.15/each differs from latest sane invoice $0.24/each. Impact: $1,223.59. Ratio: 1.6x.
  Current canonical cost differs materially from the latest sane invoice-derived cost.
- **OWNER_REVIEW / WARNING** packer lettuce boston hydroponic derives $1.22/each from Sysco Los Angeles, Inc. #945647380 2026-02-21 sku=2717106. Ratio: 8.1x.
  packSize looks truncated or split from 112/124 count pack
- **OWNER_REVIEW / WARNING** packer lettuce boston hydroponic derives $2.24/each from Sysco Los Angeles, Inc. #945660521 2026-02-26 sku=2717106. Ratio: 14.9x.
  packSize looks truncated or split from 112/124 count pack
- **OWNER_REVIEW / WARNING** packer lettuce boston hydroponic derives $1.22/each from Sysco Los Angeles, Inc. #945668952 2026-02-28 sku=2717106. Ratio: 8.1x.
  packSize looks truncated or split from 112/124 count pack
- **OWNER_REVIEW / WARNING** packer lettuce boston hydroponic derives $1.22/each from Sysco Los Angeles, Inc. #945674659 2026-03-02 sku=2717106. Ratio: 8.1x.
  packSize looks truncated or split from 112/124 count pack
- **OWNER_REVIEW / WARNING** packer lettuce boston hydroponic derives $1.22/each from Sysco #945685538 2026-03-05 sku=2717106. Ratio: 8.1x.
  packSize looks truncated or split from 112/124 count pack
- **OWNER_REVIEW / WARNING** packer lettuce boston hydroponic derives $2.44/each from Sysco Los Angeles, Inc. #945695053 2026-03-07 sku=2717106. Ratio: 16.3x.
  packSize looks truncated or split from 112/124 count pack
- **OWNER_REVIEW / WARNING** packer lettuce boston hydroponic derives $1.22/each from Sysco #945696984 2026-03-09 sku=2717106. Ratio: 8.1x.
  packSize looks truncated or split from 112/124 count pack
- **OWNER_REVIEW / WARNING** packer lettuce boston hydroponic derives $1.22/each from Sysco #945707660 2026-03-12 sku=2717106. Ratio: 8.1x.
  packSize looks truncated or split from 112/124 count pack
- **OWNER_REVIEW / WARNING** packer lettuce boston hydroponic derives $1.22/each from Sysco #945717028 2026-03-14 sku=2717106. Ratio: 8.1x.
  packSize looks truncated or split from 112/124 count pack
- **OWNER_REVIEW / WARNING** packer lettuce boston hydroponic derives $1.22/each from Sysco #945719143 2026-03-16 sku=2717106. Ratio: 8.1x.
  packSize looks truncated or split from 112/124 count pack
- **OWNER_REVIEW / WARNING** packer lettuce boston hydroponic derives $1.22/each from Sysco Los Angeles, Inc. #945736383 2026-03-21 sku=2717106. Ratio: 8.1x.
  packSize looks truncated or split from 112/124 count pack
- **OWNER_REVIEW / WARNING** packer lettuce boston hydroponic derives $1.22/each from Sysco Los Angeles, Inc. #945752339 2026-03-26 sku=2717106. Ratio: 8.1x.
  packSize looks truncated or split from 112/124 count pack
- **OWNER_REVIEW / WARNING** packer lettuce boston hydroponic derives $1.22/each from Sysco #945761642 2026-03-28 sku=2717106. Ratio: 8.1x.
  packSize looks truncated or split from 112/124 count pack

## Artifacts

- `tmp/ingredient-cost-deep-dive/20260502T105956Z-ingredient-cost-deep-dive.json`
- `tmp/ingredient-cost-deep-dive/20260502T105956Z-invoice-outliers.csv`
- `tmp/ingredient-cost-deep-dive/20260502T105956Z-impact-estimates.csv`
- `tmp/ingredient-cost-deep-dive/20260502T105956Z-cogs-over-revenue.csv`
- `docs/audits/20260502T105956Z-ingredient-cost-deep-dive.md`

## Notes

- This script does not update invoices, canonicals, recipes, mappings, or DailyCogsItem rows.
- Sauce corrections and COGS rematerialization should happen in a separate reviewed step.
- Lettuce remains owner-review because `each` may mean head, leaf, or portion.
- Locked manual costs, especially pickles, are reported as guardrails when invoice metadata would produce explosive costs.
