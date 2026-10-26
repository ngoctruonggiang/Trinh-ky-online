import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as crypto from 'crypto';
import { PrismaClient, UserRole } from '@prisma/client';
import { BadRequestException, ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ArtifactStatus, ArtifactType, AuditAction, CertificateStatus, KeyStorageType } from '@trinh-ky/shared';
import { UserPrincipal } from '../src/common/interfaces/user-principal.interface.js';
import { StorageService } from '../src/modules/artifact/storage/storage.service.js';
import { PdfGeneratorService } from '../src/modules/artifact/pdf-generator.service.js';
import { ArtifactService } from '../src/modules/artifact/artifact.service.js';
import { DevLocalKeystoreProvider } from '../src/modules/signing/providers/dev-local-keystore.provider.js';
import { DevKeystoreGenerator } from '../src/modules/signing/dev-keystore-generator.js';
import { PdfSigningService } from '../src/modules/signing/engine/pdf-signing.service.js';
import { TimestampService } from '../src/modules/signing/timestamp/timestamp.service.js';
import { DevTestTsaProvider } from '../src/modules/signing/timestamp/dev-test-tsa.provider.js';
import { RevocationService } from '../src/modules/signing/revocation/revocation.service.js';
import { PdfDssService } from '../src/modules/signing/dss/pdf-dss.service.js';

