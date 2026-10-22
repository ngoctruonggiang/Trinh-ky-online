-- AlterTable form_templates
ALTER TABLE "form_templates" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "form_templates" ADD COLUMN "currentVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable documents
ALTER TABLE "documents" ADD COLUMN "templateVersionId" TEXT;

-- CreateTable form_template_versions
CREATE TABLE "form_template_versions" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "fields" JSONB NOT NULL,
    "layoutBlocks" JSONB NOT NULL,
    "defaultWorkflowSteps" JSONB,
    "changeSummary" TEXT,
    "status" "TemplateStatus" NOT NULL DEFAULT 'PUBLISHED',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "form_template_versions_templateId_versionNumber_key" ON "form_template_versions"("templateId", "versionNumber");

-- AddForeignKey
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_template_versions" ADD CONSTRAINT "form_template_versions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "form_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_template_versions" ADD CONSTRAINT "form_template_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "form_template_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
