import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, TemplateStatus, UserRole, UrgencyLevel, DocumentStatus } from '@prisma/client';
import { WorkflowTemplateService } from '../src/modules/workflow-template/workflow-template.service.js';
import { WorkflowOrchestratorService } from '../src/modules/workflow/workflow-orchestrator.service.js';
import { TemplateService } from '../src/modules/template/template.service.js';
import { UserPrincipal } from '../src/common/interfaces/user-principal.interface.js';
import { WorkflowStepConfig } from '@trinh-ky/shared';

describe('Workflow Builder & Versioned Approval Engine Real PostgreSQL Integration Tests', () => {
  let prisma: PrismaClient;
  let workflowService: WorkflowTemplateService;
  let templateService: TemplateService;
  let orchestrator: WorkflowOrchestratorService;

  let orgAlphaId: string;
  let orgBetaId: string;
  let deptItId: string;
  let deptEmptyId: string;

  let adminAlpha: UserPrincipal;
  let adminBeta: UserPrincipal;
  let managerUser: any;
  let directorUser: any;
  let accountantUser: any;
  let inactiveUser: any;
  let submitterUser: UserPrincipal;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/trinh_ky_online_dev?schema=public';

    prisma = new PrismaClient();
    await prisma.$connect();
    console.log('✅ Đã kết nối PostgreSQL vật lý cho bộ Workflow Builder Integration Test.');

    workflowService = new WorkflowTemplateService(prisma);
    templateService = new TemplateService(prisma);
    orchestrator = new WorkflowOrchestratorService(prisma);

    // 1. Tạo tổ chức thử nghiệm
    const orgAlpha = await prisma.organization.upsert({
      where: { code: 'ORG-WF-ALPHA' },
      update: {},
      create: { code: 'ORG-WF-ALPHA', name: 'Công ty Alpha (Workflow Test)' },
    });
    orgAlphaId = orgAlpha.id;

    const orgBeta = await prisma.organization.upsert({
      where: { code: 'ORG-WF-BETA' },
      update: {},
      create: { code: 'ORG-WF-BETA', name: 'Công ty Beta (Workflow Test)' },
    });
    orgBetaId = orgBeta.id;

    // 2. Tạo phòng ban thử nghiệm
    const deptIt = await prisma.department.upsert({
      where: { organizationId_code: { organizationId: orgAlphaId, code: 'IT' } },
      update: {},
      create: { organizationId: orgAlphaId, code: 'IT', name: 'Phòng Công nghệ' },
    });
    deptItId = deptIt.id;

    const deptEmpty = await prisma.department.upsert({
      where: { organizationId_code: { organizationId: orgAlphaId, code: 'EMPTY_DEPT' } },
      update: {},
      create: { organizationId: orgAlphaId, code: 'EMPTY_DEPT', name: 'Phòng ban chưa có nhân sự' },
    });
    deptEmptyId = deptEmpty.id;

    // 3. Setup các người dùng cho bài test
    const adminUser = await prisma.user.upsert({
      where: { email: 'admin.wf@vinagroup.vn' },
      update: { organizationId: orgAlphaId, role: UserRole.ADMIN, isActive: true },
      create: {
        email: 'admin.wf@vinagroup.vn',
        passwordHash: 'hash',
        fullName: 'Admin Alpha Workflow',
        role: UserRole.ADMIN,
        organizationId: orgAlphaId,
        isActive: true,
      },
    });
    adminAlpha = {
      id: adminUser.id,
      email: adminUser.email,
      fullName: adminUser.fullName,
      role: adminUser.role,
      organizationId: adminUser.organizationId,
      departmentId: adminUser.departmentId,
    };

    const adminBetaUser = await prisma.user.upsert({
      where: { email: 'admin.beta.wf@vinagroup.vn' },
      update: { organizationId: orgBetaId, role: UserRole.ADMIN, isActive: true },
      create: {
        email: 'admin.beta.wf@vinagroup.vn',
        passwordHash: 'hash',
        fullName: 'Admin Beta Workflow',
        role: UserRole.ADMIN,
        organizationId: orgBetaId,
        isActive: true,
      },
    });
    adminBeta = {
      id: adminBetaUser.id,
      email: adminBetaUser.email,
      fullName: adminBetaUser.fullName,
      role: adminBetaUser.role,
      organizationId: adminBetaUser.organizationId,
      departmentId: adminBetaUser.departmentId,
    };

    managerUser = await prisma.user.upsert({
      where: { email: 'manager.it.wf@vinagroup.vn' },
      update: {
        organizationId: orgAlphaId,
        departmentId: deptItId,
        positionTitle: 'Trưởng phòng Công nghệ',
        role: UserRole.USER,
        isActive: true,
      },
      create: {
        email: 'manager.it.wf@vinagroup.vn',
        passwordHash: 'hash',
        fullName: 'Trưởng phòng IT',
        positionTitle: 'Trưởng phòng Công nghệ',
        role: UserRole.USER,
        organizationId: orgAlphaId,
        departmentId: deptItId,
        isActive: true,
      },
    });

    directorUser = await prisma.user.upsert({
      where: { email: 'director.wf@vinagroup.vn' },
      update: {
        organizationId: orgAlphaId,
        positionTitle: 'Giám đốc Điều hành',
        role: UserRole.USER,
        isActive: true,
      },
      create: {
        email: 'director.wf@vinagroup.vn',
        passwordHash: 'hash',
        fullName: 'Giám đốc Điều hành',
        positionTitle: 'Giám đốc Điều hành',
        role: UserRole.USER,
        organizationId: orgAlphaId,
        isActive: true,
      },
    });

    accountantUser = await prisma.user.upsert({
      where: { email: 'accountant.wf@vinagroup.vn' },
      update: {
        organizationId: orgAlphaId,
        positionTitle: 'Kế toán trưởng',
        role: UserRole.USER,
        isActive: true,
      },
      create: {
        email: 'accountant.wf@vinagroup.vn',
        passwordHash: 'hash',
        fullName: 'Kế toán trưởng',
        positionTitle: 'Kế toán trưởng',
        role: UserRole.USER,
        organizationId: orgAlphaId,
        isActive: true,
      },
    });

    inactiveUser = await prisma.user.upsert({
      where: { email: 'inactive.wf@vinagroup.vn' },
      update: {
        organizationId: orgAlphaId,
        isActive: false,
      },
      create: {
        email: 'inactive.wf@vinagroup.vn',
        passwordHash: 'hash',
        fullName: 'Nhân viên vô hiệu hóa',
        role: UserRole.USER,
        organizationId: orgAlphaId,
        isActive: false,
      },
    });

    const submitter = await prisma.user.upsert({
      where: { email: 'submitter.wf@vinagroup.vn' },
      update: {
        organizationId: orgAlphaId,
        departmentId: deptItId,
        role: UserRole.USER,
        isActive: true,
      },
      create: {
        email: 'submitter.wf@vinagroup.vn',
        passwordHash: 'hash',
        fullName: 'Chuyên viên lập trình',
        role: UserRole.USER,
        organizationId: orgAlphaId,
        departmentId: deptItId,
        isActive: true,
      },
    });
    submitterUser = {
      id: submitter.id,
      email: submitter.email,
      fullName: submitter.fullName,
      role: submitter.role,
      organizationId: submitter.organizationId,
      departmentId: submitter.departmentId,
    };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('1. Vòng đời quy trình & Quản lý phiên bản bất biến (Version Lifecycle)', () => {
    let workflowId: string;
    let v1Id: string;
    let v2Id: string;

    const v1Steps: WorkflowStepConfig[] = [
      {
        stepKey: 'step_mgr',
        stepName: 'Trưởng phòng duyệt ban đầu',
        stepOrder: 1,
        stepType: 'SEQUENTIAL',
        completionRule: 'ALL_MUST_APPROVE',
        approverConfig: {
          type: 'DEPARTMENT_ROLE',
          role: 'MANAGER',
          departmentPolicy: 'SAME_AS_DOCUMENT',
        },
        reviewerUserIds: [],
      },
    ];

    it('1.1 Tạo quy trình bản nháp DRAFT thành công trong PostgreSQL', async () => {
      const code = `WF_LC_${Date.now()}`;
      const res = await workflowService.createWorkflowTemplate(
        {
          code,
          title: 'Quy trình thử nghiệm vòng đời',
          description: 'Mô tả thử nghiệm',
          category: 'Vận hành',
          steps: v1Steps,
        },
        adminAlpha,
      );

      expect(res.success).toBe(true);
      expect(res.data.status).toBe(TemplateStatus.DRAFT);
      workflowId = res.data.id;

      const inDb = await prisma.workflowTemplate.findUnique({ where: { id: workflowId } });
      expect(inDb).not.toBeNull();
      expect(inDb?.code).toBe(code);
    });

    it('1.2 Chỉnh sửa bản nháp DRAFT trước khi phát hành', async () => {
      const updated = await workflowService.updateWorkflowTemplate(
        workflowId,
        {
          title: 'Quy trình thử nghiệm vòng đời (Đã sửa)',
        },
        adminAlpha,
      );

      expect(updated.data.title).toBe('Quy trình thử nghiệm vòng đời (Đã sửa)');
    });

    it('1.3 Phát hành phiên bản v1 chính thức và kiểm tra Snapshot bất biến', async () => {
      const pubRes = await workflowService.publishWorkflowTemplate(
        workflowId,
        { releaseNotes: 'Phát hành bản v1' },
        adminAlpha,
      );

      expect(pubRes.data.versionNumber).toBe(1);
      v1Id = pubRes.data.versionId;

      const v1Snapshot = await prisma.workflowTemplateVersion.findUnique({
        where: { id: v1Id },
      });
      expect(v1Snapshot).not.toBeNull();
      expect(v1Snapshot?.status).toBe(TemplateStatus.PUBLISHED);

      const parentWf = await prisma.workflowTemplate.findUnique({ where: { id: workflowId } });
      expect(parentWf?.status).toBe(TemplateStatus.PUBLISHED);
      expect(parentWf?.currentVersion).toBe(1);
    });

    it('1.4 Tạo bản nháp cho phiên bản tiếp theo (v2)', async () => {
      const draftRes = await workflowService.createDraftVersion(workflowId, adminAlpha);
      expect(draftRes.success).toBe(true);
      expect(draftRes.data.versionNumber).toBe(2);
      expect(draftRes.data.status).toBe(TemplateStatus.DRAFT);
    });

    it('1.5 Chỉnh sửa bản nháp v2 (bổ sung bước 2 Giám đốc)', async () => {
      const v2Steps: WorkflowStepConfig[] = [
        ...v1Steps,
        {
          stepKey: 'step_dir',
          stepName: 'Giám đốc phê duyệt cấp 2',
          stepOrder: 2,
          stepType: 'SEQUENTIAL',
          completionRule: 'ANY_CAN_APPROVE',
          approverConfig: {
            type: 'ORGANIZATION_ROLE',
            role: 'DIRECTOR',
          },
          reviewerUserIds: [],
        },
      ];

      const updateRes = await workflowService.updateDraftVersion(
        workflowId,
        {
          title: 'Quy trình thử nghiệm vòng đời (v2 nâng cấp)',
          steps: v2Steps,
          changeSummary: 'Thêm bước giám đốc',
        },
        adminAlpha,
      );

      expect(updateRes.data.versionNumber).toBe(2);
    });

    it('1.6 Phát hành phiên bản v2 chính thức', async () => {
      const pubV2Res = await workflowService.publishWorkflowTemplate(
        workflowId,
        { releaseNotes: 'Phát hành chính thức v2' },
        adminAlpha,
      );

      expect(pubV2Res.data.versionNumber).toBe(2);
      v2Id = pubV2Res.data.versionId;

      // Xác minh v1 snapshot KHÔNG bị thay đổi
      const v1After = await prisma.workflowTemplateVersion.findUnique({ where: { id: v1Id } });
      const v1StepsInDb = v1After?.steps as any[];
      expect(v1StepsInDb.length).toBe(1);

      // Xác minh v2 snapshot có 2 bước
      const v2After = await prisma.workflowTemplateVersion.findUnique({ where: { id: v2Id } });
      const v2StepsInDb = v2After?.steps as any[];
      expect(v2StepsInDb.length).toBe(2);

      // Xác minh parent currentVersion = 2
      const parentAfter = await prisma.workflowTemplate.findUnique({ where: { id: workflowId } });
      expect(parentAfter?.currentVersion).toBe(2);
    });

    it('1.7 Tạo bản nháp v3 và Hủy bỏ (discardDraftVersion) an toàn', async () => {
      const draftV3 = await workflowService.createDraftVersion(workflowId, adminAlpha);
      expect(draftV3.data.versionNumber).toBe(3);

      const discardRes = await workflowService.discardDraftVersion(workflowId, adminAlpha);
      expect(discardRes.success).toBe(true);

      // v2 vẫn là currentVersion và còn nguyên trong DB
      const parent = await prisma.workflowTemplate.findUnique({ where: { id: workflowId } });
      expect(parent?.currentVersion).toBe(2);

      const v3Check = await prisma.workflowTemplateVersion.findFirst({
        where: { workflowTemplateId: workflowId, versionNumber: 3 },
      });
      expect(v3Check).toBeNull();
    });
  });

  describe('2. Approver Resolution Engine & Thực thi tạo hồ sơ (Runtime Execution)', () => {
    let formTemplateId: string;
    let workflowVersionId: string;

    beforeAll(async () => {
      // Tạo FormTemplate hợp lệ
      const ftRes = await templateService.createTemplate(
        {
          code: `FT_TEST_${Date.now()}`,
          title: 'Mẫu kiểm thử Approver Resolution',
          fields: [
            {
              id: 'f_test',
              key: 'noi_dung',
              label: 'Nội dung tờ trình',
              type: 'text',
              required: true,
              order: 1,
            },
          ],
        },
        adminAlpha,
      );
      formTemplateId = ftRes.data.id;
      await templateService.publishTemplate(formTemplateId, { releaseNotes: 'v1' }, adminAlpha);

      // Tạo WorkflowTemplate với cả 3 loại cấu hình người duyệt:
      // Bước 1: DEPARTMENT_ROLE ('MANAGER')
      // Bước 2: ORGANIZATION_ROLE ('DIRECTOR')
      // Bước 3: SPECIFIC_USERS ([accountantUser.id])
      const wfSteps: WorkflowStepConfig[] = [
        {
          stepKey: 's1_dept_mgr',
          stepName: 'Bước 1: Trưởng phòng phê duyệt',
          stepOrder: 1,
          stepType: 'SEQUENTIAL',
          completionRule: 'ALL_MUST_APPROVE',
          approverConfig: {
            type: 'DEPARTMENT_ROLE',
            role: 'MANAGER',
            departmentPolicy: 'SAME_AS_DOCUMENT',
          },
          reviewerUserIds: [],
        },
        {
          stepKey: 's2_org_dir',
          stepName: 'Bước 2: Giám đốc công ty phê duyệt',
          stepOrder: 2,
          stepType: 'SEQUENTIAL',
          completionRule: 'ANY_CAN_APPROVE',
          approverConfig: {
            type: 'ORGANIZATION_ROLE',
            role: 'DIRECTOR',
          },
          reviewerUserIds: [],
        },
        {
          stepKey: 's3_specific_acc',
          stepName: 'Bước 3: Kế toán trưởng đối soát',
          stepOrder: 3,
          stepType: 'SEQUENTIAL',
          completionRule: 'ALL_MUST_APPROVE',
          approverConfig: {
            type: 'SPECIFIC_USERS',
            userIds: [accountantUser.id],
          },
          reviewerUserIds: [],
        },
      ];

      const wfRes = await workflowService.createWorkflowTemplate(
        {
          code: `WF_RESOLVE_${Date.now()}`,
          title: 'Quy trình giải quyết người duyệt đa dạng',
          steps: wfSteps,
        },
        adminAlpha,
      );

      const pubRes = await workflowService.publishWorkflowTemplate(
        wfRes.data.id,
        { releaseNotes: 'v1' },
        adminAlpha,
      );
      workflowVersionId = pubRes.data.versionId;
    });

    it('2.1 Giải quyết chính xác 3 bước duyệt động từ snapshot quy trình phiên bản', async () => {
      const docRes = await orchestrator.createDocument({
        templateId: formTemplateId,
        workflowTemplateVersionId: workflowVersionId,
        title: 'Tờ trình mua sắm máy chủ AI',
        formData: { noi_dung: 'Đề xuất mua máy chủ GPU phục vụ dự án' },
        userId: submitterUser.id,
        userOrganizationId: submitterUser.organizationId,
        userDepartmentId: submitterUser.departmentId,
        userRole: submitterUser.role,
      });

      expect(docRes.id).toBeDefined();

      // Kiểm tra trong PostgreSQL
      const doc = await prisma.document.findUnique({
        where: { id: docRes.id },
        include: {
          workflow: {
            include: {
              steps: {
                orderBy: { stepOrder: 'asc' },
                include: { assignees: true },
              },
            },
          },
        },
      });

      expect(doc?.workflowTemplateVersionId).toBe(workflowVersionId);
      const steps = doc?.workflow?.steps || [];
      expect(steps.length).toBe(3);

      // Bước 1: Phải tìm ra managerUser
      expect(steps[0].stepOrder).toBe(1);
      expect(steps[0].stepName).toContain('Trưởng phòng');
      expect(steps[0].completionRule).toBe('ALL_MUST_APPROVE');
      expect(steps[0].assignees.length).toBe(1);
      expect(steps[0].assignees[0].userId).toBe(managerUser.id);

      // Bước 2: Phải tìm ra directorUser
      expect(steps[1].stepOrder).toBe(2);
      expect(steps[1].stepName).toContain('Giám đốc');
      expect(steps[1].completionRule).toBe('ANY_CAN_APPROVE');
      expect(steps[1].assignees.length).toBe(1);
      expect(steps[1].assignees[0].userId).toBe(directorUser.id);

      // Bước 3: Phải tìm ra accountantUser
      expect(steps[2].stepOrder).toBe(3);
      expect(steps[2].stepName).toContain('Kế toán trưởng');
      expect(steps[2].assignees.length).toBe(1);
      expect(steps[2].assignees[0].userId).toBe(accountantUser.id);
    });

    it('2.2 Chặn tạo hồ sơ và Rollback giao dịch khi không tìm thấy người duyệt theo DEPARTMENT_ROLE', async () => {
      const beforeCount = await prisma.document.count();

      // Submitter thuộc phòng EMPTY_DEPT (không có MANAGER nào)
      await expect(
        orchestrator.createDocument({
          templateId: formTemplateId,
          workflowTemplateVersionId: workflowVersionId,
          title: 'Hồ sơ phòng trống',
          formData: { noi_dung: 'Thử nghiệm phòng không có lãnh đạo' },
          userId: submitterUser.id,
          userOrganizationId: orgAlphaId,
          userDepartmentId: deptEmptyId, // Không có ai chức danh MANAGER trong phòng này
          userRole: submitterUser.role,
        }),
      ).rejects.toThrow(/Không tìm thấy người dùng phù hợp có vai trò\/chức danh "MANAGER"/);

      // Xác minh giao dịch bị Rollback 100%, không sinh ra document rác
      const docCreated = await prisma.document.findFirst({
        where: { title: 'Hồ sơ phòng trống' },
      });
      expect(docCreated).toBeNull();
    });

    it('2.3 Chặn tạo hồ sơ và Rollback giao dịch khi người duyệt trong SPECIFIC_USERS bị vô hiệu hóa (inactive)', async () => {
      // Tạo một quy trình có người duyệt là inactiveUser
      const wfInactiveSteps: WorkflowStepConfig[] = [
        {
          stepKey: 's_inactive',
          stepName: 'Bước người duyệt đã nghỉ việc',
          stepOrder: 1,
          stepType: 'SEQUENTIAL',
          completionRule: 'ALL_MUST_APPROVE',
          approverConfig: {
            type: 'SPECIFIC_USERS',
            userIds: [inactiveUser.id],
          },
          reviewerUserIds: [],
        },
      ];

      const wfRes = await workflowService.createWorkflowTemplate(
        {
          code: `WF_INACTIVE_${Date.now()}`,
          title: 'Quy trình nhân viên inactive',
          steps: wfInactiveSteps,
        },
        adminAlpha,
      );

      const pubRes = await workflowService.publishWorkflowTemplate(
        wfRes.data.id,
        { releaseNotes: 'v1' },
        adminAlpha,
      );

      await expect(
        orchestrator.createDocument({
          templateId: formTemplateId,
          workflowTemplateVersionId: pubRes.data.versionId,
          title: 'Hồ sơ gửi người nghỉ việc',
          formData: { noi_dung: 'Test inactive user rollback' },
          userId: submitterUser.id,
          userOrganizationId: orgAlphaId,
          userDepartmentId: deptItId,
          userRole: submitterUser.role,
        }),
      ).rejects.toThrow(/đã bị vô hiệu hóa/);

      // Xác minh giao dịch bị Rollback 100%, không sinh ra document rác
      const docCreated = await prisma.document.findFirst({
        where: { title: 'Hồ sơ gửi người nghỉ việc' },
      });
      expect(docCreated).toBeNull();
    });
  });

  describe('3. Ràng buộc toàn vẹn CSDL & Bảo vệ hồ sơ lịch sử (Foreign Key ON DELETE RESTRICT)', () => {
    it('PostgreSQL chặn tuyệt đối việc xóa WorkflowTemplateVersion khi đang có hồ sơ tham chiếu', async () => {
      // Tạo 1 workflow và 1 document
      const wfSteps: WorkflowStepConfig[] = [
        {
          stepKey: 's_protect',
          stepName: 'Bước bảo vệ',
          stepOrder: 1,
          stepType: 'SEQUENTIAL',
          completionRule: 'ALL_MUST_APPROVE',
          approverConfig: {
            type: 'SPECIFIC_USERS',
            userIds: [accountantUser.id],
          },
          reviewerUserIds: [],
        },
      ];

      const wf = await workflowService.createWorkflowTemplate(
        {
          code: `WF_RESTRICT_${Date.now()}`,
          title: 'Quy trình bảo vệ lịch sử',
          steps: wfSteps,
        },
        adminAlpha,
      );

      const pub = await workflowService.publishWorkflowTemplate(
        wf.data.id,
        { releaseNotes: 'v1' },
        adminAlpha,
      );

      // Tạo template biểu mẫu
      const ft = await templateService.createTemplate(
        {
          code: `FT_RESTRICT_${Date.now()}`,
          title: 'Mẫu test restrict',
          fields: [{ id: 'f1', key: 'title', label: 'Tên', type: 'text', required: true, order: 1 }],
        },
        adminAlpha,
      );
      await templateService.publishTemplate(ft.data.id, { releaseNotes: 'v1' }, adminAlpha);

      // Tạo document tham chiếu đến pub.data.versionId
      await orchestrator.createDocument({
        templateId: ft.data.id,
        workflowTemplateVersionId: pub.data.versionId,
        title: 'Hồ sơ bảo vệ',
        formData: { title: 'Test Restrict' },
        userId: submitterUser.id,
        userOrganizationId: orgAlphaId,
        userDepartmentId: deptItId,
        userRole: submitterUser.role,
      });

      // Thao tác xóa trực tiếp WorkflowTemplateVersion phải bị PostgreSQL từ chối vì ON DELETE RESTRICT
      await expect(
        prisma.workflowTemplateVersion.delete({
          where: { id: pub.data.versionId },
        }),
      ).rejects.toThrow();
    });
  });

  describe('4. Phân quyền Đa tổ chức (Multi-Company Boundary)', () => {
    it('Chặn Quản trị viên công ty Beta chỉnh sửa quy trình của công ty Alpha', async () => {
      const wfSteps: WorkflowStepConfig[] = [
        {
          stepKey: 's_beta_test',
          stepName: 'Bước Alpha',
          stepOrder: 1,
          stepType: 'SEQUENTIAL',
          completionRule: 'ALL_MUST_APPROVE',
          approverConfig: {
            type: 'ORGANIZATION_ROLE',
            role: 'DIRECTOR',
          },
          reviewerUserIds: [],
        },
      ];

      const wf = await workflowService.createWorkflowTemplate(
        {
          code: `WF_TENANT_${Date.now()}`,
          title: 'Quy trình công ty Alpha',
          steps: wfSteps,
        },
        adminAlpha,
      );

      // Admin Beta cố gắng chỉnh sửa quy trình của Alpha
      await expect(
        workflowService.updateWorkflowTemplate(
          wf.data.id,
          { title: 'Sửa trộm bởi Beta' },
          adminBeta,
        ),
      ).rejects.toThrow(/Bạn không có quyền thao tác trên quy trình của công ty\/tổ chức khác/);
    });
  });
});
