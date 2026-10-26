-- AlterTable
ALTER TABLE "document_artifacts" ADD COLUMN     "hasTimestamp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "timestampGenTime" TIMESTAMP(3),
ADD COLUMN     "tsaPolicyOid" TEXT,
ADD COLUMN     "tsaSerialNumber" TEXT,
ADD COLUMN     "tsaSubject" TEXT;
