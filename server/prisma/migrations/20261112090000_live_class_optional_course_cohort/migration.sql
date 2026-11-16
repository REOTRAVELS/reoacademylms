-- Instant (emergency) classes may be launched without a course or cohort.
-- Additive and non-destructive: existing rows keep their values.
ALTER TABLE "LiveClass" ALTER COLUMN "courseId" DROP NOT NULL;
ALTER TABLE "LiveClass" ALTER COLUMN "cohortId" DROP NOT NULL;
