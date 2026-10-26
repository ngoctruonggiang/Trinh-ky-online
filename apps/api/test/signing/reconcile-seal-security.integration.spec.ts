import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as crypto from 'crypto';
import { PrismaClient, UserRole } from '@prisma/client';
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  ArtifactStatus,
  ArtifactType,
  AuditAction,
  CertificateStatus,
  DocumentStatus,
  KeyStorageType,
  WorkflowStatus,
} from '@trinh-ky/shared';
import { UserPrincipal } from '../../src/common/interfaces/user-principal.interface.js';
import { StorageService } from '../../src/modules/artifact/storage/storage.service.js';
import { PdfGeneratorService } from '../../src/modules/artifact/pdf-generator.service.js';
import { ArtifactService } from '../../src/modules/artifact/artifact.service.js';
import { DevLocalKeystoreProvider } from '../../src/modules/signing/providers/dev-local-keystore.provider.js';
import { DevKeystoreGenerator } from '../../src/modules/signing/dev-keystore-generator.js';
import { PdfSigningService } from '../../src/modules/signing/engine/pdf-signing.service.js';
import { TimestampService } from '../../src/modules/signing/timestamp/timestamp.service.js';
import { RevocationService } from '../../src/modules/signing/revocation/revocation.service.js';
import { PdfDssService } from '../../src/modules/signing/dss/pdf-dss.service.js';
import { WorkflowOrchestratorService } from '../../src/modules/workflow/workflow-orchestrator.service.js';
import { DelegationService } from '../../src/modules/delegation/delegation.service.js';

