# Ingredient Price Conversion Audit

Generated: 2026-05-02T06:27:36.086Z
Mode: apply
Account: all

## Counts

- matchedLinesScanned: 622
- safeFixes: 31
- actionCanonicals: 13
- reviewCanonicals: 17
- affectedCanonicals: 28
- knownExplicitYield: 2
- knownPackExtraction: 8
- sameSkuPackProfile: 19
- zeroExtendedPrice: 2
- missingRecipeUnit: 1
- manualReviewRequired: 7
- excludedNonRecipeScope: 9

## Safe Fixes

| Status | Kind | Canonical | SKU | Before | After | Reason |
| --- | --- | --- | --- | ---: | ---: | --- |
| applied | known_explicit_yield | peppers whole yellow | G299 | - | $0.081417 | Known SKU yield bridges invoice base unit to recipe each. |
| applied | known_pack_extraction | greeno cup pet 20 oz c&d pet | 7370699 | - | $0.096550 | Known case count fixes pack extraction from package volume to per-each count. |
| applied | same_sku_pack_profile | chrsned bag plas tshirt logo ptsbchrisneddy | 7380317 | - | $0.005865 | Same vendor/SKU has a prior working per-each packaging profile. |
| applied | same_sku_pack_profile | cup portion plastic 2 oz clear | 61250 | - | $0.011132 | Same vendor/SKU has a prior working per-each packaging profile. |
| applied | same_sku_pack_profile | lid portion plastic 1.5, 2, 2.5 oz | 61254 | - | $0.010464 | Same vendor/SKU has a prior working per-each packaging profile. |
| applied | same_sku_pack_profile | tray food paper #50 1/2 lb white red check | SQP2650 | - | $0.034380 | Same vendor/SKU has a prior working per-each packaging profile. |
| applied | known_pack_extraction | greeno cup pet 20 oz c&d pet | 7370699 | - | $0.096550 | Known case count fixes pack extraction from package volume to per-each count. |
| applied | same_sku_pack_profile | greeno lid flat with hole 20 oz pe pet | 7190716 | - | $0.006495 | Same vendor/SKU has a prior working per-each packaging profile. |
| applied | same_sku_pack_profile | cup portion plastic 2 oz clear | 61250 | - | $0.011132 | Same vendor/SKU has a prior working per-each packaging profile. |
| applied | same_sku_pack_profile | lid portion plastic 1.5, 2, 2.5 oz | 61254 | - | $0.010464 | Same vendor/SKU has a prior working per-each packaging profile. |
| applied | zero_extended_price | container foam hinged white 9x6.5x2.5 | 965-REY | - | $0.160600 | Non-return invoice line has extendedPrice=0 and quantity * unitPrice is unambiguous. |
| applied | known_pack_extraction | greeno cup pet 20 oz c&d pet | 7370699 | - | $0.096550 | Known case count fixes pack extraction from package volume to per-each count. |
| applied | zero_extended_price | syrup hi-c fruit punch flashin | NFBGFP | - | $24.936000 | Non-return invoice line has extendedPrice=0 and quantity * unitPrice is unambiguous. |
| applied | known_explicit_yield | american cheese yellow 160 | 644 | - | $0.120313 | Known SKU yield bridges invoice base unit to recipe each. |
| applied | known_pack_extraction | greeno cup pet 20 oz c&d pet | 7370699 | - | $0.096550 | Known case count fixes pack extraction from package volume to per-each count. |
| applied | known_pack_extraction | greeno cup pet 20 oz c&d pet | 7370699 | - | $0.096550 | Known case count fixes pack extraction from package volume to per-each count. |
| applied | same_sku_pack_profile | greeno lid flat with hole 20 oz pe pet | 7190716 | - | $0.006495 | Same vendor/SKU has a prior working per-each packaging profile. |
| applied | same_sku_pack_profile | container foam 1-compartment bagged | HT91-BAG | - | $0.154750 | Same vendor/SKU has a prior working per-each packaging profile. |
| applied | same_sku_pack_profile | container foam hinged white 9x6.5x2.5 | 965-REY | - | $0.148750 | Same vendor/SKU has a prior working per-each packaging profile. |
| applied | same_sku_pack_profile | towel multifold kraft 1-ply | 18369 | - | $0.006128 | Same vendor/SKU has a prior working per-each packaging profile. |
| applied | same_sku_pack_profile | napkin dispenser 2-ply 8.5 x 6.5 white | 18418 | - | $0.006645 | Same vendor/SKU has a prior working per-each packaging profile. |
| applied | same_sku_pack_profile | tray food paper #50 1/2 lb white red check | SQP2650 | - | $0.036080 | Same vendor/SKU has a prior working per-each packaging profile. |
| applied | same_sku_pack_profile | container foam hinged white 9x6.5x2.5 | 965-REY | - | $0.148750 | Same vendor/SKU has a prior working per-each packaging profile. |
| applied | same_sku_pack_profile | container foam 1-compartment bagged | HT91-BAG | - | $0.154750 | Same vendor/SKU has a prior working per-each packaging profile. |
| applied | known_pack_extraction | greeno cup pet 20 oz c&d pet | 7370699 | - | $0.096550 | Known case count fixes pack extraction from package volume to per-each count. |
| applied | same_sku_pack_profile | greeno lid flat with hole 20 oz pe pet | 7190716 | - | $0.006495 | Same vendor/SKU has a prior working per-each packaging profile. |
| applied | same_sku_pack_profile | container foam hinged white 9x6.5x2.5 | 965-REY | - | $0.148750 | Same vendor/SKU has a prior working per-each packaging profile. |
| applied | same_sku_pack_profile | container foam 1-compartment bagged | HT91-BAG | - | $0.154750 | Same vendor/SKU has a prior working per-each packaging profile. |
| applied | known_pack_extraction | greeno cup pet 20 oz c&d pet | 7370699 | - | $0.096550 | Known case count fixes pack extraction from package volume to per-each count. |
| applied | known_pack_extraction | greeno cup pet 20 oz c&d pet | 7370699 | - | $0.096550 | Known case count fixes pack extraction from package volume to per-each count. |
| applied | same_sku_pack_profile | greeno lid flat with hole 20 oz pe pet | 7190716 | - | $0.006495 | Same vendor/SKU has a prior working per-each packaging profile. |

