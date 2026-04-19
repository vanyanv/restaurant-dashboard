-- Migration: Otter order-level data + skuId on OtterItemMapping
-- Date: 2026-04-18
--
-- Summary:
--   1. Add skuId (nullable) to OtterItemMapping for stable-id mappings
--   2. Create OtterOrder / OtterOrderItem / OtterOrderSubItem tables
--
-- Safe to re-run: uses IF NOT EXISTS guards.
-- After this, run `npx prisma generate`.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. OtterItemMapping.skuId
-- ---------------------------------------------------------------------------

ALTER TABLE "OtterItemMapping" ADD COLUMN IF NOT EXISTS "skuId" TEXT;
CREATE INDEX IF NOT EXISTS "OtterItemMapping_skuId_idx" ON "OtterItemMapping"("skuId");

-- ---------------------------------------------------------------------------
-- 2. OtterOrder
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "OtterOrder" (
  "id"                 TEXT PRIMARY KEY,
  "otterOrderId"       TEXT NOT NULL,
  "externalDisplayId"  TEXT,
  "storeId"            TEXT NOT NULL,
  "otterStoreId"       TEXT NOT NULL,
  "platform"           TEXT NOT NULL,
  "referenceTimeLocal" TIMESTAMP(3) NOT NULL,
  "fulfillmentMode"    TEXT,
  "orderStatus"        TEXT,
  "acceptanceStatus"   TEXT,
  "subtotal"           DOUBLE PRECISION NOT NULL DEFAULT 0,
  "tax"                DOUBLE PRECISION NOT NULL DEFAULT 0,
  "tip"                DOUBLE PRECISION NOT NULL DEFAULT 0,
  "commission"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "discount"           DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total"              DOUBLE PRECISION NOT NULL DEFAULT 0,
  "customerName"       TEXT,
  "detailsFetchedAt"   TIMESTAMP(3),
  "syncedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OtterOrder_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "OtterOrder_otterOrderId_key" ON "OtterOrder"("otterOrderId");
CREATE INDEX IF NOT EXISTS "OtterOrder_storeId_referenceTimeLocal_idx" ON "OtterOrder"("storeId", "referenceTimeLocal");
CREATE INDEX IF NOT EXISTS "OtterOrder_detailsFetchedAt_idx" ON "OtterOrder"("detailsFetchedAt");
CREATE INDEX IF NOT EXISTS "OtterOrder_platform_idx" ON "OtterOrder"("platform");

-- ---------------------------------------------------------------------------
-- 3. OtterOrderItem
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "OtterOrderItem" (
  "id"       TEXT PRIMARY KEY,
  "orderId"  TEXT NOT NULL,
  "skuId"    TEXT NOT NULL,
  "name"     TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "price"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  CONSTRAINT "OtterOrderItem_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "OtterOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "OtterOrderItem_orderId_idx" ON "OtterOrderItem"("orderId");
CREATE INDEX IF NOT EXISTS "OtterOrderItem_skuId_idx" ON "OtterOrderItem"("skuId");

-- ---------------------------------------------------------------------------
-- 4. OtterOrderSubItem
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "OtterOrderSubItem" (
  "id"          TEXT PRIMARY KEY,
  "orderItemId" TEXT NOT NULL,
  "skuId"       TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "quantity"    DOUBLE PRECISION NOT NULL,
  "price"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "subHeader"   TEXT,
  CONSTRAINT "OtterOrderSubItem_orderItemId_fkey"
    FOREIGN KEY ("orderItemId") REFERENCES "OtterOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "OtterOrderSubItem_orderItemId_idx" ON "OtterOrderSubItem"("orderItemId");
CREATE INDEX IF NOT EXISTS "OtterOrderSubItem_skuId_idx" ON "OtterOrderSubItem"("skuId");

COMMIT;
