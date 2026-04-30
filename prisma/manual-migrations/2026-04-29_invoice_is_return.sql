-- Add isReturn flag to Invoice for return / credit-memo handling.
-- When true, totalAmount and line-item amounts are stored with their natural
-- negative sign so SUM() yields net spend without special-casing.

ALTER TABLE "Invoice"
ADD COLUMN "isReturn" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Invoice_accountId_isReturn_idx"
ON "Invoice" ("accountId", "isReturn");
