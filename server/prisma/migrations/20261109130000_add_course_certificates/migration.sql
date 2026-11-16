ALTER TABLE "Certificate"
ADD COLUMN "courseId" TEXT;

CREATE UNIQUE INDEX "Certificate_studentId_courseId_key"
ON "Certificate"("studentId", "courseId");

CREATE INDEX "Certificate_courseId_idx"
ON "Certificate"("courseId");

ALTER TABLE "Certificate"
ADD CONSTRAINT "Certificate_courseId_fkey"
FOREIGN KEY ("courseId") REFERENCES "Course"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
