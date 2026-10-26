import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ArtifactStatus, ArtifactType, CertificateStatus, UserRole } from '@trinh-ky/shared';
import { PdfSigningService } from './pdf-signing.service.js';
import { UserPrincipal } from '../../../common/interfaces/user-principal.interface.js';
import { TimestampService } from '../timestamp/timestamp.service.js';

describe('PdfSigningService (Unit Tests)', () => {
  let service: PdfSigningService;
  let mockPrisma: any;
  let mockStorageService: any;
  let mockArtifactService: any;
  let mockKeyProvider: any;
  let mockTimestampService: any;

  const mockUser: UserPrincipal = {
    id: 'user-uuid-1',
    email: 'user1@vinagroup.vn',
    fullName: 'Nguyễn Văn Ký',
    role: UserRole.USER,
    organizationId: 'org-uuid-1',
    departmentId: null,
  };

  const mockAdmin: UserPrincipal = {
    id: 'admin-uuid-1',
    email: 'admin@vinagroup.vn',
    fullName: 'Quản Trị Viên',
    role: UserRole.ADMIN,
    organizationId: 'org-uuid-1',
    departmentId: null,
  };

  const mockDocument = {
    id: 'doc-uuid-1',
    documentNumber: 'TK-2026-0001',
    title: 'Hồ sơ đề xuất thanh toán',
    organizationId: 'org-uuid-1',
    currentVersion: 1,
    status: 'IN_REVIEW',
  };

  const mockDocVersion = {
    id: 'ver-uuid-1',
    documentId: 'doc-uuid-1',
    versionNumber: 1,
    sha256Hash: 'form_data_hash_abc123',
  };

  const mockCert = {
    id: 'cert-uuid-1',
    organizationId: 'org-uuid-1',
    userId: 'user-uuid-1',
    keyAlias: 'key_alias_user_1',
    status: CertificateStatus.ACTIVE,
    validFrom: new Date('2026-01-01'),
    validTo: new Date('2027-01-01'),
    subjectDn: 'CN=Nguyễn Văn Ký, O=Tập đoàn VinaGroup, C=VN',
    issuerDn: 'CN=VinaGroup Root CA',
    serialNumber: '123456',
    certificatePem: '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----',
  };

  beforeEach(() => {
    mockPrisma = {
      document: {
        findUnique: vi.fn().mockResolvedValue(mockDocument),
      },
      documentVersion: {
        findUnique: vi.fn().mockResolvedValue(mockDocVersion),
      },
      digitalCertificate: {
        findUnique: vi.fn().mockResolvedValue(mockCert),
        findFirst: vi.fn().mockResolvedValue(mockCert),
      },
      documentArtifact: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-uuid' }),
      },
      $transaction: vi.fn().mockImplementation(async (callback) => {
        return callback({
          $executeRawUnsafe: vi.fn().mockResolvedValue(1),
          documentArtifact: {
            findUnique: vi.fn(),
            upsert: vi.fn().mockResolvedValue({
              id: 'art-signed-uuid',
              status: ArtifactStatus.COMPLETED,
            }),
          },
          auditLog: {
            create: vi.fn().mockResolvedValue({ id: 'audit-uuid' }),
          },
        });
      }),
    };

    mockStorageService = {
      get: vi.fn(),
      put: vi.fn().mockResolvedValue({ storageKey: 'test-key', sizeBytes: 100 }),
      generateArtifactKey: vi.fn().mockReturnValue('tenants/org/docs/signed.pdf'),
    };

    mockArtifactService = {
      renderArtifact: vi.fn(),
      getArtifactStream: vi.fn(),
    };

    mockKeyProvider = {
      isAvailable: vi.fn().mockResolvedValue(true),
      signDigest: vi.fn(),
      getCertificate: vi.fn(),
    };

    mockTimestampService = {
      getProvider: vi.fn().mockReturnValue({
        getTimestampToken: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(true),
      }),
      isTsaAvailable: vi.fn().mockResolvedValue(true),
    };

    service = new PdfSigningService(
      mockPrisma,
      mockStorageService,
      mockArtifactService,
      mockKeyProvider,
      mockTimestampService as unknown as TimestampService
    );
  });

  it('1. Chặn người dùng khác tổ chức (Tenant Isolation) gọi ký hồ sơ', async () => {
    const crossTenantUser: UserPrincipal = {
      ...mockUser,
      organizationId: 'org-other-tenant',
    };

    await expect(
      service.signDocument('doc-uuid-1', {}, crossTenantUser)
    ).rejects.toThrow(ForbiddenException);
  });

  it('2. Chặn ký bằng chứng thư cá nhân của người khác', async () => {
    const anotherUserCert = {
      ...mockCert,
      userId: 'someone-else-id',
    };
    mockPrisma.digitalCertificate.findUnique.mockResolvedValue(anotherUserCert);

    await expect(
      service.signDocument('doc-uuid-1', { certificateId: anotherUserCert.id }, mockUser)
    ).rejects.toThrow(ForbiddenException);
  });

  it('3. Chặn ký khi chứng thư đã bị thu hồi (REVOKED)', async () => {
    const revokedCert = {
      ...mockCert,
      status: CertificateStatus.REVOKED,
    };
    mockPrisma.digitalCertificate.findUnique.mockResolvedValue(revokedCert);

    await expect(
      service.signDocument('doc-uuid-1', { certificateId: revokedCert.id }, mockUser)
    ).rejects.toThrow(BadRequestException);
  });

  it('4. Chặn ký khi chứng thư đã hết hạn hiệu lực', async () => {
    const expiredCert = {
      ...mockCert,
      validFrom: new Date('2020-01-01'),
      validTo: new Date('2021-01-01'),
    };
    mockPrisma.digitalCertificate.findUnique.mockResolvedValue(expiredCert);

    await expect(
      service.signDocument('doc-uuid-1', { certificateId: expiredCert.id }, mockUser)
    ).rejects.toThrow(BadRequestException);
  });

  it('5. Báo lỗi 404 khi không tìm thấy hồ sơ', async () => {
    mockPrisma.document.findUnique.mockResolvedValue(null);

    await expect(
      service.signDocument('non-existent-doc', {}, mockUser)
    ).rejects.toThrow(NotFoundException);
  });

  it('6. verifyDocumentSignature ném lỗi 404 khi chưa có artifact SIGNED_PDF', async () => {
    mockPrisma.documentArtifact.findUnique.mockResolvedValue(null);

    await expect(
      service.verifyDocumentSignature('doc-uuid-1', {}, mockUser)
    ).rejects.toThrow(NotFoundException);
  });
});
