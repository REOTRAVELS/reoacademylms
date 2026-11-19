ALTER TABLE "IntakeProgramOffering"
ADD COLUMN "schedule" TEXT,
ADD COLUMN "timetableFileName" TEXT,
ADD COLUMN "timetableMimeType" TEXT,
ADD COLUMN "timetableStoragePath" TEXT,
ADD COLUMN "timetableSizeBytes" INTEGER;
