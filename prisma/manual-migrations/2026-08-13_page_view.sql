-- Owner engagement tracking: raw page-view stream.
-- Applied to production with `prisma db push`; this file is the auditable record.
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
