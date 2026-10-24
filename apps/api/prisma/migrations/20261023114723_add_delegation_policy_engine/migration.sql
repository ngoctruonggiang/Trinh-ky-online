-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'DELEGATION_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'DELEGATION_REVOKED';

-- AlterTable
ALTER TABLE "step_decision_histories" ADD COLUMN     "delegatedFromUserId" TEXT,
ADD COLUMN     "delegationPolicyId" TEXT,
ADD COLUMN     "isDelegated" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "delegation_policies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "delegatorId" TEXT NOT NULL,
    "delegateeId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "scopeDepartmentId" TEXT,
    "scopeTemplateId" TEXT,
    "reason" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delegation_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delegation_policies_organizationId_idx" ON "delegation_policies"("organizationId");

-- CreateIndex
CREATE INDEX "delegation_policies_delegatorId_isActive_idx" ON "delegation_policies"("delegatorId", "isActive");

-- CreateIndex
CREATE INDEX "delegation_policies_delegateeId_isActive_idx" ON "delegation_policies"("delegateeId", "isActive");

-- CreateIndex
CREATE INDEX "delegation_policies_startDate_endDate_idx" ON "delegation_policies"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "step_decision_histories_delegatedFromUserId_idx" ON "step_decision_histories"("delegatedFromUserId");

-- AddForeignKey
ALTER TABLE "step_decision_histories" ADD CONSTRAINT "step_decision_histories_delegatedFromUserId_fkey" FOREIGN KEY ("delegatedFromUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_decision_histories" ADD CONSTRAINT "step_decision_histories_delegationPolicyId_fkey" FOREIGN KEY ("delegationPolicyId") REFERENCES "delegation_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegation_policies" ADD CONSTRAINT "delegation_policies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegation_policies" ADD CONSTRAINT "delegation_policies_delegatorId_fkey" FOREIGN KEY ("delegatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegation_policies" ADD CONSTRAINT "delegation_policies_delegateeId_fkey" FOREIGN KEY ("delegateeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegation_policies" ADD CONSTRAINT "delegation_policies_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegation_policies" ADD CONSTRAINT "delegation_policies_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegation_policies" ADD CONSTRAINT "delegation_policies_scopeDepartmentId_fkey" FOREIGN KEY ("scopeDepartmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegation_policies" ADD CONSTRAINT "delegation_policies_scopeTemplateId_fkey" FOREIGN KEY ("scopeTemplateId") REFERENCES "form_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
