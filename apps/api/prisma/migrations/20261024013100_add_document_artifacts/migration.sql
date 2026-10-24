-- CreateEnum
CREATE TYPE "ArtifactType" AS ENUM ('PREVIEW', 'OFFICIAL_UNSIGNED');

-- CreateEnum
CREATE TYPE "ArtifactStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "document_artifacts" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "artifactType" "ArtifactType" NOT NULL DEFAULT 'OFFICIAL_UNSIGNED',
    "status" "ArtifactStatus" NOT NULL DEFAULT 'PENDING',
    "storageKey" TEXT,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "sizeBytes" INTEGER,
    "rawPdfHash" TEXT,
    "formDataHash" TEXT NOT NULL,
    "signedPdfHash" TEXT,
    "requestedById" TEXT NOT NULL,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_artifacts_documentId_status_idx" ON "document_artifacts"("documentId", "status");

-- CreateIndex
CREATE INDEX "document_artifacts_organizationId_idx" ON "document_artifacts"("organizationId");

-- CreateIndex
CREATE INDEX "document_artifacts_rawPdfHash_idx" ON "document_artifacts"("rawPdfHash");

-- CreateIndex
CREATE UNIQUE INDEX "document_artifacts_documentVersionId_artifactType_key" ON "document_artifacts"("documentVersionId", "artifactType");

-- AddForeignKey
ALTER TABLE "document_artifacts" ADD CONSTRAINT "document_artifacts_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_artifacts" ADD CONSTRAINT "document_artifacts_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_artifacts" ADD CONSTRAINT "document_artifacts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_artifacts" ADD CONSTRAINT "document_artifacts_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
