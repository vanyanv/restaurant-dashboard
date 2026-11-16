/**
 * A count line saved with some of its boxes unconverted (trays, chubs or
 * buckets with no size set yet) carries this as its `nativeUnit`. Its
 * `qtyInRecipeUnit` is only the part that could be converted, so it is a
 * floor, not the shelf — it must never become the base that running
 * on-hand, Order next or the calibration model roll forward from.
 */
export const UNCONVERTED_UNIT = "partial"

/** Prisma `where` for count lines that may anchor on-hand. */
export const anchorLineWhere = {
  OR: [{ nativeUnit: null }, { nativeUnit: { not: UNCONVERTED_UNIT } }],
}
