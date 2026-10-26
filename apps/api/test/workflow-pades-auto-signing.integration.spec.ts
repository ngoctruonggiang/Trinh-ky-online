import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as crypto from 'crypto';
import { PrismaClient, UserRole } from '@prisma/client';
import {
  ArtifactStatus,
  ArtifactType,
  AuditAction,
  CertificateStatus,
  DocumentStatus,
  KeyStorageType,
  StepCompletionRule,
  StepStatus,
  StepType,
  WorkflowStatus,
  AssigneeDecision,
  AssigneeRole,
} from '@trinh-ky/shared';
import { UserPrincipal } from '../src/common/interfaces/user-principal.interface.js';
import { StorageService } from '../src/modules/artifact/storage/storage.service.js';
import { PdfGeneratorService } from '../src/modules/artifact/pdf-generator.service.js';
import { ArtifactService } from '../src/modules/artifact/artifact.service.js';
import { DevLocalKeystoreProvider } from '../src/modules/signing/providers/dev-local-keystore.provider.js';
import { DevKeystoreGenerator } from '../src/modules/signing/dev-keystore-generator.js';
import { PdfSigningService } from '../src/modules/signing/engine/pdf-signing.service.js';
import { TimestampService } from '../src/modules/signing/timestamp/timestamp.service.js';
import { RevocationService } from '../src/modules/signing/revocation/revocation.service.js';
import { PdfDssService } from '../src/modules/signing/dss/pdf-dss.service.js';
import { WorkflowOrchestratorService } from '../src/modules/workflow/workflow-orchestrator.service.js';
import { DelegationService } from '../src/modules/delegation/delegation.service.js';
import { DocumentReadService } from '../src/modules/workflow/document-read.service.js';
import { PdfSignatureVerifier } from '../src/modules/signing/engine/pdf-signature.verifier.js';