## Review Items

| Kind | Canonical | SKU | Unit | Uses | Reason |
| --- | --- | --- | --- | ---: | --- |
| excluded_non_recipe_scope | fuel surcharge | - | - | 0 | Matched line is outside recipe/per-order packaging scope. |
| excluded_non_recipe_scope | ketchup vol-pack heinz | G216 | - | 0 | Matched line is outside recipe/per-order packaging scope. |
| manual_review_required | imported fresh tomato bulk 5x6 fresh | 1763432 | lb | 1 | Recipe-scope matched line still cannot derive a normalized price after safe fix checks. |
| missing_recipe_unit | cup plastic 10 oz clear pp | PBS10-CUP | - | 0 | Canonical is recipe-scope but has no recipeUnit; no automatic unit can be inferred safely. |
| excluded_non_recipe_scope | can liner 40 x 46 1.5 mil black roll | 40X46ROLL | - | 0 | Matched line is outside recipe/per-order packaging scope. |
| manual_review_required | packer onion sweet fresh | 3812807 | lb | 2 | Recipe-scope matched line still cannot derive a normalized price after safe fix checks. |
| excluded_non_recipe_scope | paper roll thermal 3-1/8 x 220 ft bpa/bps free | 32096 | - | 0 | Matched line is outside recipe/per-order packaging scope. |
| excluded_non_recipe_scope | hellmann mayonnaise extra heavy | 6004857 | - | 0 | Matched line is outside recipe/per-order packaging scope. |
| manual_review_required | tray pulp 4-cup carrier 8-32 oz | 14960 | cs | 0 | Recipe-scope matched line still cannot derive a normalized price after safe fix checks. |
| manual_review_required | water crystal geyser spring | 12345 | oz | 1 | Recipe-scope matched line still cannot derive a normalized price after safe fix checks. |
| excluded_non_recipe_scope | bleach 6% epa registered | 24541 | - | 0 | Matched line is outside recipe/per-order packaging scope. |
| excluded_non_recipe_scope | sys cls mayonnaise banquet xhv duty | 71355SYS | - | 0 | Matched line is outside recipe/per-order packaging scope. |
| excluded_non_recipe_scope | sugar packet | 4000899 | - | 0 | Matched line is outside recipe/per-order packaging scope. |
| excluded_non_recipe_scope | syrup pibb xtra | NFBGMRP | - | 0 | Matched line is outside recipe/per-order packaging scope. |
| manual_review_required | napkin dispenser 2-ply 8.5 x 6.5 white | - | each | 6 | Recipe-scope matched line still cannot derive a normalized price after safe fix checks. |
| manual_review_required | towel multifold kraft 1-ply | - | each | 0 | Recipe-scope matched line still cannot derive a normalized price after safe fix checks. |
| manual_review_required | embossed bath tissue 2-ply recycled individually wrapped | 30394 | cs | 0 | Recipe-scope matched line still cannot derive a normalized price after safe fix checks. |
