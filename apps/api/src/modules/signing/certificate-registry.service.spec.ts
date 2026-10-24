import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CertificateRegistryService, UserContext } from './certificate-registry.service';
import { DevLocalKeystoreProvider } from './providers/dev-local-keystore.provider';
import { DevKeystoreGenerator } from './dev-keystore-generator';
import {
  AuditAction,
  CertificateStatus,
  KeyStorageType,
  UserRole,
} from '@trinh-ky/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

describe('CertificateRegistryService (Unit Tests)', () => {
  let service: CertificateRegistryService;
  let mockPrisma: any;
  let keystoreProvider: DevLocalKeystoreProvider;

  const adminAlpha: UserContext = {
    id: 'user_admin_alpha',
    role: UserRole.ADMIN,
    organizationId: 'org_alpha',
  };

  const userAlpha1: UserContext = {
    id: 'user_alpha_1',
    role: UserRole.USER,
    organizationId: 'org_alpha',
  };

  const userAlpha2: UserContext = {
    id: 'user_alpha_2',
    role: UserRole.USER,
    organizationId: 'org_alpha',
  };

  const userBeta: UserContext = {
    id: 'user_beta_1',
    role: UserRole.USER,
    organizationId: 'org_beta',
  };

  let generatedCert: any;

  beforeEach(() => {
    keystoreProvider = new DevLocalKeystoreProvider();
    generatedCert = DevKeystoreGenerator.generateSelfSignedKeystore({
      commonName: 'Nguyen Van A',
      organizationName: 'VinaGroup',
      passphrase: 'TestPassphrase2026!',
    });
    keystoreProvider.importKeystore('alias_unit_test', generatedCert.p12Buffer, 'TestPassphrase2026!');

    mockPrisma = {
      user: {
        findFirst: vi.fn(),
      },
      digitalCertificate: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
    };

    service = new CertificateRegistryService(mockPrisma as any, keystoreProvider);
  });

  it('1. ADMIN đăng ký chứng thư số hợp lệ thành công', async () => {
    mockPrisma.digitalCertificate.findFirst.mockResolvedValue(null);
    mockPrisma.digitalCertificate.create.mockImplementation((args: any) => ({
      id: 'cert_123',
      ...args.data,
    }));
    mockPrisma.auditLog.create.mockResolvedValue({ id: 'audit_123' });

    const result = await service.registerCertificate(adminAlpha, {
      certificatePem: generatedCert.certificatePem,
      keyAlias: 'alias_unit_test',
      keyStorageType: KeyStorageType.DEV_KEYSTORE,
    });

    expect(result.id).toBe('cert_123');
    expect(result.organizationId).toBe('org_alpha');
    expect(result.keyAlias).toBe('alias_unit_test');
    expect(result.status).toBe(CertificateStatus.ACTIVE);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: AuditAction.CERTIFICATE_REGISTER,
        }),
      })
    );
  });

  it('2. Chặn USER thông thường đăng ký chứng thư số (ForbiddenException)', async () => {
    await expect(
      service.registerCertificate(userAlpha1, {
        certificatePem: generatedCert.certificatePem,
        keyAlias: 'alias_forbidden',
      })
    ).rejects.toThrow(ForbiddenException);
  });

  it('3. Chặn đăng ký chứng thư với nội dung PEM không hợp lệ (BadRequestException)', async () => {
    await expect(
      service.registerCertificate(adminAlpha, {
        certificatePem: '-----BEGIN CERTIFICATE-----\nINVALID_CORRUPTED_BASE64\n-----END CERTIFICATE-----',
        keyAlias: 'alias_corrupt',
      })
    ).rejects.toThrow(BadRequestException);
  });

  it('4. Chặn đăng ký chứng thư số trùng lặp mã băm fingerprint trong cùng tổ chức (ConflictException)', async () => {
    mockPrisma.digitalCertificate.findFirst.mockResolvedValueOnce({
      id: 'existing_cert',
      fingerprintSha256: generatedCert.fingerprintSha256,
    });

    await expect(
      service.registerCertificate(adminAlpha, {
        certificatePem: generatedCert.certificatePem,
        keyAlias: 'alias_unique_name',
      })
    ).rejects.toThrow(ConflictException);
  });

  it('5. Chặn đăng ký chứng thư số trùng lặp keyAlias trong cùng tổ chức (ConflictException)', async () => {
    mockPrisma.digitalCertificate.findFirst
      .mockResolvedValueOnce(null) // Check fingerprint: ok
      .mockResolvedValueOnce({ id: 'existing_alias', keyAlias: 'alias_duplicate' }); // Check alias: duplicate

    await expect(
      service.registerCertificate(adminAlpha, {
        certificatePem: generatedCert.certificatePem,
        keyAlias: 'alias_duplicate',
      })
    ).rejects.toThrow(ConflictException);
  });

  it('6. Chặn gán chứng thư số cho người dùng thuộc tổ chức khác (BadRequestException)', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null); // Không tìm thấy user trong org_alpha

    await expect(
      service.registerCertificate(adminAlpha, {
        userId: 'user_from_other_org',
        certificatePem: generatedCert.certificatePem,
        keyAlias: 'alias_cross_user',
      })
    ).rejects.toThrow(BadRequestException);
  });

  it('7. Tenant Isolation: Người dùng tổ chức Beta bị chặn khi xem chứng thư của Alpha (ForbiddenException)', async () => {
    mockPrisma.digitalCertificate.findUnique.mockResolvedValue({
      id: 'cert_alpha_org',
      organizationId: 'org_alpha',
      userId: null,
    });

    await expect(service.getCertificateById(userBeta, 'cert_alpha_org')).rejects.toThrow(ForbiddenException);
  });

  it('8. User Privacy: USER không thể xem chứng thư cá nhân của người khác trong cùng tổ chức', async () => {
    mockPrisma.digitalCertificate.findUnique.mockResolvedValue({
      id: 'cert_personal_alpha1',
      organizationId: 'org_alpha',
      userId: userAlpha1.id,
    });

    // userAlpha2 cố xem cert cá nhân của userAlpha1 -> Bị chặn 403
    await expect(service.getCertificateById(userAlpha2, 'cert_personal_alpha1')).rejects.toThrow(ForbiddenException);

    // userAlpha1 xem cert của chính mình -> OK
    const myCert = await service.getCertificateById(userAlpha1, 'cert_personal_alpha1');
    expect(myCert.id).toBe('cert_personal_alpha1');

    // ADMIN xem cert của nhân viên trong công ty -> OK
    const adminView = await service.getCertificateById(adminAlpha, 'cert_personal_alpha1');
    expect(adminView.id).toBe('cert_personal_alpha1');
  });

  it('9. Cập nhật trạng thái chứng thư số sang REVOKED bởi ADMIN thành công', async () => {
    mockPrisma.digitalCertificate.findUnique.mockResolvedValue({
      id: 'cert_to_revoke',
      organizationId: 'org_alpha',
      status: CertificateStatus.ACTIVE,
    });
    mockPrisma.digitalCertificate.update.mockResolvedValue({
      id: 'cert_to_revoke',
      organizationId: 'org_alpha',
      status: CertificateStatus.REVOKED,
      revokedReason: 'Chứng thư bị lộ mật khẩu',
    });

    const updated = await service.updateCertificateStatus(adminAlpha, 'cert_to_revoke', {
      status: CertificateStatus.REVOKED,
      reason: 'Chứng thư bị lộ mật khẩu',
    });

    expect(updated.status).toBe(CertificateStatus.REVOKED);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: AuditAction.CERTIFICATE_UPDATE_STATUS,
        }),
      })
    );
  });

  it('10. assertCanSignWithCertificate: Bảo vệ thẩm quyền ký nghiêm ngặt', async () => {
    // A. Cert không tồn tại
    mockPrisma.digitalCertificate.findUnique.mockResolvedValueOnce(null);
    await expect(service.assertCanSignWithCertificate(userAlpha1, 'non_exist')).rejects.toThrow(NotFoundException);

    // B. Cert thuộc tổ chức khác
    mockPrisma.digitalCertificate.findUnique.mockResolvedValueOnce({
      id: 'cert_beta',
      organizationId: 'org_beta',
      status: CertificateStatus.ACTIVE,
      validFrom: new Date(Date.now() - 10000),
      validTo: new Date(Date.now() + 10000),
      userId: userAlpha1.id,
    });
    await expect(service.assertCanSignWithCertificate(userAlpha1, 'cert_beta')).rejects.toThrow(ForbiddenException);

    // C. Cert đã bị thu hồi (REVOKED)
    mockPrisma.digitalCertificate.findUnique.mockResolvedValueOnce({
      id: 'cert_revoked',
      organizationId: 'org_alpha',
      status: CertificateStatus.REVOKED,
      validFrom: new Date(Date.now() - 10000),
      validTo: new Date(Date.now() + 10000),
      userId: userAlpha1.id,
    });
    await expect(service.assertCanSignWithCertificate(userAlpha1, 'cert_revoked')).rejects.toThrow(BadRequestException);

    // D. Ký bằng cert cá nhân của người khác
    mockPrisma.digitalCertificate.findUnique.mockResolvedValueOnce({
      id: 'cert_user2',
      organizationId: 'org_alpha',
      status: CertificateStatus.ACTIVE,
      validFrom: new Date(Date.now() - 10000),
      validTo: new Date(Date.now() + 10000),
      userId: userAlpha2.id,
    });
    await expect(service.assertCanSignWithCertificate(userAlpha1, 'cert_user2')).rejects.toThrow(ForbiddenException);

    // E. USER thường cố đóng dấu bằng con dấu doanh nghiệp (userId = null)
    mockPrisma.digitalCertificate.findUnique.mockResolvedValueOnce({
      id: 'cert_org_seal',
      organizationId: 'org_alpha',
      status: CertificateStatus.ACTIVE,
      validFrom: new Date(Date.now() - 10000),
      validTo: new Date(Date.now() + 10000),
      userId: null,
    });
    await expect(service.assertCanSignWithCertificate(userAlpha1, 'cert_org_seal')).rejects.toThrow(ForbiddenException);

    // F. ADMIN đóng dấu bằng con dấu doanh nghiệp -> Hợp lệ
    mockPrisma.digitalCertificate.findUnique.mockResolvedValueOnce({
      id: 'cert_org_seal',
      organizationId: 'org_alpha',
      status: CertificateStatus.ACTIVE,
      validFrom: new Date(Date.now() - 10000),
      validTo: new Date(Date.now() + 10000),
      userId: null,
    });
    const sealCert = await service.assertCanSignWithCertificate(adminAlpha, 'cert_org_seal');
    expect(sealCert.id).toBe('cert_org_seal');
  });

  it('11. testSignCertificate: Ký thử nghiệm và xác minh thành công', async () => {
    mockPrisma.digitalCertificate.findUnique.mockResolvedValue({
      id: 'cert_test_sign',
      organizationId: 'org_alpha',
      status: CertificateStatus.ACTIVE,
      validFrom: new Date(Date.now() - 10000),
      validTo: new Date(Date.now() + 10000),
      userId: userAlpha1.id,
      keyAlias: 'alias_unit_test',
      certificatePem: generatedCert.certificatePem,
    });

    const testSignResult = await service.testSignCertificate(userAlpha1, 'cert_test_sign');

    expect(testSignResult.success).toBe(true);
    expect(testSignResult.isProviderAvailable).toBe(true);
    expect(testSignResult.dataSignatureValid).toBe(true);
    expect(testSignResult.digestSignatureValid).toBe(true);
    expect(testSignResult.signatureLengthBytes).toBe(256);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: AuditAction.CERTIFICATE_TEST_SIGN,
        }),
      })
    );
  });
});
