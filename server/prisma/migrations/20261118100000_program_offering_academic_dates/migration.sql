ALTER TABLE "IntakeProgramOffering"
ADD COLUMN "academicStartDate" TIMESTAMPTZ(3),
ADD COLUMN "academicEndDate" DATE;

UPDATE "IntakeProgramOffering" AS offering
SET
    "academicStartDate" = intake."academicStartDate",
    "academicEndDate" = intake."academicEndDate"
FROM "Intake" AS intake
WHERE offering."intakeId" = intake."id";

ALTER TABLE "IntakeProgramOffering"
ALTER COLUMN "academicStartDate" SET NOT NULL,
ALTER COLUMN "academicEndDate" SET NOT NULL;

CREATE INDEX "IntakeProgramOffering_status_academicStartDate_idx"
ON "IntakeProgramOffering"("status", "academicStartDate");

ALTER TABLE "Intake"
DROP CONSTRAINT "Intake_date_order_check",
DROP CONSTRAINT "Intake_dates_within_period_check",
DROP COLUMN "academicStartDate",
DROP COLUMN "academicEndDate";
