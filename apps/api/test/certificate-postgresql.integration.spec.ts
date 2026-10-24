import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, UserRole } from '@prisma/client';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CertificateStatus, KeyStorageType } from '@trinh-ky/shared';
import { CertificateRegistryService, UserContext } from '../src/modules/signing/certificate-registry.service.js';
import { DevLocalKeystoreProvider } from '../src/modules/signing/providers/dev-local-keystore.provider.js';
import { DevKeystoreGenerator } from '../src/modules/signing/dev-keystore-generator.js';

describe('Phase 13.2.1: Certificate Registry & Keystore (Real PostgreSQL Integration)', () => {
  let prisma: PrismaClient;
  let keystoreProvider: DevLocalKeystoreProvider;
  let service: CertificateRegistryService;

  let orgAlpha: any;
  let orgBeta: any;
  let adminAlpha: any;
  let userAlpha1: any;
  let userAlpha2: any;
  let userBeta: any;

  let principalAdminAlpha: UserContext;
  let principalUserAlpha1: UserContext;
  let principalUserAlpha2: UserContext;
  let principalUserBeta: UserContext;

  let devKeystore1: any;
  let devKeystore2: any;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    keystoreProvider = new DevLocalKeystoreProvider();
    service = new CertificateRegistryService(prisma as any, keystoreProvider);

    // 1. Tạo tổ chức Alpha và Beta
    orgAlpha = await prisma.organization.create({
      data: {
        code: `ORG_ALPHA_CERT_${Date.now()}`,
        name: 'Tập đoàn Alpha Certificate Test',
      },
    });

    orgBeta = await prisma.organization.create({
      data: {
        code: `ORG_BETA_CERT_${Date.now()}`,
        name: 'Công ty Beta Certificate Test',
      },
    });

    // 2. Tạo Users
    adminAlpha = await prisma.user.create({
      data: {
        email: `admin-alpha-cert-${Date.now()}@vinagroup.vn`,
        passwordHash: 'dummy_hash',
        fullName: 'Admin Công ty Alpha',
        role: UserRole.ADMIN,
        organizationId: orgAlpha.id,
      },
    });

    userAlpha1 = await prisma.user.create({
      data: {
        email: `user1-alpha-cert-${Date.now()}@vinagroup.vn`,
        passwordHash: 'dummy_hash',
        fullName: 'Nhân viên Alpha 1',
        role: UserRole.USER,
        organizationId: orgAlpha.id,
      },
    });

    userAlpha2 = await prisma.user.create({
      data: {
        email: `user2-alpha-cert-${Date.now()}@vinagroup.vn`,
        passwordHash: 'dummy_hash',
        fullName: 'Nhân viên Alpha 2',
        role: UserRole.USER,
        organizationId: orgAlpha.id,
      },
    });

    userBeta = await prisma.user.create({
      data: {
        email: `user-beta-cert-${Date.now()}@beta.vn`,
        passwordHash: 'dummy_hash',
        fullName: 'Nhân viên Beta',
        role: UserRole.USER,
        organizationId: orgBeta.id,
      },
    });

    principalAdminAlpha = {
      id: adminAlpha.id,
      role: adminAlpha.role as any,
      organizationId: orgAlpha.id,
      email: adminAlpha.email,
    };

    principalUserAlpha1 = {
      id: userAlpha1.id,
      role: userAlpha1.role as any,
      organizationId: orgAlpha.id,
      email: userAlpha1.email,
    };

    principalUserAlpha2 = {
      id: userAlpha2.id,
      role: userAlpha2.role as any,
      organizationId: orgAlpha.id,
      email: userAlpha2.email,
    };

    principalUserBeta = {
      id: userBeta.id,
      role: userBeta.role as any,
      organizationId: orgBeta.id,
      email: userBeta.email,
    };

    // 3. Chuẩn bị Keystores tự ký
    devKeystore1 = DevKeystoreGenerator.generateSelfSignedKeystore({
      commonName: 'Nhan vien Alpha 1',
      organizationName: 'Tap doan Alpha',
      passphrase: 'CertPassphrase2026!',
    });
    keystoreProvider.importKeystore('key_pg_alpha1', devKeystore1.p12Buffer, 'CertPassphrase2026!');

    devKeystore2 = DevKeystoreGenerator.generateSelfSignedKeystore({
      commonName: 'Con dau Tap doan Alpha',
      organizationName: 'Tap doan Alpha',
      passphrase: 'CertPassphrase2026!',
    });
    keystoreProvider.importKeystore('key_pg_alpha_seal', devKeystore2.p12Buffer, 'CertPassphrase2026!');
  });

  afterAll(async () => {
    try {
      // Dọn dẹp dữ liệu kiểm thử
      await prisma.auditLog.deleteMany({
        where: { userId: { in: [adminAlpha.id, userAlpha1.id, userAlpha2.id, userBeta.id] } },
      });
      await prisma.digitalCertificate.deleteMany({
        where: { organizationId: { in: [orgAlpha.id, orgBeta.id] } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [adminAlpha.id, userAlpha1.id, userAlpha2.id, userBeta.id] } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: [orgAlpha.id, orgBeta.id] } },
      });
    } catch {}
    await prisma.$disconnect();
  });

  it('1. Lưu trữ và truy xuất metadata chứng thư số X.509 chuẩn xác trong PostgreSQL', async () => {
    const cert = await service.registerCertificate(principalAdminAlpha, {
      userId: userAlpha1.id,
      certificatePem: devKeystore1.certificatePem,
      keyAlias: 'key_pg_alpha1',
      keyStorageType: KeyStorageType.DEV_KEYSTORE,
    });

    expect(cert.id).toBeDefined();
    expect(cert.organizationId).toBe(orgAlpha.id);
    expect(cert.userId).toBe(userAlpha1.id);
    expect(cert.status).toBe(CertificateStatus.ACTIVE);
    expect(cert.fingerprintSha256).toBe(devKeystore1.fingerprintSha256);
    expect(cert.serialNumber).toBe(devKeystore1.serialNumber);

    // Truy vấn trực tiếp từ CSDL PostgreSQL
    const dbCert = await prisma.digitalCertificate.findUnique({
      where: { id: cert.id },
      include: { organization: true, user: true },
    });

    expect(dbCert).not.toBeNull();
    expect(dbCert?.organizationId).toBe(orgAlpha.id);
    expect(dbCert?.user?.fullName).toBe('Nhân viên Alpha 1');
    expect(dbCert?.certificatePem).toContain('BEGIN CERTIFICATE');
  });

  it('2. Unique constraints: Chặn trùng lặp Fingerprint hoặc keyAlias trong cùng tổ chức trên PostgreSQL', async () => {
    // A. Trùng Fingerprint
    await expect(
      service.registerCertificate(principalAdminAlpha, {
        userId: userAlpha2.id,
        certificatePem: devKeystore1.certificatePem, // Cùng certPem -> trùng fingerprint
        keyAlias: 'different_alias_same_cert',
      })
    ).rejects.toThrow(ConflictException);

    // B. Trùng keyAlias
    const newCertDifferent = DevKeystoreGenerator.generateSelfSignedKeystore({
      commonName: 'Cert Different',
      passphrase: 'CertPassphrase2026!',
    });

    await expect(
      service.registerCertificate(principalAdminAlpha, {
        certificatePem: newCertDifferent.certificatePem,
        keyAlias: 'key_pg_alpha1', // Trùng keyAlias đã đăng ký ở Test 1
      })
    ).rejects.toThrow(ConflictException);
  });

  it('3. Tenant Isolation: Ngăn chặn tuyệt đối truy cập chéo giữa công ty Alpha và Beta', async () => {
    // Lấy certificate vừa tạo của Alpha
    const alphaCert = await prisma.digitalCertificate.findFirst({
      where: { organizationId: orgAlpha.id },
    });
    expect(alphaCert).not.toBeNull();

    // User thuộc công ty Beta cố đọc certificate của Alpha -> Bị chặn 403 Forbidden
    await expect(service.getCertificateById(principalUserBeta, alphaCert!.id)).rejects.toThrow(ForbiddenException);

    // User thuộc Beta cố gọi testSign trên cert của Alpha -> Bị chặn 403 Forbidden
    await expect(service.testSignCertificate(principalUserBeta, alphaCert!.id)).rejects.toThrow(ForbiddenException);

    // User thuộc Beta lấy danh sách certificates -> Không thấy cert nào của Alpha
    const betaList = await service.listCertificates(principalUserBeta);
    const hasAlphaCert = betaList.some((c) => c.organizationId === orgAlpha.id);
    expect(hasAlphaCert).toBe(false);
  });

  it('4. User Privacy: Nhân viên Alpha 2 không thể truy cập chứng thư số cá nhân của Nhân viên Alpha 1', async () => {
    const alpha1Cert = await prisma.digitalCertificate.findFirst({
      where: { userId: userAlpha1.id },
    });
    expect(alpha1Cert).not.toBeNull();

    // Alpha 2 cố đọc -> 403 Forbidden
    await expect(service.getCertificateById(principalUserAlpha2, alpha1Cert!.id)).rejects.toThrow(ForbiddenException);

    // Alpha 2 cố test sign -> 403 Forbidden
    await expect(service.testSignCertificate(principalUserAlpha2, alpha1Cert!.id)).rejects.toThrow(ForbiddenException);

    // Alpha 1 đọc của chính mình -> OK
    const myCert = await service.getCertificateById(principalUserAlpha1, alpha1Cert!.id);
    expect(myCert.id).toBe(alpha1Cert!.id);
  });

  it('5. Đăng ký con dấu doanh nghiệp (userId = null) và phân quyền sử dụng', async () => {
    const sealCert = await service.registerCertificate(principalAdminAlpha, {
      userId: null, // Con dấu chung
      certificatePem: devKeystore2.certificatePem,
      keyAlias: 'key_pg_alpha_seal',
    });

    expect(sealCert.userId).toBeNull();

    // USER thường cố test sign bằng con dấu chung -> Bị chặn 403
    await expect(service.testSignCertificate(principalUserAlpha1, sealCert.id)).rejects.toThrow(ForbiddenException);

    // ADMIN test sign bằng con dấu chung -> OK
    const testSignResult = await service.testSignCertificate(principalAdminAlpha, sealCert.id);
    expect(testSignResult.success).toBe(true);
    expect(testSignResult.dataSignatureValid).toBe(true);
    expect(testSignResult.digestSignatureValid).toBe(true);
  });

  it('6. Cập nhật trạng thái Thu hồi (REVOKED) và xác minh chặn ký số', async () => {
    const alpha1Cert = await prisma.digitalCertificate.findFirst({
      where: { userId: userAlpha1.id },
    });

    // ADMIN thu hồi chứng thư
    const revoked = await service.updateCertificateStatus(principalAdminAlpha, alpha1Cert!.id, {
      status: CertificateStatus.REVOKED,
      reason: 'Thu hồi do nghi ngờ rò rỉ khóa',
    });

    expect(revoked.status).toBe(CertificateStatus.REVOKED);
    expect(revoked.revokedReason).toBe('Thu hồi do nghi ngờ rò rỉ khóa');

    // Thử ký số bằng chứng thư đã bị thu hồi -> Bị từ chối BadRequestException
    await expect(service.testSignCertificate(principalUserAlpha1, alpha1Cert!.id)).rejects.toThrow();
  });
});