describe('Phase 13.3.2: PAdES Baseline B-LT, DSS/VRI & Long-Term Validation (PostgreSQL Integration)', () => {
  let prisma: PrismaClient;
  let storageService: StorageService;
  let pdfGenerator: PdfGeneratorService;
  let artifactService: ArtifactService;
  let keystoreProvider: DevLocalKeystoreProvider;
  let timestampService: TimestampService;
  let revocationService: RevocationService;
  let pdfDssService: PdfDssService;
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
    timestampService = new TimestampService();
    revocationService = new RevocationService();
    pdfDssService = new PdfDssService(revocationService);
    pdfSigningService = new PdfSigningService(
      prisma as any,
      storageService,
      artifactService,
      keystoreProvider,
      timestampService,
      pdfDssService
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
    if (orgAlpha) {
      const alphaDocs = await prisma.document.findMany({ where: { organizationId: orgAlpha.id } });
      for (const d of alphaDocs) {
        const artifacts = await prisma.documentArtifact.findMany({ where: { documentId: d.id } });
        for (const art of artifacts) {
          try { await storageService.delete(art.storageKey); } catch {}
        }
        await prisma.documentArtifact.deleteMany({ where: { documentId: d.id } });
        await prisma.documentVersion.deleteMany({ where: { documentId: d.id } });
      }
      await prisma.document.deleteMany({ where: { organizationId: orgAlpha.id } });
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

    // Thực hiện ký không kèm timestamp
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
    expect(signResult.hasTimestamp).toBe(false);

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
    expect(signedArtifact?.hasTimestamp).toBe(false);

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
    expect(verifyResult.hasTimestamp).toBe(false);
    expect(verifyResult.signerSubject).toBe(certAlpha1.subjectDn);
    expect(verifyResult.byteRange).toHaveLength(4);
    expect(verifyResult.computedDigestHex).toBe(verifyResult.messageDigestHex);
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

    // Giả lập sửa đổi 1 byte trong vùng nội dung được ký
    const tamperedBuffer = Buffer.from(originalBuffer);
    tamperedBuffer[50] = tamperedBuffer[50] ^ 0xff;

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

    await prisma.digitalCertificate.update({
      where: { id: certAlpha1.id },
      data: { status: CertificateStatus.ACTIVE, revokedAt: null },
    });
  });

  it('7. should sign with RFC 3161 Timestamp (requireTimestamp: true) and store timestamp metadata', async () => {
    const signResult = await pdfSigningService.signDocument(
      documentAlpha.id,
      {
        reason: 'Ký duyệt cấp cao có dấu thời gian tin cậy',
        location: 'Hà Nội, Việt Nam',
        certificateId: certAlpha1.id,
        requireTimestamp: true,
      },
      principalAlpha1
    );

    expect(signResult.hasTimestamp).toBe(true);
    expect(signResult.timestampGenTime).toBeDefined();
    expect(signResult.tsaSubject).toContain('Trusted TSA');

    // Kiểm tra CSDL
    const signedArtifact = await prisma.documentArtifact.findFirst({
      where: {
        documentId: documentAlpha.id,
        documentVersionId: docVersionAlpha.id,
        artifactType: ArtifactType.SIGNED_PDF,
      },
    });

    expect(signedArtifact?.hasTimestamp).toBe(true);
    expect(signedArtifact?.timestampGenTime).toBeDefined();
    expect(signedArtifact?.tsaSubject).toContain('Trusted TSA');
    expect(signedArtifact?.tsaSerialNumber).toBeDefined();
    expect(signedArtifact?.tsaPolicyOid).toBeDefined();

    // Xác minh chữ ký kèm timestamp
    const verifyResult = await pdfSigningService.verifyDocumentSignature(
      documentAlpha.id,
      { versionNumber: 1 },
      principalAlpha1
    );

    expect(verifyResult.isValid).toBe(true);
    expect(verifyResult.hasTimestamp).toBe(true);
    expect(verifyResult.isTimestampValid).toBe(true);
    expect(verifyResult.timestampGenTime).toBeDefined();
    expect(verifyResult.tsaSubject).toContain('Trusted TSA');
  });

  it('8. should fail-closed when requireTimestamp is true and TSA provider fails', async () => {
    const failingTsa = new DevTestTsaProvider({ simulateFailure: true });
    timestampService.setProvider(failingTsa);

    await expect(
      pdfSigningService.signDocument(
        documentAlpha.id,
        {
          reason: 'Ký bắt buộc timestamp nhưng TSA hỏng',
          certificateId: certAlpha1.id,
          requireTimestamp: true,
        },
        principalAlpha1
      )
    ).rejects.toThrow(/Đóng dấu thời gian RFC 3161 thất bại|ngừng phục vụ/);

    // Khôi phục lại TSA hoạt động bình thường
    timestampService.setProvider(new DevTestTsaProvider());
  });

  it('9. should record audit log with timestamp metadata upon signing with TSA', async () => {
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
    expect((latestLog.details as any)?.hasTimestamp).toBe(true);
    expect((latestLog.details as any)?.tsaSubject).toContain('Trusted TSA');
  });

  it('10. should add LTV to existing signed document (POST /api/documents/:id/add-ltv) and achieve PAdES B-LT', async () => {
    const addLtvResult = await pdfSigningService.addLtvToDocument(
      documentAlpha.id,
      {},
      principalAlpha1
    );

    expect(addLtvResult.hasLtv).toBe(true);
    expect(addLtvResult.ltvStatus).toBe('VALID');
    expect(addLtvResult.padesLevel).toBe('PADES_B_LT');
    expect(addLtvResult.dssCertsCount).toBeGreaterThanOrEqual(1);
    expect(addLtvResult.dssOcspsCount).toBeGreaterThanOrEqual(1);
    expect(addLtvResult.embeddedAt).toBeDefined();

    // Kiểm tra bản ghi DocumentArtifact trong CSDL PostgreSQL
    const signedArtifact = await prisma.documentArtifact.findFirst({
      where: {
        documentId: documentAlpha.id,
        documentVersionId: docVersionAlpha.id,
        artifactType: ArtifactType.SIGNED_PDF,
      },
    });

    expect(signedArtifact?.hasLtv).toBe(true);
    expect(signedArtifact?.ltvStatus).toBe('VALID');
    expect(signedArtifact?.dssCertsCount).toBeGreaterThanOrEqual(1);
    expect(signedArtifact?.dssOcspsCount).toBeGreaterThanOrEqual(1);
    expect(signedArtifact?.ltvEmbeddedAt).toBeDefined();
  });

  it('11. should verify LTV data via GET /api/documents/:id/verify-ltv and verifyDocumentSignature', async () => {
    // 1. Thẩm định qua verifyLtv
    const ltvVerification = await pdfSigningService.verifyLtv(
      documentAlpha.id,
      principalAlpha1
    );

    expect(ltvVerification.hasLtv).toBe(true);
    expect(ltvVerification.ltvValidationStatus).toBe('VALID');
    expect(ltvVerification.padesLevel).toBe('PADES_B_LT');
    expect(ltvVerification.dssInfo.certsCount).toBeGreaterThanOrEqual(1);
    expect(ltvVerification.dssInfo.ocspsCount).toBeGreaterThanOrEqual(1);
    expect(ltvVerification.revocationStatus).toBe('GOOD');

    // 2. Thẩm định qua verifyDocumentSignature
    const fullVerify = await pdfSigningService.verifyDocumentSignature(
      documentAlpha.id,
      { versionNumber: 1 },
      principalAlpha1
    );

    expect(fullVerify.isValid).toBe(true);
    expect(fullVerify.isSignatureValid).toBe(true);
    expect(fullVerify.hasTimestamp).toBe(true);
    expect(fullVerify.isTimestampValid).toBe(true);
    expect(fullVerify.hasLtv).toBe(true);
    expect(fullVerify.ltvDataPresent).toBe(true);
    expect(fullVerify.ltvValidationStatus).toBe('VALID');
    expect(fullVerify.padesLevel).toBe('PADES_B_LT');
    expect(fullVerify.dssInfo).toBeDefined();
    expect(fullVerify.dssInfo?.certsCount).toBeGreaterThanOrEqual(1);
  });

  it('12. should sign new document directly with includeLtv: true (PAdES B-LT in one step)', async () => {
    // Tạo document mới cho Alpha
    const docAlpha2 = await prisma.document.create({
      data: {
        documentNumber: `DOC-LTV-DIRECT-${Date.now()}`,
        title: 'Hồ sơ thử nghiệm PAdES B-LT ký trực tiếp',
        organizationId: orgAlpha.id,
        templateId: template.id,
        templateVersionId: templateVersion.id,
        createdById: userAlpha1.id,
        status: 'SUBMITTED',
        currentVersion: 1,
      },
    });

    const formData2 = {
      contractNumber: 'HD-DIRECT-LT-001',
      contractValue: 990000000,
      customerName: 'Đối Tác Thử Nghiệm B-LT',
    };
    const formDataHash2 = crypto.createHash('sha256').update(JSON.stringify(formData2)).digest('hex');

    const docVerAlpha2 = await prisma.documentVersion.create({
      data: {
        documentId: docAlpha2.id,
        versionNumber: 1,
        formData: formData2 as any,
        sha256Hash: formDataHash2,
        createdById: userAlpha1.id,
      },
    });

    // Render bản PDF thô OFFICIAL_UNSIGNED
    await artifactService.renderArtifact(
      docAlpha2.id,
      { versionNumber: 1, artifactType: ArtifactType.OFFICIAL_UNSIGNED },
      principalAlpha1
    );

    // Ký số kèm cả TSA và LTV trực tiếp
    const signResult = await pdfSigningService.signDocument(
      docAlpha2.id,
      {
        reason: 'Ký duyệt và nhúng đầy đủ bằng chứng kiểm tra dài hạn B-LT',
        certificateId: certAlpha1.id,
        requireTimestamp: true,
        includeLtv: true,
      },
      principalAlpha1
    );

    expect(signResult.hasTimestamp).toBe(true);
    expect(signResult.hasLtv).toBe(true);
    expect(signResult.ltvStatus).toBe('VALID');
    expect(signResult.padesLevel).toBe('PADES_B_LT');
    expect(signResult.dssCertsCount).toBeGreaterThanOrEqual(1);

    // Xác minh lại tệp vừa ký
    const verifyResult = await pdfSigningService.verifyDocumentSignature(
      docAlpha2.id,
      { versionNumber: 1 },
      principalAlpha1
    );

    expect(verifyResult.isValid).toBe(true);
    expect(verifyResult.hasLtv).toBe(true);
    expect(verifyResult.padesLevel).toBe('PADES_B_LT');
  });

  it('13. should enforce strict tenant isolation on LTV endpoints (ForbiddenException for Tenant Beta)', async () => {
    // Tenant Beta cố tình thêm LTV vào tài liệu của Alpha
    await expect(
      pdfSigningService.addLtvToDocument(
        documentAlpha.id,
        {},
        principalBeta
      )
    ).rejects.toThrow(ForbiddenException);

    // Tenant Beta cố tình xác minh LTV tài liệu của Alpha
    await expect(
      pdfSigningService.verifyLtv(
        documentAlpha.id,
        principalBeta
      )
    ).rejects.toThrow(ForbiddenException);
  });

  it('14. should record DOCUMENT_ADD_LTV audit log with DSS metrics', async () => {
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        documentId: documentAlpha.id,
        action: AuditAction.DOCUMENT_ADD_LTV,
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(auditLogs.length).toBeGreaterThan(0);
    const ltvLog = auditLogs[0];
    expect(ltvLog.userId).toBe(userAlpha1.id);
    expect((ltvLog.details as any)?.hasLtv).toBe(true);
    expect((ltvLog.details as any)?.ltvStatus).toBe('VALID');
    expect((ltvLog.details as any)?.dssCertsCount).toBeGreaterThanOrEqual(1);
    expect((ltvLog.details as any)?.dssOcspsCount).toBeGreaterThanOrEqual(1);
  });
});
