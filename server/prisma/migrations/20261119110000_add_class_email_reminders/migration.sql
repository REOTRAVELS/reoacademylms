CREATE TYPE "LiveClassReminderChannel" AS ENUM ('EMAIL');
CREATE TYPE "LiveClassReminderDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'DELIVERED', 'FAILED');

CREATE TABLE "LiveClassReminderDelivery" (
    "id" TEXT NOT NULL,
    "liveClassId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "LiveClassReminderChannel" NOT NULL,
    "targetKey" TEXT NOT NULL,
    "status" "LiveClassReminderDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveClassReminderDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiveClassReminderDelivery_liveClassId_userId_channel_targetKey_key"
ON "LiveClassReminderDelivery"("liveClassId", "userId", "channel", "targetKey");
CREATE INDEX "LiveClassReminderDelivery_status_nextAttemptAt_idx"
ON "LiveClassReminderDelivery"("status", "nextAttemptAt");

ALTER TABLE "LiveClassReminderDelivery"
ADD CONSTRAINT "LiveClassReminderDelivery_liveClassId_fkey"
FOREIGN KEY ("liveClassId") REFERENCES "LiveClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveClassReminderDelivery"
ADD CONSTRAINT "LiveClassReminderDelivery_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
