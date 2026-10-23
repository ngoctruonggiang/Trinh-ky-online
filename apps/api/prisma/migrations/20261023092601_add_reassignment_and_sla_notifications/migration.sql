-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ASSIGNED_STEP', 'REASSIGNED_STEP', 'REVISION_REQUESTED', 'DOCUMENT_APPROVED', 'DOCUMENT_REJECTED', 'SLA_WARNING', 'SLA_OVERDUE');

-- AlterTable
ALTER TABLE "approval_steps" ADD COLUMN     "dueDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "step_reassignment_histories" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "oldUserId" TEXT NOT NULL,
    "newUserId" TEXT NOT NULL,
    "reassignedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "step_reassignment_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "step_reassignment_histories_stepId_idx" ON "step_reassignment_histories"("stepId");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_idx" ON "notifications"("userId", "isRead");

-- CreateIndex
CREATE INDEX "notifications_documentId_idx" ON "notifications"("documentId");

-- AddForeignKey
ALTER TABLE "step_reassignment_histories" ADD CONSTRAINT "step_reassignment_histories_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "approval_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_reassignment_histories" ADD CONSTRAINT "step_reassignment_histories_oldUserId_fkey" FOREIGN KEY ("oldUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_reassignment_histories" ADD CONSTRAINT "step_reassignment_histories_newUserId_fkey" FOREIGN KEY ("newUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_reassignment_histories" ADD CONSTRAINT "step_reassignment_histories_reassignedById_fkey" FOREIGN KEY ("reassignedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
