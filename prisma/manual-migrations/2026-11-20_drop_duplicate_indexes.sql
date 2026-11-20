-- 2026-11-20: drop 33 indexes that repeat the leading columns of another
-- index on the same table, and add two the reads need. Applied to the live
-- database on 2026-11-20 with the owner's go, one statement at a time.
-- CONCURRENTLY cannot run inside a transaction: run each line on its own.
-- The two kept look-alikes (OtterOrder storeId+referenceTimeLocal, and
-- OtterOrderItem orderId) are the narrow versions of the hottest reads.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "OtterOrder_externalDisplayId_idx" ON "OtterOrder" ("externalDisplayId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "OtterRating_storeId_reviewedAt_idx" ON "OtterRating" ("storeId", "reviewedAt");

DROP INDEX CONCURRENTLY IF EXISTS "AlertPreference_accountId_idx";
DROP INDEX CONCURRENTLY IF EXISTS "CanonicalIngredient_accountId_idx";
DROP INDEX CONCURRENTLY IF EXISTS "CanonicalIngredient_ownerId_idx";
DROP INDEX CONCURRENTLY IF EXISTS "CrewMember_storeId_idx";
DROP INDEX CONCURRENTLY IF EXISTS "DailyCogsItem_storeId_date_idx";
DROP INDEX CONCURRENTLY IF EXISTS "ForecastDailyCategory_storeId_date_idx";
DROP INDEX CONCURRENTLY IF EXISTS "ForecastDailyRevenue_storeId_forecastDate_idx";
DROP INDEX CONCURRENTLY IF EXISTS "ForecastHourlyOrders_storeId_forecastDate_idx";
DROP INDEX CONCURRENTLY IF EXISTS "ForecastMenuItem_storeId_forecastDate_idx";
DROP INDEX CONCURRENTLY IF EXISTS "HarriDailyLabor_storeId_date_idx";
DROP INDEX CONCURRENTLY IF EXISTS "HarriEmployee_storeId_idx";
DROP INDEX CONCURRENTLY IF EXISTS "HarriPositionDaily_storeId_date_idx";
DROP INDEX CONCURRENTLY IF EXISTS "IngredientSkuMatch_accountId_idx";
DROP INDEX CONCURRENTLY IF EXISTS "IngredientSkuMatch_ownerId_idx";
DROP INDEX CONCURRENTLY IF EXISTS "Invite_accountId_idx";
DROP INDEX CONCURRENTLY IF EXISTS "Invite_token_idx";
DROP INDEX CONCURRENTLY IF EXISTS "Invoice_accountId_idx";
DROP INDEX CONCURRENTLY IF EXISTS "Invoice_ownerId_idx";
DROP INDEX CONCURRENTLY IF EXISTS "OtterDailySummary_storeId_idx";
DROP INDEX CONCURRENTLY IF EXISTS "OtterDailySummary_store_date_platform_idx";
DROP INDEX CONCURRENTLY IF EXISTS "OtterHourlySummary_storeId_date_idx";
DROP INDEX CONCURRENTLY IF EXISTS "OtterItemMapping_storeId_idx";
DROP INDEX CONCURRENTLY IF EXISTS "OtterMenuCategory_storeId_date_idx";
DROP INDEX CONCURRENTLY IF EXISTS "OtterMenuItem_storeId_date_idx";
DROP INDEX CONCURRENTLY IF EXISTS "OtterRating_storeId_idx";
DROP INDEX CONCURRENTLY IF EXISTS "OtterSubItemMapping_storeId_idx";
DROP INDEX CONCURRENTLY IF EXISTS "Recipe_accountId_idx";
DROP INDEX CONCURRENTLY IF EXISTS "Recipe_ownerId_idx";
DROP INDEX CONCURRENTLY IF EXISTS "StoreEventDetailSignal_storeId_date_idx";
DROP INDEX CONCURRENTLY IF EXISTS "StoreEventSignal_storeId_date_idx";
DROP INDEX CONCURRENTLY IF EXISTS "StoreWeatherSignal_storeId_date_idx";
DROP INDEX CONCURRENTLY IF EXISTS "User_email_idx";
DROP INDEX CONCURRENTLY IF EXISTS "VendorLeadTime_accountId_idx";
