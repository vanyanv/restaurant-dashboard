-- Migration: CanonicalIngredient product-photo fields
-- Date: 2026-05-12
--
-- Summary:
--   Adds three nullable fields to CanonicalIngredient so each canonical can
--   carry one product reference photo stored in R2:
--     - photoBlobPathname (string, nullable)   R2 object key under `products/`
--     - photoContentType  (string, nullable)   "image/jpeg" | "image/png" | "image/webp"
--     - photoUploadedAt   (timestamp, nullable)
--
--   All additive nullable, no backfill needed. Existing rows start with nulls.
--   Upload is gated to Role.DEVELOPER; reads are streamed via an
--   authenticated Next.js API route (no public URL is stored).
--
-- Note: `npx prisma db push` has applied these changes to the dev DB.
-- This file documents the change for parity with other manual migrations.

BEGIN;

ALTER TABLE "CanonicalIngredient"
  ADD COLUMN IF NOT EXISTS "photoBlobPathname" TEXT,
  ADD COLUMN IF NOT EXISTS "photoContentType"  TEXT,
  ADD COLUMN IF NOT EXISTS "photoUploadedAt"   TIMESTAMP(3);

COMMIT;
