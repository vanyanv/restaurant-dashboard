-- IngredientMatchDecision: audit + undo record for one automatic ingredient
-- match (Task 8 of the ingredient-auto-match plan). Written by
-- src/lib/ingredient-auto-match.ts; reversed by undoAutoMatch. An UNDONE row
-- is also a permanent suppression (Task 10).
--
-- canonicalIngredientId FK is ON DELETE RESTRICT, not CASCADE: this is
-- audit/history, matching the StockCountLine / InventoryAdjustment
-- convention. mergeCanonicalIngredients re-parents this table before
-- deleting a merged-away canonical, so the audit trail (and any UNDONE
-- suppression rows Task 10 relies on) can't be silently lost to a cascade.
--
-- Applied via `prisma db push` on 2026-07-29 (initial CASCADE version),
-- corrected to RESTRICT the same day per fix-round-1 review; this file
-- reflects the final, currently-applied production schema.

CREATE TABLE "IngredientMatchDecision" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "groupKey" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "sku" TEXT,
    "productName" TEXT NOT NULL,
    "layer" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "topScore" DOUBLE PRECISION,
    "margin" DOUBLE PRECISION,
    "reasoning" TEXT,
    "model" TEXT,
    "candidates" JSONB,
    "canonicalIngredientId" TEXT NOT NULL,
    "createdCanonical" BOOLEAN NOT NULL DEFAULT false,
    "linkedLineItemIds" TEXT[],
    "linkedLineItemCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'APPLIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),
    "undoneById" TEXT,

    CONSTRAINT "IngredientMatchDecision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IngredientMatchDecision_accountId_status_createdAt_idx" ON "IngredientMatchDecision"("accountId", "status", "createdAt");

CREATE INDEX "IngredientMatchDecision_accountId_groupKey_idx" ON "IngredientMatchDecision"("accountId", "groupKey");

ALTER TABLE "IngredientMatchDecision" ADD CONSTRAINT "IngredientMatchDecision_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IngredientMatchDecision" ADD CONSTRAINT "IngredientMatchDecision_canonicalIngredientId_fkey" FOREIGN KEY ("canonicalIngredientId") REFERENCES "CanonicalIngredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
