CREATE TYPE "ProgramApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "ProgramEnrollmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'WITHDRAWN', 'SUSPENDED');
CREATE TYPE "NotificationAudienceStatus" AS ENUM ('UNCLASSIFIED', 'CLASSIFIED', 'ARCHIVED');

CREATE UNIQUE INDEX "IntakeProgramOffering_id_intakeId_programmeId_key"
ON "IntakeProgramOffering"("id", "intakeId", "programmeId");

CREATE TABLE "ProgramApplication" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "programOfferingId" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "status" "ProgramApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "adminNotes" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProgramApplication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProgramApplicationStatusHistory" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "fromStatus" "ProgramApplicationStatus",
    "toStatus" "ProgramApplicationStatus" NOT NULL,
    "reason" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProgramApplicationStatusHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProgramEnrollment" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "programOfferingId" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "applicationId" TEXT,
    "status" "ProgramEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProgramEnrollment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProgramApplication_id_studentId_key"
ON "ProgramApplication"("id", "studentId");
CREATE INDEX "ProgramApplication_status_submittedAt_idx"
ON "ProgramApplication"("status", "submittedAt");
CREATE INDEX "ProgramApplication_studentId_submittedAt_idx"
ON "ProgramApplication"("studentId", "submittedAt");
CREATE INDEX "ProgramApplication_programOfferingId_intakeId_programmeId_idx"
ON "ProgramApplication"("programOfferingId", "intakeId", "programmeId");
CREATE INDEX "ProgramApplication_reviewedById_idx"
ON "ProgramApplication"("reviewedById");
CREATE UNIQUE INDEX "ProgramApplication_one_pending_per_student"
ON "ProgramApplication"("studentId") WHERE "status" = 'PENDING';

CREATE INDEX "ProgramApplicationStatusHistory_applicationId_createdAt_idx"
ON "ProgramApplicationStatusHistory"("applicationId", "createdAt");
CREATE INDEX "ProgramApplicationStatusHistory_changedById_idx"
ON "ProgramApplicationStatusHistory"("changedById");

CREATE UNIQUE INDEX "ProgramEnrollment_applicationId_key"
ON "ProgramEnrollment"("applicationId");
CREATE UNIQUE INDEX "ProgramEnrollment_applicationId_studentId_key"
ON "ProgramEnrollment"("applicationId", "studentId");
CREATE INDEX "ProgramEnrollment_studentId_status_idx"
ON "ProgramEnrollment"("studentId", "status");
CREATE INDEX "ProgramEnrollment_programOfferingId_status_idx"
ON "ProgramEnrollment"("programOfferingId", "status");
CREATE INDEX "ProgramEnrollment_programOfferingId_intakeId_programmeId_idx"
ON "ProgramEnrollment"("programOfferingId", "intakeId", "programmeId");
CREATE UNIQUE INDEX "ProgramEnrollment_one_active_per_student"
ON "ProgramEnrollment"("studentId") WHERE "status" = 'ACTIVE';

ALTER TABLE "Notification"
ADD COLUMN "programmeId" TEXT,
ADD COLUMN "programOfferingId" TEXT,
ADD COLUMN "isGlobal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "audienceStatus" "NotificationAudienceStatus" NOT NULL DEFAULT 'UNCLASSIFIED';

ALTER TABLE "Notification"
ALTER COLUMN "audienceStatus" SET DEFAULT 'CLASSIFIED';

CREATE INDEX "Notification_userId_audienceStatus_programmeId_programOffer_idx"
ON "Notification"("userId", "audienceStatus", "programmeId", "programOfferingId", "isGlobal");
CREATE INDEX "Notification_userId_audienceStatus_read_createdAt_idx"
ON "Notification"("userId", "audienceStatus", "read", "createdAt");
CREATE INDEX "Notification_audienceStatus_createdAt_id_idx"
ON "Notification"("audienceStatus", "createdAt", "id");

