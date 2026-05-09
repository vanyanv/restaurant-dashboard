-- F16: Per-(store, item) price elasticity, computed by the nightly ML
-- pipeline via log(qty) ~ log(price) OLS.

CREATE TABLE IF NOT EXISTS "MenuItemElasticity" (
  "id"              TEXT PRIMARY KEY,
  "storeId"         TEXT NOT NULL,
  "otterItemSkuId"  TEXT NOT NULL,
  "elasticity"      DOUBLE PRECISION NOT NULL,
  "intercept"       DOUBLE PRECISION NOT NULL,
  "fitR2"           DOUBLE PRECISION NOT NULL,
  "sampleSize"      INTEGER NOT NULL,
  "pricePointCount" INTEGER NOT NULL,
  "meanPrice"       DOUBLE PRECISION NOT NULL,
  "meanQty"         DOUBLE PRECISION NOT NULL,
  "computedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MenuItemElasticity_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "MenuItemElasticity_unique"
  ON "MenuItemElasticity" ("storeId", "otterItemSkuId");

CREATE INDEX IF NOT EXISTS "MenuItemElasticity_storeId_computedAt_idx"
  ON "MenuItemElasticity" ("storeId", "computedAt" DESC);
