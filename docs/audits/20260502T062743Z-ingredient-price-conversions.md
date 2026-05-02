# Ingredient Price Conversion Audit

Generated: 2026-05-02T06:27:43.071Z
Mode: dry-run
Account: all

## Counts

- matchedLinesScanned: 622
- safeFixes: 0
- actionCanonicals: 0
- reviewCanonicals: 20
- affectedCanonicals: 20
- knownExplicitYield: 0
- knownPackExtraction: 0
- sameSkuPackProfile: 0
- zeroExtendedPrice: 0
- missingRecipeUnit: 1
- manualReviewRequired: 10
- excludedNonRecipeScope: 9

## Safe Fixes

No deterministic fixes found.

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
| manual_review_required | container foam 1-compartment bagged | HT91-BAG | each | 0 | Recipe-scope matched line still cannot derive a normalized price after safe fix checks. |
| manual_review_required | syrup hi-c fruit punch flashin | NFBGFP | gal | 1 | Recipe-scope matched line still cannot derive a normalized price after safe fix checks. |
| manual_review_required | container foam hinged white 9x6.5x2.5 | 965-REY | each | 0 | Recipe-scope matched line still cannot derive a normalized price after safe fix checks. |
| manual_review_required | tray pulp 4-cup carrier 8-32 oz | 14960 | cs | 0 | Recipe-scope matched line still cannot derive a normalized price after safe fix checks. |
| manual_review_required | water crystal geyser spring | 12345 | oz | 1 | Recipe-scope matched line still cannot derive a normalized price after safe fix checks. |
| excluded_non_recipe_scope | bleach 6% epa registered | 24541 | - | 0 | Matched line is outside recipe/per-order packaging scope. |
| excluded_non_recipe_scope | sys cls mayonnaise banquet xhv duty | 71355SYS | - | 0 | Matched line is outside recipe/per-order packaging scope. |
| excluded_non_recipe_scope | sugar packet | 4000899 | - | 0 | Matched line is outside recipe/per-order packaging scope. |
| excluded_non_recipe_scope | syrup pibb xtra | NFBGMRP | - | 0 | Matched line is outside recipe/per-order packaging scope. |
| manual_review_required | napkin dispenser 2-ply 8.5 x 6.5 white | - | each | 6 | Recipe-scope matched line still cannot derive a normalized price after safe fix checks. |
| manual_review_required | towel multifold kraft 1-ply | - | each | 0 | Recipe-scope matched line still cannot derive a normalized price after safe fix checks. |
| manual_review_required | embossed bath tissue 2-ply recycled individually wrapped | 30394 | cs | 0 | Recipe-scope matched line still cannot derive a normalized price after safe fix checks. |
