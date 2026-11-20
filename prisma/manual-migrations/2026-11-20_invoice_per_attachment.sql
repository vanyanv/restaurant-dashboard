-- 2026-11-20: one Invoice row per PDF, not per email.
--
-- The sync read only the first PDF in an email, and "emailMessageId" was
-- unique, so a second bill in the same email was never stored and a statement
-- PDF sent first set the whole email aside. Each PDF is now its own row,
-- keyed by (message, PDF position). Existing rows were all the first PDF and
-- take 0 from the column default, so the sync's "already done" check keeps
-- skipping them.
--
-- "ingredientMatchedAt" marks invoices whose ingredient matching finished.
-- The sync retries recent invoices where it is null. Existing rows are
-- stamped with their createdAt so this change does not re-run matching (or
-- AI auto-match calls) over invoices that were already matched at sync time.
--
-- APPLY BEFORE DEPLOYING the code that writes "emailAttachmentIndex": the new
-- sync inserts a second row for the same message, which the old unique index
-- refuses. Run in this order, each statement on its own (CONCURRENTLY cannot
-- run inside a transaction). Then `prisma db push` should report no change.

-- 1. The discriminator. Default 0 = the first PDF, which every existing row is.
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "emailAttachmentIndex" INTEGER NOT NULL DEFAULT 0;

-- 2. The new identity, built before the old one goes so there is never a
--    moment without a unique guard on the message.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Invoice_emailMessageId_emailAttachmentIndex_key" ON "Invoice" ("emailMessageId", "emailAttachmentIndex");

-- 3. Drop the old single-column unique (Prisma created it as an index).
DROP INDEX CONCURRENTLY IF EXISTS "Invoice_emailMessageId_key";

-- 4. Ingredient-matching completion stamp, nullable.
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "ingredientMatchedAt" TIMESTAMP(3);

-- 5. Existing invoices were matched (or attempted) when they were synced.
UPDATE "Invoice" SET "ingredientMatchedAt" = "createdAt" WHERE "ingredientMatchedAt" IS NULL;
