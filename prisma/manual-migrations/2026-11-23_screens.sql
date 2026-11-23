-- 2026-11-23 Screens: TV menu boards (Screen, ScreenPairing, ScreenPlaylist, ScreenSlide, ScreenMedia).
-- Additive only: five new tables, their indexes and foreign keys. Nothing existing changes.
BEGIN;
-- CreateTable
CREATE TABLE "Screen" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "playlistId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "device" TEXT,
    "pairedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Screen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenPairing" (
    "code" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "device" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreenPairing_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ScreenPlaylist" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "storeId" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreenPlaylist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenSlide" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "seconds" INTEGER NOT NULL DEFAULT 10,

    CONSTRAINT "ScreenSlide_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenMedia" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "storeId" TEXT,
    "name" TEXT NOT NULL,
    "blobKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreenMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Screen_tokenHash_key" ON "Screen"("tokenHash");

-- CreateIndex
CREATE INDEX "Screen_accountId_storeId_idx" ON "Screen"("accountId", "storeId");

-- CreateIndex
CREATE INDEX "Screen_playlistId_idx" ON "Screen"("playlistId");

-- CreateIndex
CREATE UNIQUE INDEX "ScreenPairing_tokenHash_key" ON "ScreenPairing"("tokenHash");

-- CreateIndex
CREATE INDEX "ScreenPairing_expiresAt_idx" ON "ScreenPairing"("expiresAt");

-- CreateIndex
CREATE INDEX "ScreenPlaylist_accountId_storeId_idx" ON "ScreenPlaylist"("accountId", "storeId");

-- CreateIndex
CREATE INDEX "ScreenSlide_playlistId_position_idx" ON "ScreenSlide"("playlistId", "position");

-- CreateIndex
CREATE INDEX "ScreenSlide_mediaId_idx" ON "ScreenSlide"("mediaId");

-- CreateIndex
CREATE UNIQUE INDEX "ScreenMedia_blobKey_key" ON "ScreenMedia"("blobKey");

-- CreateIndex
CREATE INDEX "ScreenMedia_accountId_storeId_idx" ON "ScreenMedia"("accountId", "storeId");

-- AddForeignKey
ALTER TABLE "Screen" ADD CONSTRAINT "Screen_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screen" ADD CONSTRAINT "Screen_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "ScreenPlaylist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenPlaylist" ADD CONSTRAINT "ScreenPlaylist_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenSlide" ADD CONSTRAINT "ScreenSlide_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "ScreenPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenSlide" ADD CONSTRAINT "ScreenSlide_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "ScreenMedia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenMedia" ADD CONSTRAINT "ScreenMedia_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;
