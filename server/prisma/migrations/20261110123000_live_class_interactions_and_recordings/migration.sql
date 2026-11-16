CREATE TYPE "LiveClassInteractionType" AS ENUM (
    'HAND_RAISE', 'POLL', 'POLL_RESPONSE', 'QUIZ', 'QUIZ_RESPONSE',
    'QUESTION', 'ANSWER', 'ANNOUNCEMENT', 'EXERCISE',
    'EXERCISE_COMPLETION', 'CHAT', 'PRESENTER_PERMISSION'
);
CREATE TYPE "LiveClassInteractionStatus" AS ENUM ('PENDING', 'PUBLISHED', 'HIDDEN', 'RESOLVED', 'CLOSED');
CREATE TYPE "LiveClassEngagementType" AS ENUM (
    'POLL_RESPONSE', 'QUESTION', 'DISCUSSION', 'EXERCISE_COMPLETION',
    'QUIZ_RESPONSE', 'VERIFIED_PARTICIPATION'
);
CREATE TYPE "LiveClassRecordingStatus" AS ENUM ('STARTING', 'ACTIVE', 'COMPLETE', 'FAILED', 'STOPPED');

ALTER TABLE "LiveClassPresence"
    ADD COLUMN "verifiedAt" TIMESTAMP(3),
    ADD COLUMN "verifiedById" TEXT,
    ADD COLUMN "verificationNote" TEXT;

CREATE TABLE "LiveClassInteraction" (
    "id" TEXT NOT NULL,
    "liveClassId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "parentId" TEXT,
    "type" "LiveClassInteractionType" NOT NULL,
    "status" "LiveClassInteractionStatus" NOT NULL DEFAULT 'PUBLISHED',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "clientEventId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LiveClassInteraction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiveClassEngagement" (
    "id" TEXT NOT NULL,
    "liveClassId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "interactionId" TEXT NOT NULL,
    "type" "LiveClassEngagementType" NOT NULL,
    "clientEventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LiveClassEngagement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiveClassRecording" (
    "id" TEXT NOT NULL,
    "liveClassId" TEXT NOT NULL,
    "startedById" TEXT NOT NULL,
    "egressId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" "LiveClassRecordingStatus" NOT NULL DEFAULT 'STARTING',
    "consentNotice" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LiveClassRecording_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiveClassInteraction_liveClassId_clientEventId_key"
    ON "LiveClassInteraction"("liveClassId", "clientEventId");
CREATE INDEX "LiveClassInteraction_liveClassId_createdAt_idx"
    ON "LiveClassInteraction"("liveClassId", "createdAt");
CREATE INDEX "LiveClassInteraction_liveClassId_type_status_idx"
    ON "LiveClassInteraction"("liveClassId", "type", "status");
CREATE INDEX "LiveClassInteraction_senderId_createdAt_idx"
    ON "LiveClassInteraction"("senderId", "createdAt");
CREATE UNIQUE INDEX "LiveClassEngagement_clientEventId_key"
    ON "LiveClassEngagement"("clientEventId");
CREATE UNIQUE INDEX "LiveClassEngagement_interactionId_userId_key"
    ON "LiveClassEngagement"("interactionId", "userId");
CREATE INDEX "LiveClassEngagement_liveClassId_type_createdAt_idx"
    ON "LiveClassEngagement"("liveClassId", "type", "createdAt");
CREATE INDEX "LiveClassEngagement_userId_liveClassId_createdAt_idx"
    ON "LiveClassEngagement"("userId", "liveClassId", "createdAt");
CREATE UNIQUE INDEX "LiveClassRecording_egressId_key" ON "LiveClassRecording"("egressId");
CREATE INDEX "LiveClassRecording_liveClassId_createdAt_idx"
    ON "LiveClassRecording"("liveClassId", "createdAt");

ALTER TABLE "LiveClassPresence" ADD CONSTRAINT "LiveClassPresence_verifiedById_fkey"
    FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LiveClassInteraction" ADD CONSTRAINT "LiveClassInteraction_liveClassId_fkey"
    FOREIGN KEY ("liveClassId") REFERENCES "LiveClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveClassInteraction" ADD CONSTRAINT "LiveClassInteraction_senderId_fkey"
    FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveClassInteraction" ADD CONSTRAINT "LiveClassInteraction_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "LiveClassInteraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveClassEngagement" ADD CONSTRAINT "LiveClassEngagement_liveClassId_fkey"
    FOREIGN KEY ("liveClassId") REFERENCES "LiveClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveClassEngagement" ADD CONSTRAINT "LiveClassEngagement_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveClassEngagement" ADD CONSTRAINT "LiveClassEngagement_interactionId_fkey"
    FOREIGN KEY ("interactionId") REFERENCES "LiveClassInteraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveClassRecording" ADD CONSTRAINT "LiveClassRecording_liveClassId_fkey"
    FOREIGN KEY ("liveClassId") REFERENCES "LiveClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveClassRecording" ADD CONSTRAINT "LiveClassRecording_startedById_fkey"
    FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
