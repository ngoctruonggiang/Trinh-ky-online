-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "approval_steps" ADD COLUMN "slaWarningSentAt" TIMESTAMP(3),
ADD COLUMN "slaOverdueSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "status" "NotificationStatus" NOT NULL DEFAULT 'SENT',
ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "errorMessage" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "notifications_idempotencyKey_key" ON "notifications"("idempotencyKey");

-- CreateIndex
CREATE INDEX "notifications_status_idx" ON "notifications"("status");
