-- Owner engagement tracking: raw page-view stream.
-- APPLIED to production 2026-08-13 via `prisma db execute --file`.
-- Verified afterwards: `prisma migrate diff --from-config-datasource
-- --to-schema prisma/schema.prisma` reports an empty migration.
-- See docs/superpowers/specs/2026-08-13-owner-engagement-tracking-design.md

CREATE TABLE IF NOT EXISTS "PageView" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "path"      TEXT NOT NULL,
  "route"     TEXT NOT NULL,
  "enteredAt" TIMESTAMP(3) NOT NULL,
  "dwellMs"   INTEGER,
  CONSTRAINT "PageView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PageView_userId_enteredAt_idx"
  ON "PageView" ("userId", "enteredAt" DESC);
CREATE INDEX IF NOT EXISTS "PageView_route_enteredAt_idx"
  ON "PageView" ("route", "enteredAt" DESC);
CREATE INDEX IF NOT EXISTS "PageView_enteredAt_idx"
  ON "PageView" ("enteredAt" DESC);
