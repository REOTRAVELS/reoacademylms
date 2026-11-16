CREATE TYPE "IntakeSeason" AS ENUM ('WINTER', 'SPRING', 'SUMMER', 'FALL');
CREATE TYPE "IntakeStatus" AS ENUM ('UPCOMING', 'ACTIVE', 'COMPLETED', 'ARCHIVED');
CREATE TYPE "IntakeProgramOfferingStatus" AS ENUM ('ACTIVE', 'INACTIVE');

ALTER TABLE "Programme"
ADD COLUMN "qualificationType" TEXT;

CREATE TABLE "Intake" (
    "id" TEXT NOT NULL,
    "gateNumber" INTEGER NOT NULL,
    "season" "IntakeSeason" NOT NULL,
    "year" INTEGER NOT NULL,
    "admissionStartDate" DATE NOT NULL,
    "admissionEndDate" DATE NOT NULL,
    "academicStartDate" DATE NOT NULL,
    "academicEndDate" DATE NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "admissionsOpen" BOOLEAN NOT NULL DEFAULT false,
    "status" "IntakeStatus" NOT NULL DEFAULT 'UPCOMING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Intake_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Intake_gate_season_check" CHECK (
        ("gateNumber" = 1 AND "season" = 'WINTER') OR
        ("gateNumber" = 2 AND "season" = 'SPRING') OR
        ("gateNumber" = 3 AND "season" = 'SUMMER') OR
        ("gateNumber" = 4 AND "season" = 'FALL')
    ),
    CONSTRAINT "Intake_year_check" CHECK ("year" BETWEEN 2000 AND 9999),
    CONSTRAINT "Intake_date_order_check" CHECK (
        "admissionStartDate" <= "admissionEndDate" AND
        "academicStartDate" < "academicEndDate" AND
        "admissionEndDate" <= "academicStartDate"
    ),
    CONSTRAINT "Intake_closed_status_check" CHECK (
        ("status" NOT IN ('COMPLETED', 'ARCHIVED')) OR "admissionsOpen" = false
    ),
    CONSTRAINT "Intake_dates_within_period_check" CHECK (
        ("season" = 'WINTER' AND
         EXTRACT(YEAR FROM "admissionStartDate") = "year" AND EXTRACT(MONTH FROM "admissionStartDate") IN (1, 2, 3) AND
         EXTRACT(YEAR FROM "admissionEndDate") = "year" AND EXTRACT(MONTH FROM "admissionEndDate") IN (1, 2, 3) AND
         EXTRACT(YEAR FROM "academicStartDate") = "year" AND EXTRACT(MONTH FROM "academicStartDate") IN (1, 2, 3) AND
         EXTRACT(YEAR FROM "academicEndDate") = "year" AND EXTRACT(MONTH FROM "academicEndDate") IN (1, 2, 3)) OR
        ("season" = 'SPRING' AND
         EXTRACT(YEAR FROM "admissionStartDate") = "year" AND EXTRACT(MONTH FROM "admissionStartDate") IN (4, 5, 6) AND
         EXTRACT(YEAR FROM "admissionEndDate") = "year" AND EXTRACT(MONTH FROM "admissionEndDate") IN (4, 5, 6) AND
         EXTRACT(YEAR FROM "academicStartDate") = "year" AND EXTRACT(MONTH FROM "academicStartDate") IN (4, 5, 6) AND
         EXTRACT(YEAR FROM "academicEndDate") = "year" AND EXTRACT(MONTH FROM "academicEndDate") IN (4, 5, 6)) OR
        ("season" = 'SUMMER' AND
         EXTRACT(YEAR FROM "admissionStartDate") = "year" AND EXTRACT(MONTH FROM "admissionStartDate") IN (7, 8, 9) AND
         EXTRACT(YEAR FROM "admissionEndDate") = "year" AND EXTRACT(MONTH FROM "admissionEndDate") IN (7, 8, 9) AND
         EXTRACT(YEAR FROM "academicStartDate") = "year" AND EXTRACT(MONTH FROM "academicStartDate") IN (7, 8, 9) AND
         EXTRACT(YEAR FROM "academicEndDate") = "year" AND EXTRACT(MONTH FROM "academicEndDate") IN (7, 8, 9)) OR
        ("season" = 'FALL' AND
         EXTRACT(YEAR FROM "admissionStartDate") = "year" AND EXTRACT(MONTH FROM "admissionStartDate") IN (10, 11, 12) AND
         EXTRACT(YEAR FROM "admissionEndDate") = "year" AND EXTRACT(MONTH FROM "admissionEndDate") IN (10, 11, 12) AND
         EXTRACT(YEAR FROM "academicStartDate") = "year" AND EXTRACT(MONTH FROM "academicStartDate") IN (10, 11, 12) AND
         EXTRACT(YEAR FROM "academicEndDate") = "year" AND EXTRACT(MONTH FROM "academicEndDate") IN (10, 11, 12))
    )
);

CREATE TABLE "IntakeProgramOffering" (
    "id" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "status" "IntakeProgramOfferingStatus" NOT NULL DEFAULT 'INACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IntakeProgramOffering_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Intake_gateNumber_year_key" ON "Intake"("gateNumber", "year");
CREATE INDEX "Intake_year_status_idx" ON "Intake"("year", "status");
CREATE UNIQUE INDEX "IntakeProgramOffering_intakeId_programmeId_key"
ON "IntakeProgramOffering"("intakeId", "programmeId");
CREATE UNIQUE INDEX "IntakeProgramOffering_id_programmeId_key"
ON "IntakeProgramOffering"("id", "programmeId");
CREATE INDEX "IntakeProgramOffering_intakeId_status_idx"
ON "IntakeProgramOffering"("intakeId", "status");
CREATE INDEX "IntakeProgramOffering_programmeId_status_idx"
ON "IntakeProgramOffering"("programmeId", "status");

ALTER TABLE "IntakeProgramOffering"
ADD CONSTRAINT "IntakeProgramOffering_intakeId_fkey"
FOREIGN KEY ("intakeId") REFERENCES "Intake"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "IntakeProgramOffering"
ADD CONSTRAINT "IntakeProgramOffering_programmeId_fkey"
FOREIGN KEY ("programmeId") REFERENCES "Programme"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Cohort"
ADD COLUMN "intakeProgramOfferingId" TEXT;

CREATE INDEX "Cohort_intakeProgramOfferingId_programmeId_idx"
ON "Cohort"("intakeProgramOfferingId", "programmeId");

ALTER TABLE "Cohort"
ADD CONSTRAINT "Cohort_intakeProgramOfferingId_programmeId_fkey"
FOREIGN KEY ("intakeProgramOfferingId", "programmeId")
REFERENCES "IntakeProgramOffering"("id", "programmeId")
ON DELETE RESTRICT ON UPDATE CASCADE;
