-- 2026-10-25 — An order line with no SKU is still an order line.
--
-- Context: Otter's order-details GraphQL returns `skuId: null` for POS
-- "Open item" lines (a cashier-typed price with no catalogue entry). Both
-- `OtterOrderItem.skuId` and `OtterOrderSubItem.skuId` were NOT NULL, so
-- `persistOrderItems` threw on the whole order and its items were never
-- written — five orders in the 2026-09 → 10 backfill lost their lines this
-- way, silently, with the order header intact.
--
-- Nothing reads a NULL as an identity: the sub-item aggregation in
-- `menu-item-actions.ts` already filters `"skuId" IS NOT NULL`, and the
-- mapping unique key `(storeId, skuId)` lives on `OtterItemMapping`, not here.
-- Run AFTER `npm run db:drift` reports "No difference detected".

ALTER TABLE "OtterOrderItem"    ALTER COLUMN "skuId" DROP NOT NULL;
ALTER TABLE "OtterOrderSubItem" ALTER COLUMN "skuId" DROP NOT NULL;
