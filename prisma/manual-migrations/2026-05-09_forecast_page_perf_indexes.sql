-- Forecasts page read-path indexes.
-- These match the dashboard filters used by revenue/menu/food-cost/labor/cash
-- cards and the historical menu/invoice scans used by secondary sections.

CREATE INDEX IF NOT EXISTS "ForecastDailyRevenue_store_date_hour_generated_idx"
  ON "ForecastDailyRevenue" ("storeId", "forecastDate", "hourBucket", "generatedAt" DESC);

CREATE INDEX IF NOT EXISTS "ForecastMenuItem_store_date_sku_generated_idx"
  ON "ForecastMenuItem" ("storeId", "forecastDate", "otterItemSkuId", "generatedAt" DESC);

CREATE INDEX IF NOT EXISTS "OtterMenuItem_store_modifier_date_item_idx"
  ON "OtterMenuItem" ("storeId", "isModifier", "date", "itemName");

CREATE INDEX IF NOT EXISTS "Invoice_account_dueDate_return_idx"
  ON "Invoice" ("accountId", "dueDate", "isReturn");

CREATE INDEX IF NOT EXISTS "Invoice_account_store_dueDate_return_idx"
  ON "Invoice" ("accountId", "storeId", "dueDate", "isReturn");

CREATE INDEX IF NOT EXISTS "Invoice_account_invoiceDate_return_idx"
  ON "Invoice" ("accountId", "invoiceDate", "isReturn");

CREATE INDEX IF NOT EXISTS "OtterDailySummary_store_date_platform_idx"
  ON "OtterDailySummary" ("storeId", "date", "platform");