describe('Phase 13.4: Workflow Auto-Signing Integration & Production Readiness (PostgreSQL Integration)', () => {
  let prisma: PrismaClient;
  let storageService: StorageService;
  let pdfGenerator: PdfGeneratorService;
  let artifactService: ArtifactService;
  let keystoreProvider: DevLocalKeystoreProvider;
  let timestampService: TimestampService;
  let revocationService: RevocationService;
  let pdfDssService: PdfDssService;
  let pdfSigningService: PdfSigningService;
  let delegationService: DelegationService;
  let orchestratorService: WorkflowOrchestratorService;
  let documentReadService: DocumentReadService;

  let orgAlpha: any;
  let orgNoCert: any;
  let creator: any;
  let manager: any;
  let director: any;
  let viceDirector: any;
  let creatorNoCert: any;
  let approverNoCert: any;

  let principalCreator: UserPrincipal;
  let principalManager: UserPrincipal;
  let principalDirector: UserPrincipal;
  let principalViceDirector: UserPrincipal;

  let orgSealCert: any;
  let templateAlpha: any;
  let templateVersionAlpha: any;
  let delegationPolicy: any;

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
    delegationService = new DelegationService(prisma as any);
    orchestratorService = new WorkflowOrchestratorService(
      prisma as any,
      delegationService,
      pdfSigningService
    );
    documentReadService = new DocumentReadService(prisma as any);

    // 1. Tạo tổ chức có chứng thư số (Alpha) và tổ chức không có chứng thư số (NoCert)
    orgAlpha = await prisma.organization.create({
      data: {
        code: `ORG_AUTOSIGN_${Date.now()}`,
        name: 'Tập đoàn Đầu tư & Công nghệ Alpha Corp',
      },
    });

    orgNoCert = await prisma.organization.create({
      data: {
        code: `ORG_NOCERT_${Date.now()}`,
        name: 'Công ty Chưa cấu hình PKI',
      },
    });

    // 2. Tạo người dùng
    creator = await prisma.user.create({
      data: {
        email: `creator-134-${Date.now()}@alphacorp.vn`,
        passwordHash: 'dummy_hash',
        fullName: 'Nguyễn Văn Đề Xuất',
        role: UserRole.USER,
        organizationId: orgAlpha.id,
      },
    });

    manager = await prisma.user.create({
      data: {
        email: `manager-134-${Date.now()}@alphacorp.vn`,
        passwordHash: 'dummy_hash',
        fullName: 'Trần Văn Trưởng Phòng',
        role: UserRole.USER,
        organizationId: orgAlpha.id,
      },
    });

    director = await prisma.user.create({
      data: {
        email: `director-134-${Date.now()}@alphacorp.vn`,
        passwordHash: 'dummy_hash',
        fullName: 'Lê Văn Giám Đốc',
        role: UserRole.USER,
        organizationId: orgAlpha.id,
      },
    });

    viceDirector = await prisma.user.create({
      data: {
        email: `vicedirector-134-${Date.now()}@alphacorp.vn`,
        passwordHash: 'dummy_hash',
        fullName: 'Phạm Thị Phó Giám Đốc',
        role: UserRole.USER,
        organizationId: orgAlpha.id,
      },
    });

    creatorNoCert = await prisma.user.create({
      data: {
        email: `creator-nocert-${Date.now()}@nocert.vn`,
        passwordHash: 'dummy_hash',
        fullName: 'Người Dùng Không Cert',
        role: UserRole.USER,
        organizationId: orgNoCert.id,
      },
    });

    approverNoCert = await prisma.user.create({
      data: {
        email: `approver-nocert-${Date.now()}@nocert.vn`,
        passwordHash: 'dummy_hash',
        fullName: 'Người Duyệt Không Cert',
        role: UserRole.USER,
        organizationId: orgNoCert.id,
      },
    });

    principalCreator = {
      id: creator.id,
      email: creator.email,
      fullName: creator.fullName,
      role: UserRole.USER,
      organizationId: orgAlpha.id,
      departmentId: null,
    };

    principalManager = {
      id: manager.id,
      email: manager.email,
      fullName: manager.fullName,
      role: UserRole.USER,
      organizationId: orgAlpha.id,
      departmentId: null,
    };

    principalDirector = {
      id: director.id,
      email: director.email,
      fullName: director.fullName,
      role: UserRole.USER,
      organizationId: orgAlpha.id,
      departmentId: null,
    };

    principalViceDirector = {
      id: viceDirector.id,
      email: viceDirector.email,
      fullName: viceDirector.fullName,
      role: UserRole.USER,
      organizationId: orgAlpha.id,
      departmentId: null,
    };

    // 3. Khởi tạo Con dấu điện tử của Tổ chức (userId: null)
    const sealAlias = `org_seal_alpha_${Date.now()}`;
    const keystoreSeal = DevKeystoreGenerator.generateSelfSignedKeystore({
      commonName: 'Con dau Dien tu Tap doan Alpha Corp',
      organizationName: orgAlpha.name,
      passphrase: 'OrgSealPass2026!',
    });
    keystoreProvider.importKeystore(sealAlias, keystoreSeal.p12Buffer, 'OrgSealPass2026!');

    orgSealCert = await prisma.digitalCertificate.create({
      data: {
        organizationId: orgAlpha.id,
        userId: null, // Con dấu chung của tổ chức
        keyAlias: sealAlias,
        keyStorageType: KeyStorageType.DEV_KEYSTORE,
        subjectDn: keystoreSeal.subjectDn,
        issuerDn: keystoreSeal.issuerDn,
        serialNumber: keystoreSeal.serialNumber,
        fingerprintSha256: keystoreSeal.fingerprintSha256,
        certificatePem: keystoreSeal.certificatePem,
        validFrom: keystoreSeal.validFrom,
        validTo: keystoreSeal.validTo,
        status: CertificateStatus.ACTIVE,
      },
    });

    // 4. Tạo chính sách ủy quyền (Director ủy quyền cho ViceDirector)
    const now = new Date();
    delegationPolicy = await prisma.delegationPolicy.create({
      data: {
        organizationId: orgAlpha.id,
        delegatorId: director.id,
        delegateeId: viceDirector.id,
        startDate: new Date(now.getTime() - 24 * 3600 * 1000),
        endDate: new Date(now.getTime() + 7 * 24 * 3600 * 1000),
        reason: 'Ủy quyền phê duyệt dự án Q4/2026',
        isActive: true,
        createdById: director.id,
      },
    });

    // 5. Tạo FormTemplate có 2 bước duyệt
    templateAlpha = await prisma.formTemplate.create({
      data: {
        code: `TPL_AUTO_SIGN_${Date.now()}`,
        title: 'Tờ trình Đầu tư Mua sắm Dự án 2026',
        organizationId: orgAlpha.id,
        createdById: creator.id,
        status: 'PUBLISHED',
        fields: [],
        layoutBlocks: [],
        defaultWorkflowSteps: [
          {
            stepOrder: 1,
            stepName: 'Trưởng phòng Tài chính Phê duyệt',
            stepType: 'SEQUENTIAL',
            completionRule: 'ALL_MUST_APPROVE',
            dueDays: 3,
            defaultUserIds: [manager.id],
            approverUserIds: [manager.id],
          },
          {
            stepOrder: 2,
            stepName: 'Ban Giám đốc Niêm phong Phê duyệt',
            stepType: 'SEQUENTIAL',
            completionRule: 'ALL_MUST_APPROVE',
            dueDays: 3,
            defaultUserIds: [director.id],
            approverUserIds: [director.id],
          },
        ],
      },
    });

    templateVersionAlpha = await prisma.formTemplateVersion.create({
      data: {
        templateId: templateAlpha.id,
        versionNumber: 1,
        title: 'Tờ trình Mua sắm v1',
        fields: [
          { key: 'projectName', label: 'Tên dự án', type: 'text', required: true, order: 1 },
          { key: 'budget', label: 'Ngân sách', type: 'currency_vnd', required: true, order: 2 },
          { key: 'reason', label: 'Lý do', type: 'text', required: true, order: 3 },
        ],
        layoutBlocks: [],
        createdById: creator.id,
      },
    });
  });

  afterAll(async () => {
    // Dọn dẹp dữ liệu kiểm thử
    if (orgAlpha) {
      await prisma.document.deleteMany({ where: { organizationId: orgAlpha.id } });
      await prisma.delegationPolicy.deleteMany({ where: { organizationId: orgAlpha.id } });
      await prisma.digitalCertificate.deleteMany({ where: { organizationId: orgAlpha.id } });
      await prisma.formTemplateVersion.deleteMany({ where: { template: { organizationId: orgAlpha.id } } });
      await prisma.formTemplate.deleteMany({ where: { organizationId: orgAlpha.id } });
      await prisma.user.deleteMany({ where: { organizationId: orgAlpha.id } });
      await prisma.organization.delete({ where: { id: orgAlpha.id } });
    }
    if (orgNoCert) {
      await prisma.document.deleteMany({ where: { organizationId: orgNoCert.id } });
      await prisma.formTemplateVersion.deleteMany({ where: { template: { organizationId: orgNoCert.id } } });
      await prisma.formTemplate.deleteMany({ where: { organizationId: orgNoCert.id } });
      await prisma.user.deleteMany({ where: { organizationId: orgNoCert.id } });
      await prisma.organization.delete({ where: { id: orgNoCert.id } });
    }
    await prisma.$disconnect();
  });

  it('1. Toàn bộ quy trình Duyệt hồ sơ 2 bước -> Tự động Ký niêm phong số PAdES B-LT khi APPROVED', async () => {
    // 1.1. Tạo hồ sơ trình ký với 2 bước duyệt
    const docData = await orchestratorService.createDocument({
      templateId: templateAlpha.id,
      title: 'Tờ trình mua sắm cụm máy chủ AI 2026',
      formData: {
        projectName: 'Hệ thống Máy chủ Trình Ký AI',
        budget: 1500000000,
        reason: 'Nâng cấp hạ tầng xử lý mật mã PAdES Baseline B-LT',
      },
      userId: creator.id,
      userOrganizationId: orgAlpha.id,
      userRole: UserRole.USER,
    });

    expect(docData).toBeDefined();
    expect(docData.status).toBe(DocumentStatus.DRAFT);

    // 1.2. Creator nộp hồ sơ (SUBMIT)
    const submitResult = await orchestratorService.submitDocument({
      documentId: docData.id,
      userId: creator.id,
    });

    expect(submitResult.documentStatus).toBe(DocumentStatus.IN_REVIEW);
    expect(submitResult.workflowStatus).toBe(WorkflowStatus.RUNNING);

    // 1.3. Step 1: Manager phê duyệt
    const step1Result = await orchestratorService.processAssigneeDecision({
      documentId: docData.id,
      userId: manager.id,
      decision: AssigneeDecision.APPROVED,
      decisionComment: 'Kính chuyển Ban Giám đốc phê duyệt quyết định đầu tư.',
      signatureImageUrl: '/signatures/manager_sign.png',
    });

    expect(step1Result.documentStatus).toBe(DocumentStatus.IN_REVIEW);
    // Hồ sơ vẫn IN_REVIEW, chưa đạt APPROVED -> Chưa tự động niêm phong
    const preSealedArtifact = await prisma.documentArtifact.findFirst({
      where: { documentId: docData.id, artifactType: ArtifactType.SIGNED_PDF },
    });
    expect(preSealedArtifact).toBeNull();

    // 1.4. Step 2: ViceDirector phê duyệt THEO ỦY QUYỀN của Director
    const step2Result = await orchestratorService.processAssigneeDecision({
      documentId: docData.id,
      userId: viceDirector.id, // Người thực tế duyệt theo ủy quyền
      decision: AssigneeDecision.APPROVED,
      decisionComment: 'Phê duyệt đầu tư theo ủy quyền của Giám đốc.',
      signatureImageUrl: '/signatures/vice_director_sign.png',
    });

    expect(step2Result.documentStatus).toBe(DocumentStatus.APPROVED);
    expect(step2Result.workflowStatus).toBe(WorkflowStatus.COMPLETED);

    // 1.5. KIỂM CHỨNG TỰ ĐỘNG NIÊM PHONG SỐ PAdES BASELINE B-LT
    // Tệp SIGNED_PDF phải tồn tại trong CSDL và Storage
    const sealedArtifact = await prisma.documentArtifact.findFirst({
      where: { documentId: docData.id, artifactType: ArtifactType.SIGNED_PDF },
    });

    expect(sealedArtifact).toBeDefined();
    expect(sealedArtifact!.status).toBe(ArtifactStatus.COMPLETED);
    expect(sealedArtifact!.certificateId).toBe(orgSealCert.id);
    expect(sealedArtifact!.hasTimestamp).toBe(true);
    expect(sealedArtifact!.hasLtv).toBe(true);
    expect(sealedArtifact!.ltvStatus).toBe('VALID');
    expect(sealedArtifact!.dssCertsCount).toBeGreaterThanOrEqual(2);
    expect(sealedArtifact!.dssOcspsCount).toBeGreaterThanOrEqual(1);

    // 1.6. KIỂM CHỨNG TOÀN VẸN MẬT MÃ BẰNG TRÌNH XÁC MINH NỘI BỘ
    const signedPdfBytes = await storageService.get(sealedArtifact!.storageKey!);
    expect(signedPdfBytes).toBeDefined();
    expect(signedPdfBytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    const verifyResult = PdfSignatureVerifier.verify(signedPdfBytes);
    expect(verifyResult.isValid).toBe(true);
    expect(verifyResult.isTampered).toBe(false);
    expect(verifyResult.isDigestValid).toBe(true);
    expect(verifyResult.isSignatureValid).toBe(true);
    expect(verifyResult.hasTimestamp).toBe(true);
    expect(verifyResult.isTimestampValid).toBe(true);
    expect(verifyResult.hasLtv).toBe(true);
    expect(verifyResult.ltvValidationStatus).toBe('VALID');
    expect(verifyResult.padesLevel).toBe('PADES_B_LT');

    // 1.7. KIỂM CHỨNG QUA API getDocumentDetail
    const docDetail = await documentReadService.getDocumentDetail(docData.id, principalCreator);
    expect(docDetail.status).toBe(DocumentStatus.APPROVED);
    expect(docDetail.signedPdfArtifact).toBeDefined();
    expect(docDetail.signedPdfArtifact!.padesLevel).toBe('PADES_B_LT');
    expect(docDetail.signedPdfArtifact!.hasTimestamp).toBe(true);
    expect(docDetail.signedPdfArtifact!.hasLtv).toBe(true);
    expect(docDetail.signedPdfArtifact!.ltvStatus).toBe('VALID');
    expect(docDetail.signedPdfArtifact!.downloadUrl).toContain('/api/documents/');

    // 1.8. KIỂM CHỨNG AUDIT TRAIL ĐẦY ĐỦ CÁC SỰ KIỆN BẮT BUỘC
    const auditLogs = await prisma.auditLog.findMany({
      where: { documentId: docData.id },
      orderBy: { createdAt: 'asc' },
    });

    const actions = auditLogs.map((l) => l.action);
    expect(actions).toContain(AuditAction.SUBMIT_DOCUMENT);
    expect(actions).toContain(AuditAction.APPROVE_STEP);
    expect(actions).toContain(AuditAction.DOCUMENT_SIGN_PDF);
    expect(actions).toContain(AuditAction.DOCUMENT_ADD_LTV);

    // Kiểm tra liên kết kiểm toán ủy quyền: actualActorId + delegatorId + delegationPolicyId
    const delegatedStepAudit = auditLogs.find(
      (l) => l.action === AuditAction.APPROVE_STEP && (l.details as any)?.isDelegated === true
    );
    expect(delegatedStepAudit).toBeDefined();
    expect((delegatedStepAudit!.details as any).delegatorId).toBe(director.id);
    expect((delegatedStepAudit!.details as any).delegationPolicyId).toBe(delegationPolicy.id);

    // Kiểm tra audit ký số niêm phong
    const signPdfAudit = auditLogs.find((l) => l.action === AuditAction.DOCUMENT_SIGN_PDF);
    expect(signPdfAudit).toBeDefined();
    expect((signPdfAudit!.details as any).certificateId).toBe(orgSealCert.id);
    expect((signPdfAudit!.details as any).hasLtv).toBe(true);
    expect((signPdfAudit!.details as any).padesLevel).toBe('PADES_B_LT');

    // 1.9. KIỂM CHỨNG THÔNG BÁO GỬI ĐẾN TẤT CẢ NGƯỜI THAM GIA
    const notifications = await prisma.notification.findMany({
      where: { documentId: docData.id },
    });
    const notifiedUserIds = notifications.map((n) => n.userId);

    // Phải thông báo cho người tạo hồ sơ
    expect(notifiedUserIds).toContain(creator.id);
    // Phải thông báo cho người tham gia các bước
    expect(notifiedUserIds).toContain(manager.id);
    expect(notifiedUserIds).toContain(director.id);
  });

  it('2. Thẩm định độc lập bằng verifyLtv endpoint', async () => {
    // Lấy hồ sơ vừa ký từ test 1
    const approvedDoc = await prisma.document.findFirst({
      where: { organizationId: orgAlpha.id, status: DocumentStatus.APPROVED },
    });
    expect(approvedDoc).toBeDefined();

    const ltvVerification = await pdfSigningService.verifyLtv(approvedDoc!.id, principalCreator);
    expect(ltvVerification).toBeDefined();
    expect(ltvVerification.isValid).toBe(true);
    expect(ltvVerification.signatureIntegrity).toBe(true);
    expect(ltvVerification.certificatePathValid).toBe(true);
    expect(ltvVerification.hasTimestamp).toBe(true);
    expect(ltvVerification.hasLtv).toBe(true);
    expect(ltvVerification.ltvDataPresent).toBe(true);
    expect(ltvVerification.ltvValidationStatus).toBe('VALID');
    expect(ltvVerification.padesLevel).toBe('PADES_B_LT');
    expect(ltvVerification.dssInfo?.certsCount).toBeGreaterThanOrEqual(2);
    expect(ltvVerification.dssInfo?.ocspsCount).toBeGreaterThanOrEqual(1);
  });

  it('3. Hoạt động êm thuận (Graceful fallback) khi Tổ chức chưa cấu hình chứng thư số PKI', async () => {
    // Tạo mẫu và hồ sơ cho orgNoCert
    const tplNoCert = await prisma.formTemplate.create({
      data: {
        code: `TPL_NOCERT_${Date.now()}`,
        title: 'Mẫu Đơn Không Cert',
        organizationId: orgNoCert.id,
        createdById: creatorNoCert.id,
        status: 'PUBLISHED',
        fields: [],
        layoutBlocks: [],
        defaultWorkflowSteps: [
          {
            stepOrder: 1,
            stepName: 'Phê duyệt 1 cấp duy nhất',
            stepType: 'SEQUENTIAL',
            completionRule: 'ALL_MUST_APPROVE',
            dueDays: 3,
            defaultUserIds: [approverNoCert.id],
            approverUserIds: [approverNoCert.id],
          },
        ],
      },
    });

    const tplVerNoCert = await prisma.formTemplateVersion.create({
      data: {
        templateId: tplNoCert.id,
        versionNumber: 1,
        title: 'Mẫu v1',
        fields: [{ key: 'note', label: 'Ghi chú', type: 'text', required: true, order: 1 }],
        layoutBlocks: [],
        createdById: creatorNoCert.id,
      },
    });

    const docNoCert = await orchestratorService.createDocument({
      templateId: tplNoCert.id,
      title: 'Hồ sơ thử nghiệm tổ chức chưa có PKI',
      formData: { note: 'Không có chứng thư số' },
      userId: creatorNoCert.id,
      userOrganizationId: orgNoCert.id,
      userRole: UserRole.USER,
    });

    // Nộp hồ sơ
    await orchestratorService.submitDocument({
      documentId: docNoCert.id,
      userId: creatorNoCert.id,
    });

    // Duyệt hồ sơ -> Chuyển sang APPROVED
    // Do không có cert, auto-seal trả về null nhưng transaction duyệt KHÔNG bị lỗi
    const approveResult = await orchestratorService.processAssigneeDecision({
      documentId: docNoCert.id,
      userId: approverNoCert.id,
      decision: AssigneeDecision.APPROVED,
      decisionComment: 'Duyệt thành công dù chưa cấu hình con dấu số.',
    });

    expect(approveResult.documentStatus).toBe(DocumentStatus.APPROVED);
    expect(approveResult.workflowStatus).toBe(WorkflowStatus.COMPLETED);

    // Không có tệp SIGNED_PDF artifact
    const signedArtifact = await prisma.documentArtifact.findFirst({
      where: { documentId: docNoCert.id, artifactType: ArtifactType.SIGNED_PDF },
    });
    expect(signedArtifact).toBeNull();

    // getDocumentDetail vẫn trả về đầy đủ không lỗi
    const detail = await documentReadService.getDocumentDetail(docNoCert.id, {
      id: creatorNoCert.id,
      email: creatorNoCert.email,
      fullName: creatorNoCert.fullName,
      role: UserRole.USER,
      organizationId: orgNoCert.id,
      departmentId: null,
    });
    expect(detail.status).toBe(DocumentStatus.APPROVED);
    expect(detail.signedPdfArtifact).toBeUndefined();
  });
});
