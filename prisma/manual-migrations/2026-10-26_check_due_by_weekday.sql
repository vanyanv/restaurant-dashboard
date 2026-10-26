-- Store checks: a due time per weekday (e.g. close at 1 am most nights,
-- 2 am Friday to Sunday). Additive; an empty array means "same every day".
ALTER TABLE "CheckTemplate" ADD COLUMN "dueByWeekday" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
