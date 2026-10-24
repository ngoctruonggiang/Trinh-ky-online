-- AlterEnum
ALTER TYPE "ArtifactType" ADD VALUE 'SIGNED_PDF';

-- AlterTable
ALTER TABLE "document_artifacts" ADD COLUMN     "byteRange" INTEGER[],
ADD COLUMN     "certificateId" TEXT,
ADD COLUMN     "signerName" TEXT,
ADD COLUMN     "signerSubject" TEXT,
ADD COLUMN     "signingTime" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "document_artifacts_signedPdfHash_idx" ON "document_artifacts"("signedPdfHash");

-- CreateIndex
CREATE INDEX "document_artifacts_certificateId_idx" ON "document_artifacts"("certificateId");

-- AddForeignKey
ALTER TABLE "document_artifacts" ADD CONSTRAINT "document_artifacts_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "digital_certificates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
