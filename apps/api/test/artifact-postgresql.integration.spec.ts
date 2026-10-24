import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as crypto from 'crypto';
import { PrismaClient, UserRole } from '@prisma/client';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ArtifactStatus, ArtifactType, AuditAction } from '@trinh-ky/shared';
import { UserPrincipal } from '../src/common/interfaces/user-principal.interface.js';
import { StorageService } from '../src/modules/artifact/storage/storage.service.js';
import { PdfGeneratorService } from '../src/modules/artifact/pdf-generator.service.js';
import { ArtifactService } from '../src/modules/artifact/artifact.service.js';

describe('Phase 13.1: PDF Rendering Engine & Secure Artifact Storage (PostgreSQL Integration)', () => {
  let prisma: PrismaClient;
  let storageService: StorageService;
  let pdfGenerator: PdfGeneratorService;
  let artifactService: ArtifactService;

  let orgAlpha: any;
  let orgBeta: any;
  let userAlpha: any;
  let userBeta: any;
  let template: any;
  let templateVersion: any;
  let testDocument: any;
  let docVersion1: any;

  let principalAlpha: UserPrincipal;
  let principalBeta: UserPrincipal;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    storageService = new StorageService();
    pdfGenerator = new PdfGeneratorService();
    artifactService = new ArtifactService(prisma as any, storageService, pdfGenerator);

    // 1. Tạo tổ chức Alpha và Beta để kiểm tra Tenant Isolation
    orgAlpha = await prisma.organization.create({
      data: {
        code: `ORG_ALPHA_ART_${Date.now()}`,
        name: 'Tập đoàn Alpha Artifact Testing',
      },
    });

    orgBeta = await prisma.organization.create({
      data: {
        code: `ORG_BETA_ART_${Date.now()}`,
        name: 'Công ty Beta Artifact Testing',
      },
    });

    // 2. Tạo User thuộc Alpha và Beta
    userAlpha = await prisma.user.create({
      data: {
        email: `author-alpha-${Date.now()}@vinagroup.vn`,
        passwordHash: 'dummy_hash',
        fullName: 'Nguyễn Văn Alpha',
        role: UserRole.USER,
        organizationId: orgAlpha.id,
      },
    });

    userBeta = await prisma.user.create({
      data: {
        email: `user-beta-${Date.now()}@vinagroup.vn`,
        passwordHash: 'dummy_hash',
        fullName: 'Trần Thị Beta',
        role: UserRole.USER,
        organizationId: orgBeta.id,
      },
    });

    principalAlpha = {
      id: userAlpha.id,
      email: userAlpha.email,
      fullName: userAlpha.fullName,
      role: UserRole.USER,
      organizationId: orgAlpha.id,
      departmentId: null,
    };

    principalBeta = {
      id: userBeta.id,
      email: userBeta.email,
      fullName: userBeta.fullName,
      role: UserRole.USER,
      organizationId: orgBeta.id,
      departmentId: null,
    };

    // 3. Tạo Form Template và Version
    template = await prisma.formTemplate.create({
      data: {
        code: `TPL_ART_${Date.now()}`,
        title: 'Mẫu biểu kiểm thử PDF Artifact',
        organizationId: orgAlpha.id,
        createdById: userAlpha.id,
        fields: [],
        layoutBlocks: [],
      },
    });

    templateVersion = await prisma.formTemplateVersion.create({
      data: {
        templateId: template.id,
        versionNumber: 1,
        title: 'Mẫu biểu kiểm thử PDF Artifact v1',
        fields: [
          { key: 'muc_dich', label: 'Mục đích đề xuất', type: 'text', required: true, order: 1 },
          { key: 'kinh_phi', label: 'Kinh phí dự kiến', type: 'currency_vnd', required: true, order: 2 },
          { key: 'ngay_can', label: 'Thời hạn hoàn thành', type: 'date', required: true, order: 3 },
          { key: 'yeu_cau_dac_biet', label: 'Yêu cầu đặc biệt', type: 'text', required: false, order: 4 },
        ],
        layoutBlocks: [],
        createdById: userAlpha.id,
      },
    });

    // 4. Tạo Document và DocumentVersion v1
    testDocument = await prisma.document.create({
      data: {
        documentNumber: `TK-ART-${Date.now()}`,
        title: 'Đề xuất trang bị thiết bị văn phòng',
        templateId: template.id,
        templateVersionId: templateVersion.id,
        organizationId: orgAlpha.id,
        createdById: userAlpha.id,
        currentVersion: 1,
      },
    });

    const formDataPayload = {
      muc_dich: 'Trang bị máy tính hiệu năng cao cho bộ phận kỹ thuật',
      kinh_phi: 65000000,
      ngay_can: '2026-11-20',
      yeu_cau_dac_biet: 'Hỗ trợ bảo hành 3 năm tận nơi',
    };
    const formDataHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(formDataPayload))
      .digest('hex');

    docVersion1 = await prisma.documentVersion.create({
      data: {
        documentId: testDocument.id,
        versionNumber: 1,
        formData: formDataPayload,
        sha256Hash: formDataHash,
        createdById: userAlpha.id,
      },
    });
  });

  afterAll(async () => {
    // Dọn dẹp dữ liệu test
    if (testDocument?.id) {
      await prisma.documentArtifact.deleteMany({ where: { documentId: testDocument.id } });
      await prisma.documentVersion.deleteMany({ where: { documentId: testDocument.id } });
      await prisma.auditLog.deleteMany({ where: { documentId: testDocument.id } });
      await prisma.document.delete({ where: { id: testDocument.id } });
    }
    if (template?.id) {
      await prisma.formTemplateVersion.deleteMany({ where: { templateId: template.id } });
      await prisma.formTemplate.delete({ where: { id: template.id } });
    }
    if (userAlpha?.id) await prisma.user.delete({ where: { id: userAlpha.id } });
    if (userBeta?.id) await prisma.user.delete({ where: { id: userBeta.id } });
    if (orgAlpha?.id) await prisma.organization.delete({ where: { id: orgAlpha.id } });
    if (orgBeta?.id) await prisma.organization.delete({ where: { id: orgBeta.id } });
    await prisma.$disconnect();
  });

  it('1. Render artifact thành công và lưu trữ nhị phân vật lý trên Storage', async () => {
    const artifactView = await artifactService.renderArtifact(
      testDocument.id,
      { versionNumber: 1, artifactType: ArtifactType.OFFICIAL_UNSIGNED },
      principalAlpha
    );

    expect(artifactView).toBeDefined();
    expect(artifactView.status).toBe(ArtifactStatus.COMPLETED);
    expect(artifactView.rawPdfHash).toBeDefined();
    expect(artifactView.sizeBytes).toBeGreaterThan(1000);
    expect(artifactView.storageKey).toBeDefined();

    // Kiểm tra tệp tin thực tế trong kho lưu trữ
    const fileExists = await storageService.exists(artifactView.storageKey!);
    expect(fileExists).toBe(true);

    const physicalBuffer = await storageService.get(artifactView.storageKey!);
    expect(physicalBuffer.length).toBe(artifactView.sizeBytes);

    // Kiểm tra Magic Bytes PDF: %PDF-1.7
    expect(physicalBuffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    // Đối soát mã băm nhị phân: SHA-256 tính từ byte vật lý phải khớp 100% với rawPdfHash
    const computedPhysicalHash = crypto.createHash('sha256').update(physicalBuffer).digest('hex');
    expect(computedPhysicalHash).toBe(artifactView.rawPdfHash);

    // Xác nhận rawPdfHash KHÔNG PHẢI là hash của formData
    expect(artifactView.rawPdfHash).not.toBe(artifactView.formDataHash);

    // Kiểm tra audit log
    const auditRecord = await prisma.auditLog.findFirst({
      where: {
        documentId: testDocument.id,
        action: AuditAction.RENDER_PDF,
      },
    });
    expect(auditRecord).toBeDefined();
  });

  it('2. Tính Idempotency: Yêu cầu render lần 2 trả về ngay kết quả đã hoàn thành mà không sinh file trùng', async () => {
    const firstCall = await artifactService.renderArtifact(
      testDocument.id,
      { versionNumber: 1, artifactType: ArtifactType.OFFICIAL_UNSIGNED },
      principalAlpha
    );

    const secondCall = await artifactService.renderArtifact(
      testDocument.id,
      { versionNumber: 1, artifactType: ArtifactType.OFFICIAL_UNSIGNED },
      principalAlpha
    );

    expect(secondCall.id).toBe(firstCall.id);
    expect(secondCall.rawPdfHash).toBe(firstCall.rawPdfHash);
    expect(secondCall.storageKey).toBe(firstCall.storageKey);

    // Xác nhận trong CSDL chỉ có duy nhất 1 bản ghi artifact cho version 1 & OFFICIAL_UNSIGNED
    const artifactsCount = await prisma.documentArtifact.count({
      where: {
        documentVersionId: docVersion1.id,
        artifactType: ArtifactType.OFFICIAL_UNSIGNED,
      },
    });
    expect(artifactsCount).toBe(1);
  });

  it('3. Xử lý tương tranh (Concurrency): 5 yêu cầu render đồng thời chỉ sinh đúng 1 tệp artifact duy nhất', async () => {
    // Thử nghiệm render đồng thời cho loại PREVIEW
    const promises = Array.from({ length: 5 }, () =>
      artifactService.renderArtifact(
        testDocument.id,
        { versionNumber: 1, artifactType: ArtifactType.PREVIEW },
        principalAlpha
      )
    );

    const results = await Promise.all(promises);

    // Toàn bộ 5 lời gọi đều nhận cùng 1 artifact ID và cùng 1 mã hash
    const firstId = results[0].id;
    for (const r of results) {
      expect(r.id).toBe(firstId);
      expect(r.status).toBe(ArtifactStatus.COMPLETED);
    }

    const previewArtifactsCount = await prisma.documentArtifact.count({
      where: {
        documentVersionId: docVersion1.id,
        artifactType: ArtifactType.PREVIEW,
      },
    });
    expect(previewArtifactsCount).toBe(1);
  });

  it('4. Bảo mật Cách ly Đa Doanh nghiệp (Tenant Isolation): User Beta bị từ chối 403 khi thao tác hồ sơ Alpha', async () => {
    // User Beta cố tình yêu cầu render hồ sơ của Alpha
    await expect(
      artifactService.renderArtifact(
        testDocument.id,
        { versionNumber: 1, artifactType: ArtifactType.OFFICIAL_UNSIGNED },
        principalBeta
      )
    ).rejects.toThrow(ForbiddenException);

    // User Beta cố tình tra cứu trạng thái
    await expect(
      artifactService.getArtifactStatus(
        testDocument.id,
        1,
        ArtifactType.OFFICIAL_UNSIGNED,
        principalBeta
      )
    ).rejects.toThrow(ForbiddenException);

    // User Beta cố tình tải luồng tệp
    await expect(
      artifactService.getArtifactStream(
        testDocument.id,
        1,
        ArtifactType.OFFICIAL_UNSIGNED,
        principalBeta
      )
    ).rejects.toThrow(ForbiddenException);
  });

  it('5. Từ chối yêu cầu render cho phiên bản không tồn tại (404 Not Found)', async () => {
    await expect(
      artifactService.renderArtifact(
        testDocument.id,
        { versionNumber: 999, artifactType: ArtifactType.OFFICIAL_UNSIGNED },
        principalAlpha
      )
    ).rejects.toThrow(NotFoundException);
  });

  it('6. getArtifactStream trả về luồng tệp đầy đủ với tên tệp và hash kiểm toán', async () => {
    const stream = await artifactService.getArtifactStream(
      testDocument.id,
      1,
      ArtifactType.OFFICIAL_UNSIGNED,
      principalAlpha
    );

    expect(stream.buffer).toBeDefined();
    expect(stream.buffer.length).toBeGreaterThan(1000);
    expect(stream.fileName).toContain(testDocument.documentNumber);
    expect(stream.artifact.rawPdfHash).toBeDefined();
  });
});
