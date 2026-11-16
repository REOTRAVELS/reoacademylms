CREATE TYPE "LiveClassStatus" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED');

CREATE TABLE "LiveClass" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "roomName" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMins" INTEGER NOT NULL DEFAULT 60,
    "status" "LiveClassStatus" NOT NULL DEFAULT 'SCHEDULED',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LiveClass_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiveClassPresence" (
    "id" TEXT NOT NULL,
    "liveClassId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    CONSTRAINT "LiveClassPresence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiveClass_roomName_key" ON "LiveClass"("roomName");
CREATE INDEX "LiveClass_cohortId_startsAt_idx" ON "LiveClass"("cohortId", "startsAt");
CREATE INDEX "LiveClass_courseId_startsAt_idx" ON "LiveClass"("courseId", "startsAt");
CREATE INDEX "LiveClassPresence_liveClassId_joinedAt_idx" ON "LiveClassPresence"("liveClassId", "joinedAt");
CREATE INDEX "LiveClassPresence_userId_joinedAt_idx" ON "LiveClassPresence"("userId", "joinedAt");

ALTER TABLE "LiveClass" ADD CONSTRAINT "LiveClass_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveClass" ADD CONSTRAINT "LiveClass_cohortId_fkey"
  FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveClass" ADD CONSTRAINT "LiveClass_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LiveClassPresence" ADD CONSTRAINT "LiveClassPresence_liveClassId_fkey"
  FOREIGN KEY ("liveClassId") REFERENCES "LiveClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveClassPresence" ADD CONSTRAINT "LiveClassPresence_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
