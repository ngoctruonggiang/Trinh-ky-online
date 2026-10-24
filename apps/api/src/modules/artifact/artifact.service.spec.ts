import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as crypto from 'crypto';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { ArtifactStatus, ArtifactType, UserRole } from '@trinh-ky/shared';
import { ArtifactService } from './artifact.service.js';

describe('ArtifactService (Unit Tests)', () => {
  let service: ArtifactService;
  let mockPrisma: any;
  let mockStorageService: any;
  let mockPdfGenerator: any;

  const mockUser = {
    id: 'user-alpha-id',
    email: 'user-alpha@vinagroup.vn',
    fullName: 'Nguyễn Văn Alpha',
    role: UserRole.USER,
    organizationId: 'org-alpha-id',
    departmentId: 'dept-it-id',
  };

  const mockUserOtherOrg = {
    id: 'user-beta-id',
    email: 'user-beta@vinagroup.vn',
    fullName: 'Trần Thị Beta',
    role: UserRole.USER,
    organizationId: 'org-beta-id',
    departmentId: 'dept-sales-id',
  };

  const mockDocument = {
    id: 'doc-123',
    documentNumber: 'TK-2026-0001',
    title: 'Đề xuất trang bị máy tính',
    organizationId: 'org-alpha-id',
    status: 'APPROVED',
    currentVersion: 1,
    templateVersionId: 'tpl-ver-1',
    templateVersion: {
      id: 'tpl-ver-1',
      title: 'Mẫu biểu v1',
      versionNumber: 1,
      fields: [{ key: 'device', label: 'Thiết bị', type: 'text', required: true }],
    },
    workflow: {
      steps: [],
    },
  };

  const mockDocVersion = {
    id: 'doc-ver-123',
    documentId: 'doc-123',
    versionNumber: 1,
    formData: { device: 'MacBook Pro' },
    sha256Hash: 'formDataHash1234567890abcdef',
  };

  beforeEach(() => {
    mockPrisma = {
      document: {
        findUnique: vi.fn(),
      },
      documentVersion: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      documentArtifact: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi.fn(async (cb) => {
        return cb({
          $executeRawUnsafe: vi.fn().mockResolvedValue(1),
          documentArtifact: mockPrisma.documentArtifact,
          documentVersion: mockPrisma.documentVersion,
          auditLog: mockPrisma.auditLog,
        });
      }),
    };

    mockStorageService = {
      generateArtifactKey: vi.fn(
        (org, doc, ver, type, hash) => `tenants/${org}/documents/${doc}/v${ver}/${type}_${hash.slice(0, 8)}.pdf`
      ),
      put: vi.fn().mockResolvedValue({ sizeBytes: 5000, storageKey: 'test-key.pdf' }),
      get: vi.fn(),
      exists: vi.fn().mockResolvedValue(true),
    };

    mockPdfGenerator = {
      generatePdf: vi.fn().mockResolvedValue({
        pdfBuffer: Buffer.from('%PDF-1.7 generated content'),
        rawPdfHash: 'rawPdfHash9876543210fedcba',
        sizeBytes: 5000,
        pageCount: 1,
      }),
    };

    service = new ArtifactService(mockPrisma, mockStorageService, mockPdfGenerator);
  });

  it('1. Render artifact thành công và cập nhật COMPLETED + AuditLog', async () => {
    mockPrisma.document.findUnique.mockResolvedValue(mockDocument);
    mockPrisma.documentVersion.findUnique.mockResolvedValue(mockDocVersion);
    mockPrisma.documentArtifact.findUnique.mockResolvedValue(null);
    mockPrisma.documentArtifact.upsert.mockResolvedValue({ id: 'artifact-1' });
    mockPrisma.documentArtifact.update.mockResolvedValue({
      id: 'artifact-1',
      documentId: 'doc-123',
      documentVersionId: 'doc-ver-123',
      organizationId: 'org-alpha-id',
      artifactType: ArtifactType.OFFICIAL_UNSIGNED,
      status: ArtifactStatus.COMPLETED,
      storageKey: 'tenants/org-alpha-id/documents/doc-123/v1/official_unsigned_rawPdfHa.pdf',
      sizeBytes: 5000,
      rawPdfHash: 'rawPdfHash9876543210fedcba',
      formDataHash: 'formDataHash1234567890abcdef',
      requestedById: mockUser.id,
      startedAt: new Date(),
      completedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.renderArtifact(
      'doc-123',
      { versionNumber: 1, artifactType: ArtifactType.OFFICIAL_UNSIGNED },
      mockUser
    );

    expect(result.status).toBe(ArtifactStatus.COMPLETED);
    expect(result.rawPdfHash).toBe('rawPdfHash9876543210fedcba');
    expect(mockStorageService.put).toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).toHaveBeenCalled();
  });

  it('2. Idempotency: Không render lại nếu artifact COMPLETED đã tồn tại và file có trên storage', async () => {
    mockPrisma.document.findUnique.mockResolvedValue(mockDocument);
    mockPrisma.documentVersion.findUnique.mockResolvedValue(mockDocVersion);

    // Artifact đã COMPLETED từ trước
    const existingCompleted = {
      id: 'artifact-existing',
      documentId: 'doc-123',
      documentVersionId: 'doc-ver-123',
      organizationId: 'org-alpha-id',
      artifactType: ArtifactType.OFFICIAL_UNSIGNED,
      status: ArtifactStatus.COMPLETED,
      storageKey: 'existing-key.pdf',
      rawPdfHash: 'hash-existing',
      formDataHash: 'form-hash',
      requestedById: mockUser.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockPrisma.documentArtifact.findUnique.mockResolvedValue(existingCompleted);
    mockStorageService.exists.mockResolvedValue(true);

    const result = await service.renderArtifact(
      'doc-123',
      { versionNumber: 1, artifactType: ArtifactType.OFFICIAL_UNSIGNED },
      mockUser
    );

    expect(result.id).toBe('artifact-existing');
    // Không được gọi generator hay lưu file mới
    expect(mockPdfGenerator.generatePdf).not.toHaveBeenCalled();
    expect(mockStorageService.put).not.toHaveBeenCalled();
  });

  it('3. Chặn truy cập Cross-Tenant (User Org Beta không được render hoặc xem tài liệu Org Alpha)', async () => {
    mockPrisma.document.findUnique.mockResolvedValue(mockDocument); // Thuộc org-alpha-id

    await expect(
      service.renderArtifact(
        'doc-123',
        { versionNumber: 1, artifactType: ArtifactType.OFFICIAL_UNSIGNED },
        mockUserOtherOrg // Thuộc org-beta-id
      )
    ).rejects.toThrow(ForbiddenException);
  });

  it('4. Báo lỗi NotFoundException khi phiên bản tài liệu không tồn tại', async () => {
    mockPrisma.document.findUnique.mockResolvedValue(mockDocument);
    mockPrisma.documentVersion.findUnique.mockResolvedValue(null); // Không có version 99

    await expect(
      service.renderArtifact(
        'doc-123',
        { versionNumber: 99, artifactType: ArtifactType.OFFICIAL_UNSIGNED },
        mockUser
      )
    ).rejects.toThrow(NotFoundException);
  });

  it('5. Xử lý lỗi an toàn: Chuyển trạng thái sang FAILED khi bộ tạo PDF gặp lỗi', async () => {
    mockPrisma.document.findUnique.mockResolvedValue(mockDocument);
    mockPrisma.documentVersion.findUnique.mockResolvedValue(mockDocVersion);
    mockPrisma.documentArtifact.findUnique.mockResolvedValue(null);
    mockPrisma.documentArtifact.upsert.mockResolvedValue({ id: 'artifact-fail' });

    mockPdfGenerator.generatePdf.mockRejectedValue(new Error('Renderer crash simulation'));

    await expect(
      service.renderArtifact('doc-123', { versionNumber: 1 }, mockUser)
    ).rejects.toThrow(/Renderer crash simulation/i);

    // Xác nhận DB cập nhật trạng thái FAILED
    expect(mockPrisma.documentArtifact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'artifact-fail' },
        data: expect.objectContaining({
          status: ArtifactStatus.FAILED,
        }),
      })
    );
  });

  it('6. getArtifactStream: Kiểm tra toàn vẹn băm nhị phân khi tải file', async () => {
    mockPrisma.document.findUnique.mockResolvedValue(mockDocument);
    mockPrisma.documentVersion.findUnique.mockResolvedValue(mockDocVersion);

    const validContent = Buffer.from('%PDF-1.7 Valid Content');
    const validHash = crypto.createHash('sha256').update(validContent).digest('hex');

    mockPrisma.documentArtifact.findUnique.mockResolvedValue({
      id: 'art-stream',
      documentId: 'doc-123',
      documentVersionId: 'doc-ver-123',
      organizationId: 'org-alpha-id',
      artifactType: ArtifactType.OFFICIAL_UNSIGNED,
      status: ArtifactStatus.COMPLETED,
      storageKey: 'valid-file.pdf',
      rawPdfHash: validHash,
      formDataHash: 'form-hash',
      requestedById: mockUser.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockStorageService.get.mockResolvedValue(validContent);

    const streamResult = await service.getArtifactStream('doc-123', 1, ArtifactType.OFFICIAL_UNSIGNED, mockUser);
    expect(streamResult.buffer).toEqual(validContent);
    expect(streamResult.fileName).toContain('TK-2026-0001');

    // Trường hợp tệp bị can thiệp trên ổ đĩa (hash mismatch)
    const tamperedContent = Buffer.from('%PDF-1.7 Tampered Content');
    mockStorageService.get.mockResolvedValue(tamperedContent);

    await expect(
      service.getArtifactStream('doc-123', 1, ArtifactType.OFFICIAL_UNSIGNED, mockUser)
    ).rejects.toThrow(/CẢNH BÁO TOÀN VẸN/i);
  });
});
