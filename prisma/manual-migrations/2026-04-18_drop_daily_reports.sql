-- Drop manager-assignment + DailyReport feature.
-- Run BEFORE `prisma db push` that narrows the Role enum and deletes the three models.
-- Required: all MANAGER users must be gone before the enum can be narrowed.

BEGIN;

DELETE FROM "PrepTaskStatus";
DELETE FROM "DailyReport";
DELETE FROM "StoreManager";
DELETE FROM "User" WHERE role = 'MANAGER';

COMMIT;
