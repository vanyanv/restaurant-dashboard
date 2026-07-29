-- Persist WHY an invoice was routed to REVIEW. The sync already computed
-- line-math mismatches, pack-shape anomalies, and total-reconciliation gaps,
-- then logged them to the server console and threw them away — the owner saw
-- a bare REVIEW badge with no explanation. Stored as a ReviewReason[] JSON
-- array (see src/lib/invoice-sanity.ts). Additive and nullable; legacy rows
-- get reasons recomputed on the fly from rawExtractionJson at read time.
-- Applied via `prisma db push` on 2026-07-29; this file is the record.

ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "reviewReasons" JSONB;
