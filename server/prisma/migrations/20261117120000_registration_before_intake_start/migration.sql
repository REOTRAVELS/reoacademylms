ALTER TABLE "Intake"
DROP CONSTRAINT "Intake_date_order_check",
DROP CONSTRAINT "Intake_dates_within_period_check";

ALTER TABLE "Intake"
ALTER COLUMN "admissionStartDate" DROP NOT NULL,
ALTER COLUMN "admissionEndDate" DROP NOT NULL;

ALTER TABLE "Intake"
ADD CONSTRAINT "Intake_date_order_check"
CHECK (
    ("academicStartDate" AT TIME ZONE COALESCE(NULLIF("timezone", ''), 'UTC'))::date < "academicEndDate"
),
ADD CONSTRAINT "Intake_dates_within_period_check"
CHECK (
    ("season" = 'WINTER' AND
     EXTRACT(YEAR FROM ("academicStartDate" AT TIME ZONE COALESCE(NULLIF("timezone", ''), 'UTC'))) = "year" AND
     EXTRACT(MONTH FROM ("academicStartDate" AT TIME ZONE COALESCE(NULLIF("timezone", ''), 'UTC'))) IN (1, 2, 3) AND
     EXTRACT(YEAR FROM "academicEndDate") = "year" AND EXTRACT(MONTH FROM "academicEndDate") IN (1, 2, 3)) OR
    ("season" = 'SPRING' AND
     EXTRACT(YEAR FROM ("academicStartDate" AT TIME ZONE COALESCE(NULLIF("timezone", ''), 'UTC'))) = "year" AND
     EXTRACT(MONTH FROM ("academicStartDate" AT TIME ZONE COALESCE(NULLIF("timezone", ''), 'UTC'))) IN (4, 5, 6) AND
     EXTRACT(YEAR FROM "academicEndDate") = "year" AND EXTRACT(MONTH FROM "academicEndDate") IN (4, 5, 6)) OR
    ("season" = 'SUMMER' AND
     EXTRACT(YEAR FROM ("academicStartDate" AT TIME ZONE COALESCE(NULLIF("timezone", ''), 'UTC'))) = "year" AND
     EXTRACT(MONTH FROM ("academicStartDate" AT TIME ZONE COALESCE(NULLIF("timezone", ''), 'UTC'))) IN (7, 8, 9) AND
     EXTRACT(YEAR FROM "academicEndDate") = "year" AND EXTRACT(MONTH FROM "academicEndDate") IN (7, 8, 9)) OR
    ("season" = 'FALL' AND
     EXTRACT(YEAR FROM ("academicStartDate" AT TIME ZONE COALESCE(NULLIF("timezone", ''), 'UTC'))) = "year" AND
     EXTRACT(MONTH FROM ("academicStartDate" AT TIME ZONE COALESCE(NULLIF("timezone", ''), 'UTC'))) IN (10, 11, 12) AND
     EXTRACT(YEAR FROM "academicEndDate") = "year" AND EXTRACT(MONTH FROM "academicEndDate") IN (10, 11, 12))
);

ALTER TABLE "Intake"
ALTER COLUMN "admissionsOpen" SET DEFAULT true;

ALTER TABLE "IntakeProgramOffering"
ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

UPDATE "Intake"
SET "admissionsOpen" = true
WHERE "academicStartDate" > CURRENT_TIMESTAMP
  AND "status" IN ('UPCOMING', 'ACTIVE');

UPDATE "IntakeProgramOffering" AS offering
SET "status" = 'ACTIVE'
FROM "Intake" AS intake, "Programme" AS programme
WHERE offering."intakeId" = intake."id"
  AND offering."programmeId" = programme."id"
  AND intake."academicStartDate" > CURRENT_TIMESTAMP
  AND intake."status" IN ('UPCOMING', 'ACTIVE')
  AND programme."status" = 'ACTIVE';
