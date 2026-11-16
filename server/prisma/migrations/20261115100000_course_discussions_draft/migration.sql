CREATE TYPE "CourseDiscussionPostType" AS ENUM ('TOPIC', 'REPLY');
CREATE TYPE "CourseDiscussionReportStatus" AS ENUM ('OPEN', 'ACTIONED', 'DISMISSED');
CREATE TYPE "CourseDiscussionModerationAction" AS ENUM (
    'AUTHOR_DELETE',
    'PIN',
    'UNPIN',
    'LOCK',
    'UNLOCK',
    'RESOLVE',
    'REOPEN',
    'REMOVE',
    'RESTORE',
    'REPORT_ACTIONED',
    'REPORT_DISMISSED'
);

CREATE UNIQUE INDEX "Course_id_programmeId_key"
ON "Course"("id", "programmeId");

ALTER TABLE "Notification"
ADD COLUMN "sourceKey" TEXT;
CREATE UNIQUE INDEX "Notification_sourceKey_key"
ON "Notification"("sourceKey");

CREATE TABLE "CourseDiscussionPost" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "programOfferingId" TEXT NOT NULL,
    "lessonId" TEXT,
    "parentId" TEXT,
    "type" "CourseDiscussionPostType" NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "isAnnouncement" BOOLEAN NOT NULL DEFAULT false,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "authorId" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "moderationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CourseDiscussionPost_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CourseDiscussionPost_shape_check" CHECK (
        (
            "type" = 'TOPIC'
            AND "parentId" IS NULL
            AND "title" IS NOT NULL
            AND char_length(btrim("title")) BETWEEN 5 AND 160
        )
        OR (
            "type" = 'REPLY'
            AND "parentId" IS NOT NULL
            AND "title" IS NULL
            AND NOT "isAnnouncement"
            AND NOT "isPinned"
            AND NOT "isLocked"
            AND NOT "isResolved"
        )
    )
);

CREATE UNIQUE INDEX "CourseDiscussionPost_id_courseId_programmeId_programOfferingId_key"
ON "CourseDiscussionPost"("id", "courseId", "programmeId", "programOfferingId");
CREATE INDEX "CourseDiscussionPost_courseId_programOfferingId_parentId_createdAt_idx"
ON "CourseDiscussionPost"("courseId", "programOfferingId", "parentId", "createdAt");
CREATE INDEX "CourseDiscussionPost_programOfferingId_courseId_createdAt_idx"
ON "CourseDiscussionPost"("programOfferingId", "courseId", "createdAt");
CREATE INDEX "CourseDiscussionPost_authorId_createdAt_idx"
ON "CourseDiscussionPost"("authorId", "createdAt");
CREATE INDEX "CourseDiscussionPost_parentId_createdAt_idx"
ON "CourseDiscussionPost"("parentId", "createdAt");

CREATE TABLE "CourseDiscussionReport" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" "CourseDiscussionReportStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CourseDiscussionReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CourseDiscussionReport_postId_reporterId_key"
ON "CourseDiscussionReport"("postId", "reporterId");
CREATE INDEX "CourseDiscussionReport_status_createdAt_idx"
ON "CourseDiscussionReport"("status", "createdAt");
CREATE INDEX "CourseDiscussionReport_reporterId_createdAt_idx"
ON "CourseDiscussionReport"("reporterId", "createdAt");

CREATE TABLE "CourseDiscussionModeration" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "reportId" TEXT,
    "actorId" TEXT NOT NULL,
    "action" "CourseDiscussionModerationAction" NOT NULL,
    "reason" TEXT,
    "beforeState" JSONB,
    "afterState" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseDiscussionModeration_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CourseDiscussionModeration_postId_createdAt_idx"
ON "CourseDiscussionModeration"("postId", "createdAt");
CREATE INDEX "CourseDiscussionModeration_reportId_createdAt_idx"
ON "CourseDiscussionModeration"("reportId", "createdAt");
CREATE INDEX "CourseDiscussionModeration_actorId_createdAt_idx"
ON "CourseDiscussionModeration"("actorId", "createdAt");

ALTER TABLE "CourseDiscussionPost"
ADD CONSTRAINT "CourseDiscussionPost_courseId_programmeId_fkey"
FOREIGN KEY ("courseId", "programmeId") REFERENCES "Course"("id", "programmeId")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseDiscussionPost"
ADD CONSTRAINT "CourseDiscussionPost_programOfferingId_programmeId_fkey"
FOREIGN KEY ("programOfferingId", "programmeId") REFERENCES "IntakeProgramOffering"("id", "programmeId")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseDiscussionPost"
ADD CONSTRAINT "CourseDiscussionPost_lessonId_fkey"
FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CourseDiscussionPost"
ADD CONSTRAINT "CourseDiscussionPost_parent_scope_fkey"
FOREIGN KEY ("parentId", "courseId", "programmeId", "programOfferingId")
REFERENCES "CourseDiscussionPost"("id", "courseId", "programmeId", "programOfferingId")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseDiscussionPost"
ADD CONSTRAINT "CourseDiscussionPost_authorId_fkey"
FOREIGN KEY ("authorId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseDiscussionPost"
ADD CONSTRAINT "CourseDiscussionPost_deletedById_fkey"
FOREIGN KEY ("deletedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CourseDiscussionReport"
ADD CONSTRAINT "CourseDiscussionReport_postId_fkey"
FOREIGN KEY ("postId") REFERENCES "CourseDiscussionPost"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseDiscussionReport"
ADD CONSTRAINT "CourseDiscussionReport_reporterId_fkey"
FOREIGN KEY ("reporterId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseDiscussionReport"
ADD CONSTRAINT "CourseDiscussionReport_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CourseDiscussionModeration"
ADD CONSTRAINT "CourseDiscussionModeration_postId_fkey"
FOREIGN KEY ("postId") REFERENCES "CourseDiscussionPost"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseDiscussionModeration"
ADD CONSTRAINT "CourseDiscussionModeration_reportId_fkey"
FOREIGN KEY ("reportId") REFERENCES "CourseDiscussionReport"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CourseDiscussionModeration"
ADD CONSTRAINT "CourseDiscussionModeration_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
