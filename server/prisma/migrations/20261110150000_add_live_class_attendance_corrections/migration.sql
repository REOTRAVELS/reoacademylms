CREATE TYPE "LiveClassCorrectionType" AS ENUM ('JOIN_TIME', 'LEAVE_TIME', 'DURATION');

ALTER TABLE "LiveClassPresence"
    ADD COLUMN "rejoinCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "totalDuration" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "disconnectionDuration" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "isTrainer" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "attendanceCorrectionId" TEXT;

CREATE TABLE "LiveClassCorrection" (
    "id" TEXT NOT NULL,
    "liveClassId" TEXT NOT NULL,
    "presenceId" TEXT NOT NULL,
    "type" "LiveClassCorrectionType" NOT NULL,
    "originalValue" TEXT NOT NULL,
    "correctedValue" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "correctedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LiveClassCorrection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LiveClassPresence_liveClassId_userId_idx"
    ON "LiveClassPresence"("liveClassId", "userId");
CREATE INDEX "LiveClassCorrection_liveClassId_createdAt_idx"
    ON "LiveClassCorrection"("liveClassId", "createdAt");
CREATE INDEX "LiveClassCorrection_presenceId_createdAt_idx"
    ON "LiveClassCorrection"("presenceId", "createdAt");

ALTER TABLE "LiveClassPresence" ADD CONSTRAINT "LiveClassPresence_attendanceCorrectionId_fkey"
    FOREIGN KEY ("attendanceCorrectionId") REFERENCES "LiveClassCorrection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LiveClassCorrection" ADD CONSTRAINT "LiveClassCorrection_liveClassId_fkey"
    FOREIGN KEY ("liveClassId") REFERENCES "LiveClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveClassCorrection" ADD CONSTRAINT "LiveClassCorrection_presenceId_fkey"
    FOREIGN KEY ("presenceId") REFERENCES "LiveClassPresence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveClassCorrection" ADD CONSTRAINT "LiveClassCorrection_correctedById_fkey"
    FOREIGN KEY ("correctedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
