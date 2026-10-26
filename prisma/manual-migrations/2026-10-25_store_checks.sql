-- 2026-10-25 — Store cleaning checks (Morning, Transition, Evening).
--
-- Adds per-store check templates (time windows in LA wall-clock minutes,
-- sections, bilingual items), crew members with 4-digit PINs (synced from
-- Harri or added by hand), one locked submission per store/kind/business day
-- (the unique key IS the lock), section photos, "started" markers, and
-- store-closed days. Store gains a public `checkCode` for its QR poster.
-- Missed/late checks become Alert rows with source/target STORE_CHECK.
--
-- Purely additive: two new enum values, one nullable column, new tables.
-- Run AFTER `npm run db:drift` reports "No difference detected".
-- `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block on older
-- Postgres; run this file statement by statement (or via `prisma db push`).

-- CreateEnum
CREATE TYPE "CheckKind" AS ENUM ('MORNING', 'TRANSITION', 'EVENING');

-- CreateEnum
CREATE TYPE "CrewSource" AS ENUM ('HARRI', 'MANUAL');

-- AlterEnum
ALTER TYPE "AlertSource" ADD VALUE 'STORE_CHECK';

-- AlterEnum
ALTER TYPE "AlertTarget" ADD VALUE 'STORE_CHECK';

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "checkCode" TEXT;

-- CreateTable
CREATE TABLE "CheckTemplate" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "kind" "CheckKind" NOT NULL,
    "opensAtMin" INTEGER NOT NULL,
    "dueAtMin" INTEGER NOT NULL,
    "graceMin" INTEGER NOT NULL DEFAULT 30,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckSection" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameEs" TEXT,
    "photoRequired" BOOLEAN NOT NULL DEFAULT true,
    "photoHintEn" TEXT,
    "photoHintEs" TEXT,

    CONSTRAINT "CheckSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckItem" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "textEn" TEXT NOT NULL,
    "textEs" TEXT,

    CONSTRAINT "CheckItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrewMember" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "source" "CrewSource" NOT NULL,
    "harriUserId" INTEGER,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "email" TEXT,
    "pin" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "inactiveReason" TEXT,
    "pinEmailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrewMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckSubmission" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "kind" "CheckKind" NOT NULL,
    "businessDate" DATE NOT NULL,
    "crewMemberId" TEXT,
    "crewName" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "flaggedCount" INTEGER NOT NULL DEFAULT 0,
    "content" JSONB NOT NULL,

    CONSTRAINT "CheckSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckPhoto" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "sectionName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckStart" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "kind" "CheckKind" NOT NULL,
    "businessDate" DATE NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckStart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckClosure" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckClosure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckTemplate_storeId_kind_key" ON "CheckTemplate"("storeId", "kind");

-- CreateIndex
CREATE INDEX "CheckSection_templateId_position_idx" ON "CheckSection"("templateId", "position");

-- CreateIndex
CREATE INDEX "CheckItem_sectionId_position_idx" ON "CheckItem"("sectionId", "position");

-- CreateIndex
CREATE INDEX "CrewMember_storeId_idx" ON "CrewMember"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "CrewMember_storeId_pin_key" ON "CrewMember"("storeId", "pin");

-- CreateIndex
CREATE UNIQUE INDEX "CrewMember_storeId_harriUserId_key" ON "CrewMember"("storeId", "harriUserId");

-- CreateIndex
CREATE INDEX "CheckSubmission_storeId_businessDate_idx" ON "CheckSubmission"("storeId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "CheckSubmission_storeId_kind_businessDate_key" ON "CheckSubmission"("storeId", "kind", "businessDate");

-- CreateIndex
CREATE INDEX "CheckPhoto_submissionId_idx" ON "CheckPhoto"("submissionId");

-- CreateIndex
CREATE INDEX "CheckStart_storeId_businessDate_idx" ON "CheckStart"("storeId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "CheckStart_storeId_kind_businessDate_crewMemberId_key" ON "CheckStart"("storeId", "kind", "businessDate", "crewMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckClosure_storeId_businessDate_key" ON "CheckClosure"("storeId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "Store_checkCode_key" ON "Store"("checkCode");

-- AddForeignKey
ALTER TABLE "CheckTemplate" ADD CONSTRAINT "CheckTemplate_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckSection" ADD CONSTRAINT "CheckSection_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CheckTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckItem" ADD CONSTRAINT "CheckItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "CheckSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewMember" ADD CONSTRAINT "CrewMember_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckSubmission" ADD CONSTRAINT "CheckSubmission_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckSubmission" ADD CONSTRAINT "CheckSubmission_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CheckTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckSubmission" ADD CONSTRAINT "CheckSubmission_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "CrewMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckPhoto" ADD CONSTRAINT "CheckPhoto_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "CheckSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckStart" ADD CONSTRAINT "CheckStart_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckStart" ADD CONSTRAINT "CheckStart_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "CrewMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckClosure" ADD CONSTRAINT "CheckClosure_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

