ALTER TABLE "Intake"
ALTER COLUMN "academicStartDate" TYPE TIMESTAMPTZ(3)
USING (
  "academicStartDate"::timestamp
  AT TIME ZONE COALESCE(NULLIF("timezone", ''), 'UTC')
);
