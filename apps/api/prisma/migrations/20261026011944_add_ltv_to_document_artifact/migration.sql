-- AlterTable
ALTER TABLE "document_artifacts" ADD COLUMN     "dssCertsCount" INTEGER,
ADD COLUMN     "dssCrlsCount" INTEGER,
ADD COLUMN     "dssOcspsCount" INTEGER,
ADD COLUMN     "hasLtv" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ltvEmbeddedAt" TIMESTAMP(3),
ADD COLUMN     "ltvStatus" TEXT;

-- CreateIndex
CREATE INDEX "document_artifacts_hasLtv_idx" ON "document_artifacts"("hasLtv");