describe('Hạng mục C: Reconcile-Seal Security, Idempotency & Fault Recovery (PostgreSQL Integration)', () => {
  let prisma: PrismaClient;
  let storageService: StorageService;
  let pdfGenerator: PdfGeneratorService;
  let artifactService: ArtifactService;
  let keystoreProvider: DevLocalKeystoreProvider;
  let timestampService: TimestampService;
  let revocationService: RevocationService;
  let pdfDssService: PdfDssService;
  let pdfSigningService: PdfSigningService;
  let orchestratorService: WorkflowOrchestratorService;

  let orgA: any;
  let orgB: any;
  let creatorA: any;
  let adminA: any;
  let userA2: any;
  let userB: any;

  let principalCreatorA: UserPrincipal;
  let principalAdminA: UserPrincipal;
  let principalUserA2: UserPrincipal;
  let principalUserB: UserPrincipal;

  let orgSealCertA: any;
  let templateA: any;
  let templateVersionA: any;

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
    const delegationService = new DelegationService(prisma as any);
    orchestratorService = new WorkflowOrchestratorService(
      prisma as any,
      delegationService,
      pdfSigningService
    );

    // 1. Tổ chức A và Tổ chức B
    const uniqueSuffix = Date.now();
    orgA = await prisma.organization.create({
      data: {
        code: `ORG_RECON_A_${uniqueSuffix}`,
        name: 'Tập đoàn A Bảo Mật',
      },
    });

    orgB = await prisma.organization.create({
      data: {
        code: `ORG_RECON_B_${uniqueSuffix}`,
        name: 'Công ty B Đối tác',
      },
    });

    // 2. Người dùng thuộc tổ chức A
    creatorA = await prisma.user.create({
      data: {
        email: `creator_a_${uniqueSuffix}@reconcile.local`,
        passwordHash: 'dummy-hash',
        fullName: 'Nguyễn Văn Tác Giả A',
        role: UserRole.USER,
        organizationId: orgA.id,
      },
    });

    adminA = await prisma.user.create({
      data: {
        email: `admin_a_${uniqueSuffix}@reconcile.local`,
        passwordHash: 'dummy-hash',
        fullName: 'Trần Quản Trị A',
        role: UserRole.ADMIN,
        organizationId: orgA.id,
      },
    });

    userA2 = await prisma.user.create({
      data: {
        email: `user_a2_${uniqueSuffix}@reconcile.local`,
        passwordHash: 'dummy-hash',
        fullName: 'Lê Nhân Viên A2 (Không có quyền)',
        role: UserRole.USER,
        organizationId: orgA.id,
      },
    });

    // 3. Người dùng thuộc tổ chức B
    userB = await prisma.user.create({
      data: {
        email: `user_b_${uniqueSuffix}@reconcile.local`,
        passwordHash: 'dummy-hash',
        fullName: 'Phạm Người Dùng B (Khác Tenant)',
        role: UserRole.USER,
        organizationId: orgB.id,
      },
    });

    principalCreatorA = {
      id: creatorA.id,
      email: creatorA.email,
      fullName: creatorA.fullName,
      role: UserRole.USER,
      organizationId: orgA.id,
      departmentId: null,
    };

    principalAdminA = {
      id: adminA.id,
      email: adminA.email,
      fullName: adminA.fullName,
      role: UserRole.ADMIN,
      organizationId: orgA.id,
      departmentId: null,
    };

    principalUserA2 = {
      id: userA2.id,
      email: userA2.email,
      fullName: userA2.fullName,
      role: UserRole.USER,
      organizationId: orgA.id,
      departmentId: null,
    };

    principalUserB = {
      id: userB.id,
      email: userB.email,
      fullName: userB.fullName,
      role: UserRole.USER,
      organizationId: orgB.id,
      departmentId: null,
    };

    // 4. Tạo chứng thư số niêm phong cho Org A
    const sealAlias = `org_recon_seal_${uniqueSuffix}`;
    const keystore = DevKeystoreGenerator.generateSelfSignedKeystore({
      commonName: 'Con Dau Niem Phong Reconcile Test A',
      organizationName: orgA.name,
      passphrase: 'OrgSealPass2026!',
    });
    keystoreProvider.importKeystore(sealAlias, keystore.p12Buffer, 'OrgSealPass2026!');

    orgSealCertA = await prisma.digitalCertificate.create({
      data: {
        organizationId: orgA.id,
        userId: null,
        keyAlias: sealAlias,
        keyStorageType: KeyStorageType.DEV_KEYSTORE,
        subjectDn: keystore.subjectDn,
        issuerDn: keystore.issuerDn,
        serialNumber: keystore.serialNumber,
        fingerprintSha256: keystore.fingerprintSha256,
        certificatePem: keystore.certificatePem,
        validFrom: keystore.validFrom,
        validTo: keystore.validTo,
        status: CertificateStatus.ACTIVE,
      },
    });

    // 5. Tạo biểu mẫu mẫu
    templateA = await prisma.formTemplate.create({
      data: {
        code: `TPL_RECON_${uniqueSuffix}`,
        title: 'Mẫu kiểm thử Reconcile Seal',
        organizationId: orgA.id,
        createdById: creatorA.id,
        status: 'PUBLISHED',
        fields: [{ key: 'content', label: 'Nội dung', type: 'text', required: true, order: 1 }],
        layoutBlocks: [],
      },
    });

    templateVersionA = await prisma.formTemplateVersion.create({
      data: {
        templateId: templateA.id,
        versionNumber: 1,
        title: 'Mẫu Reconcile v1',
        fields: [{ key: 'content', label: 'Nội dung', type: 'text', required: true, order: 1 }],
        layoutBlocks: [],
        createdById: creatorA.id,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /**
   * Helper tạo hồ sơ đã hoàn tất phê duyệt (APPROVED) và COMPLETED workflow
   */
  async function createApprovedDocument(formData: any = { content: 'Báo cáo quyết toán' }): Promise<any> {
    const rawJson = JSON.stringify(formData);
    const contentHash = crypto.createHash('sha256').update(rawJson).digest('hex');

    const doc = await prisma.document.create({
      data: {
        title: `Hồ sơ Reconcile Test ${Date.now()}`,
        documentNumber: `DOC-REC-${Date.now()}`,
        status: DocumentStatus.APPROVED,
        templateId: templateA.id,
        templateVersionId: templateVersionA.id,
        organizationId: orgA.id,
        createdById: creatorA.id,
        currentVersion: 1,
        versions: {
          create: {
            versionNumber: 1,
            formData,
            sha256Hash: contentHash,
            createdById: creatorA.id,
          },
        },
        workflow: {
          create: {
            status: WorkflowStatus.COMPLETED,
            completedAt: new Date(),
          },
        },
      },
      include: {
        versions: true,
        workflow: true,
      },
    });

    return doc;
  }

  it('1. Chặn người dùng không có quyền (User thông thường không phải tác giả và không phải Admin)', async () => {
    const doc = await createApprovedDocument();

    await expect(
      orchestratorService.reconcileUnsealedApprovedDocument(doc.id, principalUserA2)
    ).rejects.toThrow(ForbiddenException);
  });

  it('2. Chặn người dùng thuộc tổ chức khác (Cross-Tenant Isolation)', async () => {
    const doc = await createApprovedDocument();

    await expect(
      orchestratorService.reconcileUnsealedApprovedDocument(doc.id, principalUserB)
    ).rejects.toThrow(ForbiddenException);
  });

  it('3. Chặn hồ sơ chưa ở trạng thái APPROVED (DocumentStatus !== APPROVED)', async () => {
    const rawJson = JSON.stringify({ content: 'Chưa duyệt' });
    const contentHash = crypto.createHash('sha256').update(rawJson).digest('hex');

    const draftDoc = await prisma.document.create({
      data: {
        title: 'Hồ sơ còn đang soạn thảo',
        documentNumber: `DOC-DRAFT-${Date.now()}`,
        status: DocumentStatus.SUBMITTED,
        templateId: templateA.id,
        organizationId: orgA.id,
        createdById: creatorA.id,
        currentVersion: 1,
        versions: {
          create: {
            versionNumber: 1,
            formData: { content: 'Chưa duyệt' },
            sha256Hash: contentHash,
            createdById: creatorA.id,
          },
        },
        workflow: {
          create: {
            status: WorkflowStatus.IN_PROGRESS,
          },
        },
      },
    });

    await expect(
      orchestratorService.reconcileUnsealedApprovedDocument(draftDoc.id, principalCreatorA)
    ).rejects.toThrow(BadRequestException);
  });

  it('4. Chặn khi nội dung formData bị sửa đổi khác với bản băm toàn vẹn đã phê duyệt (Tamper Detection)', async () => {
    const doc = await createApprovedDocument();
    const version = doc.versions[0];

    // Cố tình làm sai lệch formData trong CSDL mà không cập nhật sha256Hash
    await prisma.documentVersion.update({
      where: { id: version.id },
      data: {
        formData: { content: 'Nội dung bị sửa đổi lén sau khi phê duyệt' },
      },
    });

    await expect(
      orchestratorService.reconcileUnsealedApprovedDocument(doc.id, principalCreatorA)
    ).rejects.toThrow(BadRequestException);
  });

  it('5. Tác giả hoặc Company Admin reconcile thành công hồ sơ APPROVED hợp lệ', async () => {
    const doc = await createApprovedDocument({ content: 'Nội dung hợp lệ 100%' });

    // Admin công ty thực hiện Reconcile
    const result = await orchestratorService.reconcileUnsealedApprovedDocument(
      doc.id,
      principalAdminA,
      { ipAddress: '127.0.0.1' }
    );

    expect(result).toBeDefined();
    expect(result.status).toBe(ArtifactStatus.COMPLETED);
    expect(result.hasLtv).toBe(true);
    expect(result.padesLevel).toBe('PADES_B_LT');

    // Kiểm tra Audit Log được ghi nhận
    const audit = await prisma.auditLog.findFirst({
      where: { documentId: doc.id, action: AuditAction.DOCUMENT_RECONCILE_SEAL },
    });
    expect(audit).toBeDefined();
    expect(audit!.userId).toBe(adminA.id);
  });

  it('6. Tính Idempotent: Gửi request Reconcile nhiều lần không tạo chữ ký lặp', async () => {
    const doc = await createApprovedDocument({ content: 'Idempotency Test' });

    // Lần 1
    const res1 = await orchestratorService.reconcileUnsealedApprovedDocument(
      doc.id,
      principalCreatorA
    );

    // Lần 2
    const res2 = await orchestratorService.reconcileUnsealedApprovedDocument(
      doc.id,
      principalCreatorA
    );

    expect(res1.artifactId).toBe(res2.artifactId);
    expect(res1.signedPdfHash).toBe(res2.signedPdfHash);

    // Chỉ có 1 bản ghi SIGNED_PDF duy nhất
    const artifactCount = await prisma.documentArtifact.count({
      where: { documentId: doc.id, artifactType: ArtifactType.SIGNED_PDF },
    });
    expect(artifactCount).toBe(1);
  });

  it('7. Concurrency: Gửi 2 request Reconcile đồng thời được tuần tự hóa an toàn', async () => {
    const doc = await createApprovedDocument({ content: 'Concurrent Reconcile Test' });

    // Gọi đồng thời 2 Promise
    const [res1, res2] = await Promise.all([
      orchestratorService.reconcileUnsealedApprovedDocument(doc.id, principalCreatorA),
      orchestratorService.reconcileUnsealedApprovedDocument(doc.id, principalAdminA),
    ]);

    expect(res1).toBeDefined();
    expect(res2).toBeDefined();
    expect(res1.artifactId).toBe(res2.artifactId);

    // Đảm bảo không bị nhân đôi artifact trong CSDL
    const artifactCount = await prisma.documentArtifact.count({
      where: { documentId: doc.id, artifactType: ArtifactType.SIGNED_PDF },
    });
    expect(artifactCount).toBe(1);
  });

  it('8. Phục hồi khi bản ghi CSDL tồn tại nhưng tệp Storage bị mất (Physical File Loss Recovery)', async () => {
    const doc = await createApprovedDocument({ content: 'Storage Loss Recovery Test' });

    // Ký lần đầu
    const initialResult = await orchestratorService.reconcileUnsealedApprovedDocument(
      doc.id,
      principalCreatorA
    );
    expect(initialResult).toBeDefined();

    const artifact = await prisma.documentArtifact.findFirst({
      where: { documentId: doc.id, artifactType: ArtifactType.SIGNED_PDF },
    });
    expect(artifact).toBeDefined();

    // Giả lập tệp vật lý bị mất trên storage bằng cách xóa tệp thực tế
    if (artifact!.storageKey) {
      await storageService.delete(artifact!.storageKey);
      expect(await storageService.exists(artifact!.storageKey)).toBe(false);
    }

    // Reconcile lần 2: Hệ thống phát hiện tệp vật lý bị mất và tự động tái ký phục hồi
    const recoveredResult = await orchestratorService.reconcileUnsealedApprovedDocument(
      doc.id,
      principalCreatorA
    );

    expect(recoveredResult).toBeDefined();
    expect(recoveredResult.status).toBe(ArtifactStatus.COMPLETED);

    // Kiểm tra tệp vật lý mới đã được khôi phục trên storage
    const updatedArtifact = await prisma.documentArtifact.findFirst({
      where: { documentId: doc.id, artifactType: ArtifactType.SIGNED_PDF },
    });
    expect(updatedArtifact!.storageKey).toBeDefined();
    expect(await storageService.exists(updatedArtifact!.storageKey!)).toBe(true);
  });

  it('9. Fail-Closed khi khóa ký không khả dụng trong Provider', async () => {
    // Tạm vô hiệu hóa con dấu hợp lệ của tổ chức
    await prisma.digitalCertificate.update({
      where: { id: orgSealCertA.id },
      data: { status: CertificateStatus.REVOKED },
    });

    const doc = await createApprovedDocument({ content: 'Key Unavailable Test' });

    await expect(
      orchestratorService.reconcileUnsealedApprovedDocument(doc.id, principalCreatorA)
    ).rejects.toThrow(InternalServerErrorException);

    // Phục hồi lại trạng thái con dấu
    await prisma.digitalCertificate.update({
      where: { id: orgSealCertA.id },
      data: { status: CertificateStatus.ACTIVE },
    });
  });
});
