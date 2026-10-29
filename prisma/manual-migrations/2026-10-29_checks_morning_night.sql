-- Store checks become Morning and Night only, with a shared live form.
--
-- Morning: crew see it from 9:00 am, submit 4:30-5:30 pm, then missed.
-- Night:   crew see it from 5:30 pm, submit 12:30-2:00 am (Mon-Thu nights)
--          or 12:30-3:00 am (Fri-Sun nights), then missed. No grace.
-- Photos move from sections onto the tasks the owner marks.
-- Every tick is a CheckMark row: who, when, photo.
-- Submitted checks are emailed to Account.checkReportEmails.
--
-- Run in one transaction. Additive columns first, then data.

BEGIN;

ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "checkReportEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "CheckTemplate" ADD COLUMN IF NOT EXISTS "submitFromMin" INTEGER;
ALTER TABLE "CheckItem" ADD COLUMN IF NOT EXISTS "photoRequired" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "CheckMark" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "kind" "CheckKind" NOT NULL,
  "businessDate" DATE NOT NULL,
  "itemId" TEXT NOT NULL,
  "itemText" TEXT NOT NULL,
  "sectionName" TEXT NOT NULL,
  "done" BOOLEAN NOT NULL,
  "note" TEXT,
  "crewMemberId" TEXT,
  "crewName" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "photoKey" TEXT,
  "photoType" TEXT,
  "photoSize" INTEGER,
  CONSTRAINT "CheckMark_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CheckMark_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CheckMark_storeId_businessDate_kind_at_idx"
  ON "CheckMark"("storeId", "businessDate", "kind", "at");

-- Windows.
UPDATE "CheckTemplate"
   SET "opensAtMin" = 540, "submitFromMin" = 990, "dueAtMin" = 1050,
       "dueByWeekday" = ARRAY[]::INTEGER[], "graceMin" = 0, "updatedAt" = now()
 WHERE "kind" = 'MORNING';

UPDATE "CheckTemplate"
   SET "opensAtMin" = 1050, "submitFromMin" = 1470, "dueAtMin" = 1560,
       "dueByWeekday" = ARRAY[1620,1560,1560,1560,1560,1620,1620], "graceMin" = 0, "updatedAt" = now()
 WHERE "kind" = 'EVENING';

UPDATE "CheckTemplate" SET "enabled" = false, "updatedAt" = now() WHERE "kind" = 'TRANSITION';

-- Morning list: the owner's 8 tasks, one section, every store.
DELETE FROM "CheckSection" s USING "CheckTemplate" t
 WHERE s."templateId" = t."id" AND t."kind" = 'MORNING';

INSERT INTO "CheckSection" ("id", "templateId", "position", "nameEn", "nameEs", "photoRequired")
SELECT gen_random_uuid()::text, t."id", 0, 'Morning tasks', 'Tareas de la mañana', false
  FROM "CheckTemplate" t WHERE t."kind" = 'MORNING';

INSERT INTO "CheckItem" ("id", "sectionId", "position", "textEn", "textEs", "photoRequired")
SELECT gen_random_uuid()::text, s."id", v.pos, v.en, v.es, v.photo
  FROM "CheckSection" s
  JOIN "CheckTemplate" t ON t."id" = s."templateId" AND t."kind" = 'MORNING'
 CROSS JOIN (VALUES
   (0, 'Set up kitchen', 'Preparar la cocina', false),
   (1, 'Do prep', 'Hacer la preparación', false),
   (2, 'Organize walk-in', 'Organizar la cámara fría', true),
   (3, 'Sweep floors', 'Barrer los pisos', false),
   (4, 'Mop floors with degreaser and detergent', 'Trapear los pisos con desengrasante y detergente', true),
   (5, 'Take out trash before shift change', 'Sacar la basura antes del cambio de turno', false),
   (6, 'Clean dishes before shift change', 'Lavar los platos antes del cambio de turno', true),
   (7, 'Restock all stations before shift change', 'Surtir todas las estaciones antes del cambio de turno', false)
 ) AS v(pos, en, es, photo);

-- Night (and any other) sections that required a photo: the photo becomes
-- its own task at the end of the section, worded from the old photo hint.
INSERT INTO "CheckItem" ("id", "sectionId", "position", "textEn", "textEs", "photoRequired")
SELECT gen_random_uuid()::text, s."id",
       COALESCE((SELECT max(i."position") + 1 FROM "CheckItem" i WHERE i."sectionId" = s."id"), 0),
       COALESCE(NULLIF(s."photoHintEn", ''), s."nameEn" || ' photo'),
       COALESCE(NULLIF(s."photoHintEs", ''), 'Foto: ' || COALESCE(s."nameEs", s."nameEn")),
       true
  FROM "CheckSection" s
 WHERE s."photoRequired" = true;

UPDATE "CheckSection" SET "photoRequired" = false WHERE "photoRequired" = true;

-- Who gets the email when a check is submitted.
UPDATE "Account"
   SET "checkReportEmails" = ARRAY['chris@chrisneddys.com', 'vardan.vanyan@gmail.com']
 WHERE "id" = 'acc_default_chrisneddys' AND cardinality("checkReportEmails") = 0;

-- Old per-check alerts are replaced by one alert per store per day.
UPDATE "Alert" SET "status" = 'DISMISSED'
 WHERE "source" = 'STORE_CHECK' AND "status" = 'OPEN';

COMMIT;
