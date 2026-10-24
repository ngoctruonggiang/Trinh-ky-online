import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as crypto from 'crypto';
import { PrismaClient, UserRole } from '@prisma/client';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ArtifactStatus, ArtifactType, AuditAction, CertificateStatus, KeyStorageType } from '@trinh-ky/shared';
import { UserPrincipal } from '../src/common/interfaces/user-principal.interface.js';
import { StorageService } from '../src/modules/artifact/storage/storage.service.js';
import { PdfGeneratorService } from '../src/modules/artifact/pdf-generator.service.js';
import { ArtifactService } from '../src/modules/artifact/artifact.service.js';
import { DevLocalKeystoreProvider } from '../src/modules/signing/providers/dev-local-keystore.provider.js';
import { DevKeystoreGenerator } from '../src/modules/signing/dev-keystore-generator.js';
import { PdfSigningService } from '../src/modules/signing/engine/pdf-signing.service.js';

describe('Phase 13.2.2: CMS/PDF Signing Engine (PostgreSQL Integration)', () => {
  let prisma: PrismaClient;
  let storageService: StorageService;
  let pdfGenerator: PdfGeneratorService;
  let artifactService: ArtifactService;
  let keystoreProvider: DevLocalKeystoreProvider;
  let pdfSigningService: PdfSigningService;

  let orgAlpha: any;
  let orgBeta: any;
  let userAlpha1: any;
  let userAlpha2: any;
  let userBeta: any;

  let principalAlpha1: UserPrincipal;
  let principalAlpha2: UserPrincipal;
  let principalBeta: UserPrincipal;

  let template: any;
  let templateVersion: any;
  let documentAlpha: any;
  let docVersionAlpha: any;

  let certAlpha1: any;
  let keystoreAlpha1: any;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    storageService = new StorageService();
    pdfGenerator = new PdfGeneratorService();
    artifactService = new ArtifactService(prisma as any, storageService, pdfGenerator);
    keystoreProvider = new DevLocalKeystoreProvider();
    pdfSigningService = new PdfSigningService(
      prisma as any,
      storageService,
      artifactService,
      keystoreProvider
    );

    // 1. Tạo tổ chức Alpha và Beta
    orgAlpha = await prisma.organization.create({
      data: {
        code: `ORG_ALPHA_SIG_${Date.now()}`,
        name: 'Tập đoàn Ký số Alpha Corp',
      },
    });

    orgBeta = await prisma.organization.create({
      data: {
        code: `ORG_BETA_SIG_${Date.now()}`,
        name: 'Công ty Ký số Beta Ltd',
      },
    });

    // 2. Tạo Users
    userAlpha1 = await prisma.user.create({
      data: {
        email: `signer1-alpha-${Date.now()}@vinagroup.vn`,
        passwordHash: 'dummy_hash',
        fullName: 'Nguyễn Văn Ký Số Alpha',
        role: UserRole.USER,
        organizationId: orgAlpha.id,
      },
    });

    userAlpha2 = await prisma.user.create({
      data: {
        email: `user2-alpha-${Date.now()}@vinagroup.vn`,
        passwordHash: 'dummy_hash',
        fullName: 'Trần Văn Nhân Viên Alpha',
        role: UserRole.USER,
        organizationId: orgAlpha.id,
      },
    });

    userBeta = await prisma.user.create({
      data: {
        email: `user-beta-${Date.now()}@beta.vn`,
        passwordHash: 'dummy_hash',
        fullName: 'Lê Thị Beta',
        role: UserRole.USER,
        organizationId: orgBeta.id,
      },
    });

    principalAlpha1 = {
      id: userAlpha1.id,
      email: userAlpha1.email,
      fullName: userAlpha1.fullName,
      role: UserRole.USER,
      organizationId: orgAlpha.id,
      departmentId: null,
    };

    principalAlpha2 = {
      id: userAlpha2.id,
      email: userAlpha2.email,
      fullName: userAlpha2.fullName,
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

    // 3. Tạo mẫu tài liệu (FormTemplate & FormTemplateVersion)
    template = await prisma.formTemplate.create({
      data: {
        code: `TPL_SIGN_${Date.now()}`,
        title: 'Mẫu Hợp đồng Ký số 2026',
        organizationId: orgAlpha.id,
        createdById: userAlpha1.id,
        fields: [],
        layoutBlocks: [],
      },
    });

    templateVersion = await prisma.formTemplateVersion.create({
      data: {
        templateId: template.id,
        versionNumber: 1,
        title: 'Hợp đồng Kinh tế Điện tử v1',
        fields: [
          { key: 'contractNo', label: 'Số hợp đồng', type: 'text', required: true, order: 1 },
          { key: 'partnerName', label: 'Đối tác', type: 'text', required: true, order: 2 },
          { key: 'amount', label: 'Giá trị hợp đồng', type: 'currency_vnd', required: true, order: 3 },
        ],
        layoutBlocks: [],
        createdById: userAlpha1.id,
      },
    });

    // 4. Tạo Document & DocumentVersion
    documentAlpha = await prisma.document.create({
      data: {
        documentNumber: `DOC-SIG-${Date.now()}`,
        title: 'Hợp đồng Cung cấp Dịch vụ Công nghệ 2026',
        status: 'SUBMITTED',
        organizationId: orgAlpha.id,
        templateId: template.id,
        templateVersionId: templateVersion.id,
        createdById: userAlpha1.id,
        currentVersion: 1,
      },
    });

    const formData = {
      contractNo: 'HD-2026/ALPHA-TECH',
      partnerName: 'Công ty Cổ phần Giải pháp Số Việt Nam',
      amount: 500000000,
    };
    const formDataHash = crypto.createHash('sha256').update(JSON.stringify(formData)).digest('hex');

    docVersionAlpha = await prisma.documentVersion.create({
      data: {
        documentId: documentAlpha.id,
        versionNumber: 1,
        formData: formData as any,
        sha256Hash: formDataHash,
        changeSummary: 'Phiên bản khởi tạo ban đầu',
        createdById: userAlpha1.id,
      },
    });

    // 5. Tạo Keystore & X.509 Certificate cho userAlpha1
    const alias1 = `alpha_signer_${Date.now()}`;
    keystoreAlpha1 = DevKeystoreGenerator.generateSelfSignedKeystore({
      commonName: userAlpha1.fullName,
      organizationName: orgAlpha.name,
      passphrase: 'CertPassphrase2026!',
    });
    keystoreProvider.importKeystore(alias1, keystoreAlpha1.p12Buffer, 'CertPassphrase2026!');

    certAlpha1 = await prisma.digitalCertificate.create({
      data: {
        organizationId: orgAlpha.id,
        userId: userAlpha1.id,
        keyAlias: alias1,
        keyStorageType: KeyStorageType.DEV_KEYSTORE,
        subjectDn: keystoreAlpha1.subjectDn,
        issuerDn: keystoreAlpha1.issuerDn,
        serialNumber: keystoreAlpha1.serialNumber,
        fingerprintSha256: keystoreAlpha1.fingerprintSha256,
        certificatePem: keystoreAlpha1.certificatePem,
        validFrom: keystoreAlpha1.validFrom,
        validTo: keystoreAlpha1.validTo,
        status: CertificateStatus.ACTIVE,
      },
    });

    // 6. Render PDF Chưa Ký (OFFICIAL_UNSIGNED)
    await artifactService.renderArtifact(
      documentAlpha.id,
      { versionNumber: 1, artifactType: ArtifactType.OFFICIAL_UNSIGNED },
      principalAlpha1
    );
  });

  afterAll(async () => {
    // Dọn dẹp dữ liệu kiểm thử
    if (documentAlpha) {
      const artifacts = await prisma.documentArtifact.findMany({
        where: { documentId: documentAlpha.id },
      });
      for (const art of artifacts) {
        try {
          await storageService.delete(art.storageKey);
        } catch {}
      }
      await prisma.documentArtifact.deleteMany({ where: { documentId: documentAlpha.id } });
      await prisma.documentVersion.deleteMany({ where: { documentId: documentAlpha.id } });
      await prisma.document.deleteMany({ where: { id: documentAlpha.id } });
    }

    if (certAlpha1) {
      await prisma.digitalCertificate.deleteMany({ where: { id: certAlpha1.id } });
      try {
        await keystoreProvider.deleteKey(certAlpha1.keyAlias);
      } catch {}
    }

    if (template) {
      await prisma.formTemplateVersion.deleteMany({ where: { templateId: template.id } });
      await prisma.formTemplate.deleteMany({ where: { id: template.id } });
    }

    if (orgAlpha) {
      await prisma.user.deleteMany({ where: { organizationId: orgAlpha.id } });
      await prisma.organization.deleteMany({ where: { id: orgAlpha.id } });
    }

    if (orgBeta) {
      await prisma.user.deleteMany({ where: { organizationId: orgBeta.id } });
      await prisma.organization.deleteMany({ where: { id: orgBeta.id } });
    }

    await prisma.$disconnect();
  });

  it('1. should sign document PDF successfully, generating SIGNED_PDF artifact and preserving OFFICIAL_UNSIGNED', async () => {
    // Trước khi ký: Đã có OFFICIAL_UNSIGNED
    const unsignedArtifactBefore = await prisma.documentArtifact.findFirst({
      where: {
        documentId: documentAlpha.id,
        documentVersionId: docVersionAlpha.id,
        artifactType: ArtifactType.OFFICIAL_UNSIGNED,
      },
    });
    expect(unsignedArtifactBefore).toBeDefined();
    const originalRawPdfHash = unsignedArtifactBefore?.rawPdfHash;

    // Thực hiện ký
    const signResult = await pdfSigningService.signDocument(
      documentAlpha.id,
      {
        reason: 'Phê duyệt hợp đồng kinh tế 2026',
        location: 'Hà Nội, Việt Nam',
        certificateId: certAlpha1.id,
      },
      principalAlpha1
    );

    expect(signResult).toBeDefined();
    expect(signResult.documentId).toBe(documentAlpha.id);
    expect(signResult.documentVersionId).toBe(docVersionAlpha.id);
    expect(signResult.signerSubject).toBe(certAlpha1.subjectDn);
    expect(signResult.rawPdfHash).toBe(originalRawPdfHash);
    expect(signResult.signedPdfHash).toBeDefined();
    expect(signResult.signedPdfHash.length).toBe(64);
    expect(signResult.signedPdfHash).not.toBe(signResult.rawPdfHash);
    expect(signResult.byteRange).toHaveLength(4);

    // Kiểm tra Artifact trong Database
    const signedArtifact = await prisma.documentArtifact.findFirst({
      where: {
        documentId: documentAlpha.id,
        documentVersionId: docVersionAlpha.id,
        artifactType: ArtifactType.SIGNED_PDF,
      },
    });

    expect(signedArtifact).toBeDefined();
    expect(signedArtifact?.signedPdfHash).toBe(signResult.signedPdfHash);
    expect(signedArtifact?.status).toBe(ArtifactStatus.COMPLETED);
    expect(signedArtifact?.certificateId).toBe(certAlpha1.id);
    expect(signedArtifact?.signerSubject).toBe(certAlpha1.subjectDn);
    expect(signedArtifact?.byteRange).toEqual(signResult.byteRange);

    // Đảm bảo OFFICIAL_UNSIGNED vẫn nguyên vẹn (KHÔNG BỊ GHI ĐÈ)
    const unsignedArtifactAfter = await prisma.documentArtifact.findFirst({
      where: {
        documentId: documentAlpha.id,
        documentVersionId: docVersionAlpha.id,
        artifactType: ArtifactType.OFFICIAL_UNSIGNED,
      },
    });
    expect(unsignedArtifactAfter).toBeDefined();
    expect(unsignedArtifactAfter?.rawPdfHash).toBe(originalRawPdfHash);
    expect(unsignedArtifactAfter?.id).toBe(unsignedArtifactBefore?.id);
  });

  it('2. should verify signed PDF correctly and independently (integrity, ByteRange and CMS signature)', async () => {
    const verifyResult = await pdfSigningService.verifyDocumentSignature(
      documentAlpha.id,
      { versionNumber: 1 },
      principalAlpha1
    );

    expect(verifyResult.isValid).toBe(true);
    expect(verifyResult.isTampered).toBe(false);
    expect(verifyResult.isDigestValid).toBe(true);
    expect(verifyResult.isSignatureValid).toBe(true);
    expect(verifyResult.signerSubject).toBe(certAlpha1.subjectDn);
    expect(verifyResult.byteRange).toHaveLength(4);
    expect(verifyResult.embeddedDigest).toBe(verifyResult.computedDigest);
  });

  it('3. should detect byte-level tampering in signed PDF and fail verification', async () => {
    const signedArtifact = await prisma.documentArtifact.findFirst({
      where: {
        documentId: documentAlpha.id,
        documentVersionId: docVersionAlpha.id,
        artifactType: ArtifactType.SIGNED_PDF,
      },
    });
    expect(signedArtifact).toBeDefined();

    // Đọc buffer thực tế từ Storage
    const originalBuffer = await storageService.get(signedArtifact!.storageKey!);

    // Giả lập hacker sửa đổi 1 byte trong vùng nội dung được ký (ByteRange[0]..ByteRange[1])
    const tamperedBuffer = Buffer.from(originalBuffer);
    tamperedBuffer[50] = tamperedBuffer[50] ^ 0xff; // Đảo bit tại byte 50

    // Ghi đè tệp tạm vào storage
    await storageService.put(signedArtifact!.storageKey!, tamperedBuffer);

    // Xác minh lại
    const tamperedVerifyResult = await pdfSigningService.verifyDocumentSignature(
      documentAlpha.id,
      { versionNumber: 1 },
      principalAlpha1
    );

    expect(tamperedVerifyResult.isValid).toBe(false);
    expect(tamperedVerifyResult.isTampered).toBe(true);
    expect(tamperedVerifyResult.isDigestValid).toBe(false);

    // Phục hồi lại buffer gốc để các test sau không bị ảnh hưởng
    await storageService.put(signedArtifact!.storageKey!, originalBuffer);
  });

  it('4. should enforce strict Tenant Isolation (User from another tenant cannot sign or verify)', async () => {
    // Tenant Beta cố ký hồ sơ của Tenant Alpha -> 403 Forbidden
    await expect(
      pdfSigningService.signDocument(
        documentAlpha.id,
        { reason: 'Tấn công mạo danh' },
        principalBeta
      )
    ).rejects.toThrow(ForbiddenException);

    // Tenant Beta cố xác minh chữ ký hồ sơ của Tenant Alpha -> 403 Forbidden
    await expect(
      pdfSigningService.verifyDocumentSignature(documentAlpha.id, { versionNumber: 1 }, principalBeta)
    ).rejects.toThrow(ForbiddenException);

    // Tenant Beta cố tải PDF đã ký của Tenant Alpha -> 403 Forbidden
    await expect(
      artifactService.getArtifactStream(documentAlpha.id, 1, ArtifactType.SIGNED_PDF, principalBeta)
    ).rejects.toThrow(ForbiddenException);
  });

  it('5. should reject signing if certificate belongs to another user without permission', async () => {
    // UserAlpha2 cố tình ký bằng chứng thư của UserAlpha1
    await expect(
      pdfSigningService.signDocument(
        documentAlpha.id,
        {
          reason: 'Ký mạo danh đồng nghiệp',
          certificateId: certAlpha1.id,
        },
        principalAlpha2
      )
    ).rejects.toThrow(ForbiddenException);
  });

  it('6. should reject signing if certificate is REVOKED', async () => {
    // Cập nhật trạng thái chứng thư sang REVOKED
    await prisma.digitalCertificate.update({
      where: { id: certAlpha1.id },
      data: { status: CertificateStatus.REVOKED, revokedAt: new Date() },
    });

    await expect(
      pdfSigningService.signDocument(
        documentAlpha.id,
        {
          reason: 'Ký sau khi thu hồi',
          certificateId: certAlpha1.id,
        },
        principalAlpha1
      )
    ).rejects.toThrow(BadRequestException);

    // Khôi phục lại ACTIVE
    await prisma.digitalCertificate.update({
      where: { id: certAlpha1.id },
      data: { status: CertificateStatus.ACTIVE, revokedAt: null },
    });
  });

  it('7. should record audit log with signedPdfHash upon successful signing', async () => {
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        documentId: documentAlpha.id,
        action: AuditAction.DOCUMENT_SIGN_PDF,
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(auditLogs.length).toBeGreaterThan(0);
    const latestLog = auditLogs[0];
    expect(latestLog.userId).toBe(userAlpha1.id);
    expect((latestLog.details as any)?.signedPdfHash).toBeDefined();
    expect((latestLog.details as any)?.certificateId).toBe(certAlpha1.id);
  });
});
