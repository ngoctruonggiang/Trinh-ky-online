-- AlterTable form_templates
ALTER TABLE "form_templates" ADD COLUMN "workflowTemplateId" TEXT;

-- AlterTable form_template_versions
ALTER TABLE "form_template_versions" ADD COLUMN "workflowTemplateVersionId" TEXT;

-- AlterTable documents
ALTER TABLE "documents" ADD COLUMN "workflowTemplateVersionId" TEXT;

-- CreateTable workflow_templates
CREATE TABLE "workflow_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'Chung',
    "status" "TemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "steps" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable workflow_template_versions
CREATE TABLE "workflow_template_versions" (
    "id" TEXT NOT NULL,
    "workflowTemplateId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "steps" JSONB NOT NULL,
    "changeSummary" TEXT,
    "status" "TemplateStatus" NOT NULL DEFAULT 'PUBLISHED',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workflow_templates_code_key" ON "workflow_templates"("code");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_template_versions_workflowTemplateId_versionNumber_key" ON "workflow_template_versions"("workflowTemplateId", "versionNumber");

-- AddForeignKey
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_template_versions" ADD CONSTRAINT "workflow_template_versions_workflowTemplateId_fkey" FOREIGN KEY ("workflowTemplateId") REFERENCES "workflow_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_template_versions" ADD CONSTRAINT "workflow_template_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_workflowTemplateId_fkey" FOREIGN KEY ("workflowTemplateId") REFERENCES "workflow_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_template_versions" ADD CONSTRAINT "form_template_versions_workflowTemplateVersionId_fkey" FOREIGN KEY ("workflowTemplateVersionId") REFERENCES "workflow_template_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_workflowTemplateVersionId_fkey" FOREIGN KEY ("workflowTemplateVersionId") REFERENCES "workflow_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
