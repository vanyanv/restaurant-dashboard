-- People (Admin > People, developer only): invites name who they are for and
-- what role they get, and a person's access can be removed without deleting
-- the row their invoices, recipes and counts point at.
-- Additive only: four nullable/defaulted columns and one index.
ALTER TABLE "Invite" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "Invite" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "Invite" ADD COLUMN IF NOT EXISTS "role" "Role" NOT NULL DEFAULT 'OWNER';
CREATE INDEX IF NOT EXISTS "Invite_accountId_email_idx" ON "Invite"("accountId", "email");

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "removedAt" TIMESTAMP(3);
