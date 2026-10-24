-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "KeyStorageType" AS ENUM ('DEV_KEYSTORE', 'CLOUD_KMS', 'REMOTE_SMART_CA');

-- CreateTable
CREATE TABLE "digital_certificates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "subjectDn" TEXT NOT NULL,
    "issuerDn" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "fingerprintSha256" TEXT NOT NULL,
    "certificatePem" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "status" "CertificateStatus" NOT NULL DEFAULT 'ACTIVE',
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "keyStorageType" "KeyStorageType" NOT NULL DEFAULT 'DEV_KEYSTORE',
    "keyAlias" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "digital_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "digital_certificates_organizationId_status_idx" ON "digital_certificates"("organizationId", "status");

-- CreateIndex
CREATE INDEX "digital_certificates_userId_idx" ON "digital_certificates"("userId");

-- CreateIndex
CREATE INDEX "digital_certificates_fingerprintSha256_idx" ON "digital_certificates"("fingerprintSha256");

-- CreateIndex
CREATE UNIQUE INDEX "digital_certificates_organizationId_fingerprintSha256_key" ON "digital_certificates"("organizationId", "fingerprintSha256");

-- CreateIndex
CREATE UNIQUE INDEX "digital_certificates_organizationId_keyAlias_key" ON "digital_certificates"("organizationId", "keyAlias");

-- AddForeignKey
ALTER TABLE "digital_certificates" ADD CONSTRAINT "digital_certificates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_certificates" ADD CONSTRAINT "digital_certificates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
