ALTER TABLE "Assessment"
ADD COLUMN "programOfferingId" TEXT;

CREATE INDEX "Assessment_programOfferingId_courseId_idx"
ON "Assessment"("programOfferingId", "courseId");

ALTER TABLE "Assessment"
ADD CONSTRAINT "Assessment_programOfferingId_fkey"
FOREIGN KEY ("programOfferingId") REFERENCES "IntakeProgramOffering"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
