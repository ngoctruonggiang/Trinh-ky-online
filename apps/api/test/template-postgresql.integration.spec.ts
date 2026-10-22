import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, TemplateStatus, UserRole, UrgencyLevel, DocumentStatus } from '@prisma/client';
import { TemplateService } from '../src/modules/template/template.service.js';
import { WorkflowOrchestratorService } from '../src/modules/workflow/workflow-orchestrator.service.js';
import { UserPrincipal } from '../src/common/interfaces/user-principal.interface.js';

describe('Template & Form Engine Real PostgreSQL Integration Tests', () => {
  let prisma: PrismaClient;
  let templateService: TemplateService;
  let orchestrator: WorkflowOrchestratorService;

  let orgAlphaId: string;
  let orgBetaId: string;
  let adminAlpha: UserPrincipal;
  let userAlpha: UserPrincipal;
  let userBeta: UserPrincipal;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/trinh_ky_online_dev?schema=public';

    prisma = new PrismaClient();
    await prisma.$connect();
    console.log('✅ Đã kết nối PostgreSQL vật lý cho bộ Template Engine Integration Test.');

    templateService = new TemplateService(prisma);
    orchestrator = new WorkflowOrchestratorService(prisma);

    // Setup 2 tổ chức thử nghiệm
    const orgAlpha = await prisma.organization.upsert({
      where: { code: 'ORG-TEMPL-ALPHA' },
      update: {},
      create: { code: 'ORG-TEMPL-ALPHA', name: 'Công ty Alpha (Template Test)' },
    });
    orgAlphaId = orgAlpha.id;

    const orgBeta = await prisma.organization.upsert({
      where: { code: 'ORG-TEMPL-BETA' },
      update: {},
      create: { code: 'ORG-TEMPL-BETA', name: 'Công ty Beta (Template Test)' },
    });
    orgBetaId = orgBeta.id;

    // Setup Admin Alpha
    const adminUser = await prisma.user.upsert({
      where: { email: 'admin.alpha@vinagroup.vn' },
      update: { organizationId: orgAlphaId, role: UserRole.ADMIN },
      create: {
        email: 'admin.alpha@vinagroup.vn',
        passwordHash: 'hash',
        fullName: 'Admin Công ty Alpha',
        role: UserRole.ADMIN,
        organizationId: orgAlphaId,
      },
    });
    adminAlpha = {
      id: adminUser.id,
      email: adminUser.email,
      fullName: adminUser.fullName,
      role: adminUser.role,
      organizationId: orgAlphaId,
      departmentId: null,
    };

    // Setup User Alpha
    const regularUser = await prisma.user.upsert({
      where: { email: 'user.alpha.templ@vinagroup.vn' },
      update: { organizationId: orgAlphaId, role: UserRole.USER },
      create: {
        email: 'user.alpha.templ@vinagroup.vn',
        passwordHash: 'hash',
        fullName: 'Nhân viên Alpha',
        role: UserRole.USER,
        organizationId: orgAlphaId,
      },
    });
    userAlpha = {
      id: regularUser.id,
      email: regularUser.email,
      fullName: regularUser.fullName,
      role: regularUser.role,
      organizationId: orgAlphaId,
      departmentId: null,
    };

    // Setup User Beta
    const betaUser = await prisma.user.upsert({
      where: { email: 'user.beta.templ@vinagroup.vn' },
      update: { organizationId: orgBetaId, role: UserRole.USER },
      create: {
        email: 'user.beta.templ@vinagroup.vn',
        passwordHash: 'hash',
        fullName: 'Nhân viên Beta',
        role: UserRole.USER,
        organizationId: orgBetaId,
      },
    });
    userBeta = {
      id: betaUser.id,
      email: betaUser.email,
      fullName: betaUser.fullName,
      role: betaUser.role,
      organizationId: orgBetaId,
      departmentId: null,
    };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  let createdTemplateId: string;
  let version1Id: string;
  let createdDocumentId: string;

  it('1. ADMIN tạo template mới ở trạng thái DRAFT v1 trên PostgreSQL', async () => {
    const res = await templateService.createTemplate(
      {
        code: `TAM_UNG_INT_${Date.now()}`,
        title: 'Giấy đề nghị tạm ứng kinh phí công tác',
        category: 'Tài chính - Kế toán',
        description: 'Biểu mẫu xin tạm ứng trước khi đi công tác',
        fields: [
          {
            id: 'f1',
            key: 'so_tien',
            label: 'Số tiền tạm ứng',
            type: 'number',
            required: true,
            order: 1,
            validation: { min: 100000, max: 20000000 },
          },
          {
            id: 'f2',
            key: 'ly_do',
            label: 'Lý do chi tiết',
            type: 'textarea',
            required: true,
            order: 2,
          },
          {
            id: 'f3',
            key: 'phuong_tien',
            label: 'Phương tiện di chuyển',
            type: 'select',
            required: false,
            order: 3,
            options: [
              { label: 'Máy bay', value: 'MAY_BAY' },
              { label: 'Tàu hỏa', value: 'TAU_HOA' },
              { label: 'Xe công ty', value: 'XE_CONG_TY' },
            ],
          },
        ],
        defaultWorkflowSteps: [
          {
            stepOrder: 1,
            stepName: 'Trưởng phòng phê duyệt',
            stepType: 'SEQUENTIAL',
            completionRule: 'ALL_MUST_APPROVE',
            defaultUserIds: [adminAlpha.id],
          },
        ],
      },
      adminAlpha
    );

    expect(res.success).toBe(true);
    expect(res.data.status).toBe(TemplateStatus.DRAFT);
    expect(res.data.currentVersion).toBe(1);
    createdTemplateId = res.data.id;

    // Xác minh trong DB thật
    const dbRecord = await prisma.formTemplate.findUnique({
      where: { id: createdTemplateId },
    });
    expect(dbRecord).not.toBeNull();
    expect(dbRecord?.organizationId).toBe(orgAlphaId);
    expect(dbRecord?.status).toBe(TemplateStatus.DRAFT);
  });

  it('2. ADMIN chỉnh sửa template DRAFT trên PostgreSQL', async () => {
    const res = await templateService.updateTemplate(
      createdTemplateId,
      {
        title: 'Giấy đề nghị tạm ứng kinh phí công tác (Cập nhật)',
      },
      adminAlpha
    );

    expect(res.success).toBe(true);
    expect(res.data.title).toContain('(Cập nhật)');

    const dbRecord = await prisma.formTemplate.findUnique({
      where: { id: createdTemplateId },
    });
    expect(dbRecord?.title).toContain('(Cập nhật)');
  });

  it('3. ADMIN phát hành template (DRAFT -> PUBLISHED), sinh FormTemplateVersion v1', async () => {
    const res = await templateService.publishTemplate(
      createdTemplateId,
      { changeSummary: 'Phát hành chính thức phiên bản v1' },
      adminAlpha
    );

    expect(res.success).toBe(true);
    expect(res.data.status).toBe(TemplateStatus.PUBLISHED);
    expect(res.data.versionNumber).toBe(1);
    version1Id = res.data.versionId;

    // Kiểm tra bảng form_template_versions trong DB thật
    const versionRecord = await prisma.formTemplateVersion.findUnique({
      where: { id: version1Id },
    });
    expect(versionRecord).not.toBeNull();
    expect(versionRecord?.versionNumber).toBe(1);
    expect(versionRecord?.templateId).toBe(createdTemplateId);
  });

  it('4. User Alpha tạo hồ sơ DRAFT từ template v1 vừa phát hành', async () => {
    const docRes = await orchestrator.createDocument({
      templateId: createdTemplateId,
      title: 'Đề nghị tạm ứng công tác Đà Nẵng tháng 11',
      urgency: UrgencyLevel.NORMAL,
      formData: {
        so_tien: 5000000,
        ly_do: 'Tham gia hội thảo công nghệ thông tin tại Đà Nẵng 3 ngày',
        phuong_tien: 'MAY_BAY',
      },
      userId: userAlpha.id,
      userOrganizationId: orgAlphaId,
      userRole: 'USER',
    });

    expect(docRes.id).toBeDefined();
    expect(docRes.status).toBe(DocumentStatus.DRAFT);
    expect(docRes.templateVersionId).toBe(version1Id);
    expect(docRes.templateVersionNumber).toBe(1);
    createdDocumentId = docRes.id;

    // Kiểm tra DocumentVersion v1 và mã băm SHA-256
    const docInDb = await prisma.document.findUnique({
      where: { id: createdDocumentId },
      include: {
        versions: true,
        workflow: { include: { steps: { include: { assignees: true } } } },
      },
    });
    expect(docInDb).not.toBeNull();
    expect(docInDb?.versions[0].versionNumber).toBe(1);
    expect(docInDb?.versions[0].formData).toMatchObject({ so_tien: 5000000 });
    expect(docInDb?.versions[0].sha256Hash).toHaveLength(64);
    expect(docInDb?.workflow?.steps).toHaveLength(1);
    expect(docInDb?.workflow?.steps[0].assignees[0].userId).toBe(adminAlpha.id);
  });

  it('5. ADMIN phát hành phiên bản mới v2 cho template, bảo toàn phiên bản v1', async () => {
    const res = await templateService.publishTemplate(
      createdTemplateId,
      { changeSummary: 'Nâng cấp chính sách công tác phí lên phiên bản v2' },
      adminAlpha
    );

    expect(res.success).toBe(true);
    expect(res.data.versionNumber).toBe(2);

    // Kiểm tra cả 2 phiên bản đều tồn tại độc lập trong DB thật
    const versions = await prisma.formTemplateVersion.findMany({
      where: { templateId: createdTemplateId },
      orderBy: { versionNumber: 'asc' },
    });
    expect(versions).toHaveLength(2);
    expect(versions[0].versionNumber).toBe(1);
    expect(versions[1].versionNumber).toBe(2);

    // Kiểm tra hồ sơ đã tạo ở test 4 vẫn giữ nguyên liên kết tới version 1
    const historicalDoc = await prisma.document.findUnique({
      where: { id: createdDocumentId },
      select: { templateVersionId: true },
    });
    expect(historicalDoc?.templateVersionId).toBe(version1Id);
  });

  it('6. Bảo mật đa tổ chức: Chặn User công ty Beta tạo hồ sơ từ template của công ty Alpha', async () => {
    await expect(
      orchestrator.createDocument({
        templateId: createdTemplateId,
        title: 'Tạo hồ sơ trái phép',
        formData: { so_tien: 1000000, ly_do: 'Test' },
        userId: userBeta.id,
        userOrganizationId: orgBetaId,
        userRole: 'USER',
      })
    ).rejects.toThrow();
  });

  it('7. Lưu trữ template (ARCHIVED) và chặn tạo hồ sơ mới từ template đã lưu trữ', async () => {
    const archiveRes = await templateService.archiveTemplate(createdTemplateId, adminAlpha);
    expect(archiveRes.success).toBe(true);
    expect(archiveRes.data.status).toBe(TemplateStatus.ARCHIVED);

    // Thử tạo hồ sơ từ template ARCHIVED -> bị chặn
    await expect(
      orchestrator.createDocument({
        templateId: createdTemplateId,
        title: 'Tạo hồ sơ từ template lưu trữ',
        formData: { so_tien: 1000000, ly_do: 'Test' },
        userId: userAlpha.id,
        userOrganizationId: orgAlphaId,
        userRole: 'USER',
      })
    ).rejects.toThrow();
  });
});