ALTER TABLE "Notification"
ADD CONSTRAINT "Notification_programmeId_fkey"
FOREIGN KEY ("programmeId") REFERENCES "Programme"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Notification"
ADD CONSTRAINT "Notification_programOfferingId_programmeId_fkey"
FOREIGN KEY ("programOfferingId", "programmeId") REFERENCES "IntakeProgramOffering"("id", "programmeId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Notification"
ADD CONSTRAINT "Notification_classified_audience_check"
CHECK (
    "audienceStatus" <> 'CLASSIFIED'
    OR ("isGlobal" AND "programmeId" IS NULL AND "programOfferingId" IS NULL)
    OR (NOT "isGlobal" AND "programmeId" IS NOT NULL)
);

CREATE TABLE "ProgramEnrollmentAssignmentHistory" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "previousState" JSONB NOT NULL,
    "newAssignment" JSONB NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProgramEnrollmentAssignmentHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProgramEnrollmentAssignmentHistory_enrollmentId_key"
ON "ProgramEnrollmentAssignmentHistory"("enrollmentId");
CREATE INDEX "ProgramEnrollmentAssignmentHistory_studentId_assignedAt_idx"
ON "ProgramEnrollmentAssignmentHistory"("studentId", "assignedAt");
CREATE INDEX "ProgramEnrollmentAssignmentHistory_assignedById_assignedAt_idx"
ON "ProgramEnrollmentAssignmentHistory"("assignedById", "assignedAt");

CREATE TABLE "NotificationClassificationHistory" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "previousClassification" JSONB NOT NULL,
    "newClassification" JSONB NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationClassificationHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NotificationClassificationHistory_notificationId_changedAt_idx"
ON "NotificationClassificationHistory"("notificationId", "changedAt");
CREATE INDEX "NotificationClassificationHistory_changedById_changedAt_idx"
ON "NotificationClassificationHistory"("changedById", "changedAt");

ALTER TABLE "ProgramApplication"
ADD CONSTRAINT "ProgramApplication_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProgramApplication"
ADD CONSTRAINT "ProgramApplication_programOfferingId_intakeId_programmeId_fkey"
FOREIGN KEY ("programOfferingId", "intakeId", "programmeId")
REFERENCES "IntakeProgramOffering"("id", "intakeId", "programmeId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProgramApplication"
ADD CONSTRAINT "ProgramApplication_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProgramApplicationStatusHistory"
ADD CONSTRAINT "ProgramApplicationStatusHistory_applicationId_fkey"
FOREIGN KEY ("applicationId") REFERENCES "ProgramApplication"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProgramApplicationStatusHistory"
ADD CONSTRAINT "ProgramApplicationStatusHistory_changedById_fkey"
FOREIGN KEY ("changedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProgramEnrollment"
ADD CONSTRAINT "ProgramEnrollment_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProgramEnrollment"
ADD CONSTRAINT "ProgramEnrollment_programOfferingId_intakeId_programmeId_fkey"
FOREIGN KEY ("programOfferingId", "intakeId", "programmeId")
REFERENCES "IntakeProgramOffering"("id", "intakeId", "programmeId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProgramEnrollment"
ADD CONSTRAINT "ProgramEnrollment_applicationId_studentId_fkey"
FOREIGN KEY ("applicationId", "studentId") REFERENCES "ProgramApplication"("id", "studentId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProgramEnrollmentAssignmentHistory"
ADD CONSTRAINT "ProgramEnrollmentAssignmentHistory_enrollmentId_fkey"
FOREIGN KEY ("enrollmentId") REFERENCES "ProgramEnrollment"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProgramEnrollmentAssignmentHistory"
ADD CONSTRAINT "ProgramEnrollmentAssignmentHistory_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProgramEnrollmentAssignmentHistory"
ADD CONSTRAINT "ProgramEnrollmentAssignmentHistory_assignedById_fkey"
FOREIGN KEY ("assignedById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationClassificationHistory"
ADD CONSTRAINT "NotificationClassificationHistory_notificationId_fkey"
FOREIGN KEY ("notificationId") REFERENCES "Notification"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationClassificationHistory"
ADD CONSTRAINT "NotificationClassificationHistory_changedById_fkey"
FOREIGN KEY ("changedById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

