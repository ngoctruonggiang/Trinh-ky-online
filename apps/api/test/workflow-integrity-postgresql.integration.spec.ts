import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  PrismaClient,
  TemplateStatus,
  UserRole,
  DocumentStatus,
  StepStatus,
  WorkflowStatus,
  AssigneeDecision,
  AssigneeRole,
  StepCompletionRule,
  StepType,
} from '@prisma/client';
import { WorkflowTemplateService } from '../src/modules/workflow-template/workflow-template.service.js';
import { WorkflowOrchestratorService } from '../src/modules/workflow/workflow-orchestrator.service.js';
import { TemplateService } from '../src/modules/template/template.service.js';
import { UserPrincipal } from '../src/common/interfaces/user-principal.interface.js';
import { WorkflowStepConfig } from '@trinh-ky/shared';

/**
 * ============================================================================
 * PHASE 11.1: END-TO-END VERIFICATION & WORKFLOW INTEGRITY INTEGRATION TESTS
 * ============================================================================
 * Chạy trên PostgreSQL vật lý thực tế (không dùng Mock).
 * Xác minh:
 * - Hạng mục A: Version integrity (bất biến v1, snapshot, concurrent publish, discard draft)
 * - Hạng mục B: Approval runtime (Sequential, ALL_MUST_APPROVE, ANY_CAN_APPROVE, Concurrency)
 * - Hạng mục C: Form và Workflow integration (Kế thừa workflow, chu trình đầy đủ)
 * - Hạng mục D: Tenant isolation & RBAC (Alpha vs Beta, role checking, anti-tampering)
 */
describe('Phase 11.1: Workflow Integrity & Approval Runtime (Real PostgreSQL)', () => {
  let prisma: PrismaClient;
  let workflowService: WorkflowTemplateService;
  let templateService: TemplateService;
  let orchestrator: WorkflowOrchestratorService;

  let orgAlphaId: string;
  let orgBetaId: string;
  let deptAlphaId: string;

  let superAdminUser: UserPrincipal;
  let adminAlpha: UserPrincipal;
  let adminBeta: UserPrincipal;
  let userAlpha: UserPrincipal;
  let approver1: any;
  let approver2: any;
  let approverInactive: any;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5432/trinh_ky_online_dev?schema=public';

    prisma = new PrismaClient();
    await prisma.$connect();
    console.log('✅ Đã kết nối PostgreSQL vật lý cho Phase 11.1 Integrity Test Suite.');

    workflowService = new WorkflowTemplateService(prisma);
    templateService = new TemplateService(prisma);
    orchestrator = new WorkflowOrchestratorService(prisma);

    // 1. Tạo tổ chức thử nghiệm Alpha và Beta
    const orgAlpha = await prisma.organization.upsert({
      where: { code: 'ORG-INT-ALPHA' },
      update: {},
      create: { code: 'ORG-INT-ALPHA', name: 'Công ty Alpha (Integrity Test)' },
    });
    orgAlphaId = orgAlpha.id;

    const orgBeta = await prisma.organization.upsert({
      where: { code: 'ORG-INT-BETA' },
      update: {},
      create: { code: 'ORG-INT-BETA', name: 'Công ty Beta (Integrity Test)' },
    });
    orgBetaId = orgBeta.id;

    // 2. Tạo phòng ban
    const deptAlpha = await prisma.department.upsert({
      where: { organizationId_code: { organizationId: orgAlphaId, code: 'DEV' } },
      update: {},
      create: { organizationId: orgAlphaId, code: 'DEV', name: 'Phòng Phát Triển' },
    });
    deptAlphaId = deptAlpha.id;

    // 3. Tạo các tài khoản người dùng
    const superUser = await prisma.user.upsert({
      where: { email: 'superadmin.int@vinagroup.vn' },
      update: { role: UserRole.SUPER_ADMIN, isActive: true },
      create: {
        email: 'superadmin.int@vinagroup.vn',
        passwordHash: 'hash',
        fullName: 'Super Admin Toàn Hệ Thống',
        role: UserRole.SUPER_ADMIN,
        isActive: true,
      },
    });
    superAdminUser = {
      id: superUser.id,
      email: superUser.email,
      fullName: superUser.fullName,
      role: superUser.role,
      organizationId: null,
      departmentId: null,
    };

    const admA = await prisma.user.upsert({
      where: { email: 'admin.alpha.int@vinagroup.vn' },
      update: { organizationId: orgAlphaId, role: UserRole.ADMIN, isActive: true },
      create: {
        email: 'admin.alpha.int@vinagroup.vn',
        passwordHash: 'hash',
        fullName: 'Admin Công ty Alpha',
        role: UserRole.ADMIN,
        organizationId: orgAlphaId,
        isActive: true,
      },
    });
    adminAlpha = {
      id: admA.id,
      email: admA.email,
      fullName: admA.fullName,
      role: admA.role,
      organizationId: admA.organizationId,
      departmentId: admA.departmentId,
    };

    const admB = await prisma.user.upsert({
      where: { email: 'admin.beta.int@vinagroup.vn' },
      update: { organizationId: orgBetaId, role: UserRole.ADMIN, isActive: true },
      create: {
        email: 'admin.beta.int@vinagroup.vn',
        passwordHash: 'hash',
        fullName: 'Admin Công ty Beta',
        role: UserRole.ADMIN,
        organizationId: orgBetaId,
        isActive: true,
      },
    });
    adminBeta = {
      id: admB.id,
      email: admB.email,
      fullName: admB.fullName,
      role: admB.role,
      organizationId: admB.organizationId,
      departmentId: admB.departmentId,
    };

    const usrA = await prisma.user.upsert({
      where: { email: 'user.alpha.int@vinagroup.vn' },
      update: { organizationId: orgAlphaId, departmentId: deptAlphaId, role: UserRole.USER, isActive: true },
      create: {
        email: 'user.alpha.int@vinagroup.vn',
        passwordHash: 'hash',
        fullName: 'Nhân viên Alpha',
        role: UserRole.USER,
        organizationId: orgAlphaId,
        departmentId: deptAlphaId,
        isActive: true,
      },
    });
    userAlpha = {
      id: usrA.id,
      email: usrA.email,
      fullName: usrA.fullName,
      role: usrA.role,
      organizationId: usrA.organizationId,
      departmentId: usrA.departmentId,
    };

    approver1 = await prisma.user.upsert({
      where: { email: 'app1.int@vinagroup.vn' },
      update: { organizationId: orgAlphaId, departmentId: deptAlphaId, role: UserRole.USER, isActive: true },
      create: {
        email: 'app1.int@vinagroup.vn',
        passwordHash: 'hash',
        fullName: 'Người duyệt 1',
        role: UserRole.USER,
        organizationId: orgAlphaId,
        departmentId: deptAlphaId,
        isActive: true,
      },
    });

    approver2 = await prisma.user.upsert({
      where: { email: 'app2.int@vinagroup.vn' },
      update: { organizationId: orgAlphaId, departmentId: deptAlphaId, role: UserRole.USER, isActive: true },
      create: {
        email: 'app2.int@vinagroup.vn',
        passwordHash: 'hash',
        fullName: 'Người duyệt 2',
        role: UserRole.USER,
        organizationId: orgAlphaId,
        departmentId: deptAlphaId,
        isActive: true,
      },
    });

    approverInactive = await prisma.user.upsert({
      where: { email: 'inactive.app.int@vinagroup.vn' },
      update: { organizationId: orgAlphaId, isActive: false },
      create: {
        email: 'inactive.app.int@vinagroup.vn',
        passwordHash: 'hash',
        fullName: 'Người duyệt Đã Nghỉ Việc',
        role: UserRole.USER,
        organizationId: orgAlphaId,
        isActive: false,
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  // ==========================================================================
  // HẠNG MỤC A: VERSION INTEGRITY
  // ==========================================================================
  describe('Hạng mục A: Version Integrity', () => {
    let wfId: string;
    let v1Id: string;
    let v2Id: string;
    let formTplId: string;
    let docV1Id: string;

    it('A.1: Tạo DRAFT, chỉnh sửa và phát hành v1', async () => {
      const stepsV1: WorkflowStepConfig[] = [
        {
          stepKey: 'step_v1',
          stepName: 'Bước kiểm tra v1',
          stepOrder: 1,
          stepType: 'SEQUENTIAL',
          completionRule: 'ALL_MUST_APPROVE',
          approverConfig: {
            type: 'SPECIFIC_USERS',
            userIds: [approver1.id],
          },
          reviewerUserIds: [],
        },
      ];

      const created = await workflowService.createWorkflowTemplate(
        {
          code: `WF_INTEG_${Date.now()}`,
          title: 'Quy trình kiểm thử toàn vẹn phiên bản',
          steps: stepsV1,
        },
        adminAlpha,
      );
      wfId = created.data.id;

      // Cập nhật khi ở DRAFT ban đầu
      await workflowService.updateWorkflowTemplate(
        wfId,
        {
          title: 'Quy trình kiểm thử toàn vẹn phiên bản (Đã cập nhật nháp)',
        },
        adminAlpha,
      );

      // Phát hành v1
      const pub1 = await workflowService.publishWorkflowTemplate(
        wfId,
        { releaseNotes: 'Phát hành chính thức v1' },
        adminAlpha,
      );
      v1Id = pub1.data.versionId;

      expect(pub1.data.versionNumber).toBe(1);
      expect(pub1.data.status).toBe(TemplateStatus.PUBLISHED);

      const dbV1 = await prisma.workflowTemplateVersion.findUniqueOrThrow({
        where: { id: v1Id },
      });
      expect(dbV1.versionNumber).toBe(1);
      expect(dbV1.status).toBe(TemplateStatus.PUBLISHED);
    });

    it('A.2: Tạo hồ sơ từ v1 trước khi v2 được tạo', async () => {
      // Tạo FormTemplate
      const formTpl = await templateService.createTemplate(
        {
          code: `FT_INT_${Date.now()}`,
          title: 'Biểu mẫu phục vụ test v1',
          fields: [{ id: 'f1', key: 'title', label: 'Tiêu đề', type: 'text', required: true, order: 1 }],
        },
        adminAlpha,
      );
      await templateService.publishTemplate(formTpl.data.id, { releaseNotes: 'v1' }, adminAlpha);
      formTplId = formTpl.data.id;

      // Khởi tạo document từ v1
      const doc = await orchestrator.createDocument({
        templateId: formTplId,
        workflowTemplateVersionId: v1Id,
        title: 'Hồ sơ khởi tạo từ phiên bản v1',
        formData: { title: 'Dữ liệu v1' },
        userId: userAlpha.id,
        userOrganizationId: orgAlphaId,
        userDepartmentId: deptAlphaId,
        userRole: userAlpha.role,
      });
      docV1Id = doc.id;

      const dbDoc = await prisma.document.findUniqueOrThrow({
        where: { id: docV1Id },
        include: { workflow: { include: { steps: { include: { assignees: true } } } } },
      });

      expect(dbDoc.workflowTemplateVersionId).toBe(v1Id);
      expect(dbDoc.workflow?.steps.length).toBe(1);
      expect(dbDoc.workflow?.steps[0].stepName).toBe('Bước kiểm tra v1');
      expect(dbDoc.workflow?.steps[0].assignees[0].userId).toBe(approver1.id);
    });

    it('A.3: Tạo DRAFT v2 từ v1, chỉnh sửa và phát hành v2', async () => {
      // 1. Tạo draft v2
      const draftRes = await workflowService.createDraftVersion(wfId, adminAlpha);
      expect(draftRes.data.versionNumber).toBe(2);
      expect(draftRes.data.status).toBe(TemplateStatus.DRAFT);

      // 2. Chỉnh sửa draft v2 với bước duyệt và người duyệt hoàn toàn mới
      const stepsV2: WorkflowStepConfig[] = [
        {
          stepKey: 'step_v2_1',
          stepName: 'Bước v2 số 1',
          stepOrder: 1,
          stepType: 'SEQUENTIAL',
          completionRule: 'ANY_CAN_APPROVE',
          approverConfig: {
            type: 'SPECIFIC_USERS',
            userIds: [approver2.id],
          },
          reviewerUserIds: [],
        },
        {
          stepKey: 'step_v2_2',
          stepName: 'Bước v2 số 2',
          stepOrder: 2,
          stepType: 'SEQUENTIAL',
          completionRule: 'ALL_MUST_APPROVE',
          approverConfig: {
            type: 'SPECIFIC_USERS',
            userIds: [approver1.id],
          },
          reviewerUserIds: [],
        },
      ];

      await workflowService.updateDraftVersion(
        wfId,
        {
          title: 'Quy trình v2 cải tiến',
          steps: stepsV2,
        },
        adminAlpha,
      );

      // 3. Phát hành v2
      const pub2 = await workflowService.publishWorkflowTemplate(
        wfId,
        { releaseNotes: 'Phát hành chính thức v2' },
        adminAlpha,
      );
      v2Id = pub2.data.versionId;
      expect(pub2.data.versionNumber).toBe(2);

      const dbParent = await prisma.workflowTemplate.findUniqueOrThrow({
        where: { id: wfId },
      });
      expect(dbParent.currentVersion).toBe(2);
    });

    it('A.4: Xác minh v1 hoàn toàn bất biến sau khi v2 được phát hành', async () => {
      const dbV1 = await prisma.workflowTemplateVersion.findUniqueOrThrow({
        where: { id: v1Id },
      });

      expect(dbV1.versionNumber).toBe(1);
      expect(dbV1.status).toBe(TemplateStatus.PUBLISHED);

      const v1Steps = dbV1.steps as unknown as WorkflowStepConfig[];
      expect(v1Steps.length).toBe(1);
      expect(v1Steps[0].stepKey).toBe('step_v1');
      expect(v1Steps[0].approverConfig.userIds).toContain(approver1.id);
    });

    it('A.5: Xác minh hồ sơ đã tạo từ v1 vẫn giữ nguyên vẹn cấu hình ban đầu', async () => {
      const dbDoc = await prisma.document.findUniqueOrThrow({
        where: { id: docV1Id },
        include: { workflow: { include: { steps: { include: { assignees: true } } } } },
      });

      expect(dbDoc.workflowTemplateVersionId).toBe(v1Id);
      expect(dbDoc.workflow?.steps.length).toBe(1);
      expect(dbDoc.workflow?.steps[0].stepName).toBe('Bước kiểm tra v1');
      expect(dbDoc.workflow?.steps[0].completionRule).toBe(StepCompletionRule.ALL_MUST_APPROVE);
      expect(dbDoc.workflow?.steps[0].assignees.length).toBe(1);
      expect(dbDoc.workflow?.steps[0].assignees[0].userId).toBe(approver1.id);
    });

    it('A.6: Không thể sửa trực tiếp quy trình đã phát hành qua updateWorkflowTemplate', async () => {
      await expect(
        workflowService.updateWorkflowTemplate(
          wfId,
          { title: 'Cố tình sửa trực tiếp v2' },
          adminAlpha,
        ),
      ).rejects.toThrow(/Chỉ có thể chỉnh sửa quy trình đang ở trạng thái bản nháp ban đầu/);
    });

    it('A.7: Không thể xóa phiên bản đang được hồ sơ tham chiếu (ON DELETE RESTRICT)', async () => {
      await expect(
        prisma.workflowTemplateVersion.delete({
          where: { id: v1Id },
        }),
      ).rejects.toThrow();
    });

    it('A.8: Kiểm thử hai yêu cầu phát hành đồng thời chống tạo trùng phiên bản', async () => {
      // Tạo draft v3
      await workflowService.createDraftVersion(wfId, adminAlpha);

      // Mô phỏng 2 request phát hành song song cùng 1 lúc
      const [res1, res2] = await Promise.allSettled([
        workflowService.publishWorkflowTemplate(wfId, { releaseNotes: 'Req 1' }, adminAlpha),
        workflowService.publishWorkflowTemplate(wfId, { releaseNotes: 'Req 2' }, adminAlpha),
      ]);

      const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
      const rejected = [res1, res2].filter((r) => r.status === 'rejected');

      // Chính xác 1 request thành công và 1 request bị từ chối
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      // Kiểm tra trong DB không có 2 phiên bản v3 bị trùng lặp
      const v3Versions = await prisma.workflowTemplateVersion.findMany({
        where: { workflowTemplateId: wfId, versionNumber: 3 },
      });
      expect(v3Versions.length).toBe(1);
    });

    it('A.9: Hành vi khi hủy bản nháp (discard draft): không ảnh hưởng phiên bản đã phát hành', async () => {
      // Tạo draft v4
      const d4 = await workflowService.createDraftVersion(wfId, adminAlpha);
      expect(d4.data.versionNumber).toBe(4);

      // Hủy bỏ draft v4
      const discardRes = await workflowService.discardDraftVersion(wfId, adminAlpha);
      expect(discardRes.success).toBe(true);

      // Kiểm tra trong DB: bản nháp v4 đã bị xóa
      const d4Db = await prisma.workflowTemplateVersion.findFirst({
        where: { workflowTemplateId: wfId, versionNumber: 4, status: TemplateStatus.DRAFT },
      });
      expect(d4Db).toBeNull();

      // Các phiên bản v1, v2, v3 đã phát hành vẫn tồn tại 100% nguyên vẹn
      const publishedCount = await prisma.workflowTemplateVersion.count({
        where: { workflowTemplateId: wfId, status: TemplateStatus.PUBLISHED },
      });
      expect(publishedCount).toBe(3);
    });
  });

  // ==========================================================================
  // HẠNG MỤC B: APPROVAL RUNTIME (Real PostgreSQL)
  // ==========================================================================
  describe('Hạng mục B: Approval Runtime Engine', () => {
    let formTplId: string;

    beforeAll(async () => {
      const ft = await templateService.createTemplate(
        {
          code: `FT_RUNTIME_${Date.now()}`,
          title: 'Mẫu kiểm thử runtime',
          fields: [{ id: 'f1', key: 'amount', label: 'Số tiền', type: 'number', required: true, order: 1 }],
        },
        adminAlpha,
      );
      await templateService.publishTemplate(ft.data.id, { releaseNotes: 'v1' }, adminAlpha);
      formTplId = ft.data.id;
    });

    it('B.1: Sequential workflow: Bước 1 chưa xong thì không cho phép duyệt Bước 2', async () => {
      // Tạo workflow 2 bước tuần tự: Bước 1 (approver1), Bước 2 (approver2)
      const wf = await workflowService.createWorkflowTemplate(
        {
          code: `WF_SEQ_${Date.now()}`,
          title: 'Quy trình tuần tự 2 bước',
          steps: [
            {
              stepKey: 'step1',
              stepName: 'Bước 1: Quản lý',
              stepOrder: 1,
              stepType: 'SEQUENTIAL',
              completionRule: 'ALL_MUST_APPROVE',
              approverConfig: { type: 'SPECIFIC_USERS', userIds: [approver1.id] },
              reviewerUserIds: [],
            },
            {
              stepKey: 'step2',
              stepName: 'Bước 2: Giám đốc',
              stepOrder: 2,
              stepType: 'SEQUENTIAL',
              completionRule: 'ALL_MUST_APPROVE',
              approverConfig: { type: 'SPECIFIC_USERS', userIds: [approver2.id] },
              reviewerUserIds: [],
            },
          ],
        },
        adminAlpha,
      );
      const pubWf = await workflowService.publishWorkflowTemplate(wf.data.id, { releaseNotes: 'v1' }, adminAlpha);

      // Tạo hồ sơ và submit
      const doc = await orchestrator.createDocument({
        templateId: formTplId,
        workflowTemplateVersionId: pubWf.data.versionId,
        title: 'Hồ sơ test thứ tự duyệt',
        formData: { amount: 1000 },
        userId: userAlpha.id,
        userOrganizationId: orgAlphaId,
        userDepartmentId: deptAlphaId,
        userRole: userAlpha.role,
      });

      await orchestrator.submitDocument({ documentId: doc.id, userId: userAlpha.id });

      // Approver 2 cố tình phê duyệt khi đang ở Bước 1
      await expect(
        orchestrator.processAssigneeDecision({
          documentId: doc.id,
          userId: approver2.id,
          decision: AssigneeDecision.APPROVED,
        }),
      ).rejects.toThrow(/không được phân công trong bước "Bước 1: Quản lý"/);

      // Approver 1 phê duyệt Bước 1 hợp lệ
      const resStep1 = await orchestrator.processAssigneeDecision({
        documentId: doc.id,
        userId: approver1.id,
        decision: AssigneeDecision.APPROVED,
        decisionComment: 'Đồng ý bước 1',
      });
      expect(resStep1.success).toBe(true);
      expect(resStep1.documentStatus).toBe(DocumentStatus.IN_REVIEW);

      // Kiểm tra DB: Bước 1 COMPLETED, Bước 2 IN_PROGRESS
      const s1Db = await prisma.approvalStep.findFirstOrThrow({
        where: { workflow: { documentId: doc.id }, stepOrder: 1 },
      });
      const s2Db = await prisma.approvalStep.findFirstOrThrow({
        where: { workflow: { documentId: doc.id }, stepOrder: 2 },
      });
      expect(s1Db.status).toBe(StepStatus.COMPLETED);
      expect(s2Db.status).toBe(StepStatus.IN_PROGRESS);

      // Approver 1 không thể duyệt lại Bước 1 đã hoàn tất
      await expect(
        orchestrator.processAssigneeDecision({
          documentId: doc.id,
          userId: approver1.id,
          decision: AssigneeDecision.APPROVED,
        }),
      ).rejects.toThrow(/không được phân công trong bước "Bước 2: Giám đốc"/);

      // Approver 2 phê duyệt Bước 2 -> Hồ sơ APPROVED hoàn tất
      const resStep2 = await orchestrator.processAssigneeDecision({
        documentId: doc.id,
        userId: approver2.id,
        decision: AssigneeDecision.APPROVED,
      });
      expect(resStep2.documentStatus).toBe(DocumentStatus.APPROVED);

      // Kiểm tra AuditLog đầy đủ
      const auditLogs = await prisma.auditLog.findMany({
        where: { documentId: doc.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(auditLogs.some((l) => l.action === 'CREATE_DOCUMENT')).toBe(true);
      expect(auditLogs.some((l) => l.action === 'SUBMIT_DOCUMENT')).toBe(true);
      expect(auditLogs.some((l) => l.action === 'APPROVE_STEP')).toBe(true);
    });

    it('B.2: ALL_MUST_APPROVE: Một người đồng ý chưa hoàn thành bước, cần tất cả đồng ý', async () => {
      const wf = await workflowService.createWorkflowTemplate(
        {
          code: `WF_ALL_${Date.now()}`,
          title: 'Quy trình ALL_MUST_APPROVE',
          steps: [
            {
              stepKey: 'step_all',
              stepName: 'Bước hội đồng',
              stepOrder: 1,
              stepType: 'SEQUENTIAL',
              completionRule: 'ALL_MUST_APPROVE',
              approverConfig: { type: 'SPECIFIC_USERS', userIds: [approver1.id, approver2.id] },
              reviewerUserIds: [],
            },
          ],
        },
        adminAlpha,
      );
      const pubWf = await workflowService.publishWorkflowTemplate(wf.data.id, { releaseNotes: 'v1' }, adminAlpha);

      const doc = await orchestrator.createDocument({
        templateId: formTplId,
        workflowTemplateVersionId: pubWf.data.versionId,
        title: 'Hồ sơ test ALL_MUST_APPROVE',
        formData: { amount: 2000 },
        userId: userAlpha.id,
        userOrganizationId: orgAlphaId,
        userDepartmentId: deptAlphaId,
        userRole: userAlpha.role,
      });
      await orchestrator.submitDocument({ documentId: doc.id, userId: userAlpha.id });

      // Người 1 duyệt -> Bước VẪN IN_PROGRESS
      const res1 = await orchestrator.processAssigneeDecision({
        documentId: doc.id,
        userId: approver1.id,
        decision: AssigneeDecision.APPROVED,
      });
      expect(res1.documentStatus).toBe(DocumentStatus.IN_REVIEW);

      const stepCheck = await prisma.approvalStep.findFirstOrThrow({
        where: { workflow: { documentId: doc.id }, stepOrder: 1 },
      });
      expect(stepCheck.status).toBe(StepStatus.IN_PROGRESS);

      // Người 2 duyệt -> Bước mới COMPLETED và hồ sơ APPROVED
      const res2 = await orchestrator.processAssigneeDecision({
        documentId: doc.id,
        userId: approver2.id,
        decision: AssigneeDecision.APPROVED,
      });
      expect(res2.documentStatus).toBe(DocumentStatus.APPROVED);

      const stepCompleted = await prisma.approvalStep.findFirstOrThrow({
        where: { workflow: { documentId: doc.id }, stepOrder: 1 },
      });
      expect(stepCompleted.status).toBe(StepStatus.COMPLETED);
    });

    it('B.3: ANY_CAN_APPROVE: Một người đồng ý hoàn thành bước, quyết định muộn bị chặn an toàn', async () => {
      const wf = await workflowService.createWorkflowTemplate(
        {
          code: `WF_ANY_${Date.now()}`,
          title: 'Quy trình ANY_CAN_APPROVE',
          steps: [
            {
              stepKey: 'step_any',
              stepName: 'Bước bất kỳ ai duyệt',
              stepOrder: 1,
              stepType: 'SEQUENTIAL',
              completionRule: 'ANY_CAN_APPROVE',
              approverConfig: { type: 'SPECIFIC_USERS', userIds: [approver1.id, approver2.id] },
              reviewerUserIds: [],
            },
          ],
        },
        adminAlpha,
      );
      const pubWf = await workflowService.publishWorkflowTemplate(wf.data.id, { releaseNotes: 'v1' }, adminAlpha);

      const doc = await orchestrator.createDocument({
        templateId: formTplId,
        workflowTemplateVersionId: pubWf.data.versionId,
        title: 'Hồ sơ test ANY_CAN_APPROVE',
        formData: { amount: 3000 },
        userId: userAlpha.id,
        userOrganizationId: orgAlphaId,
        userDepartmentId: deptAlphaId,
        userRole: userAlpha.role,
      });
      await orchestrator.submitDocument({ documentId: doc.id, userId: userAlpha.id });

      // Người 1 duyệt -> Bước COMPLETED ngay lập tức và hồ sơ APPROVED
      const res1 = await orchestrator.processAssigneeDecision({
        documentId: doc.id,
        userId: approver1.id,
        decision: AssigneeDecision.APPROVED,
        decisionComment: 'Người 1 duyệt nhanh',
      });
      expect(res1.documentStatus).toBe(DocumentStatus.APPROVED);

      // Người 2 gửi quyết định muộn sau khi hồ sơ đã APPROVED
      await expect(
        orchestrator.processAssigneeDecision({
          documentId: doc.id,
          userId: approver2.id,
          decision: AssigneeDecision.APPROVED,
          decisionComment: 'Người 2 đến muộn',
        }),
      ).rejects.toThrow();

      // Kiểm tra DB: Quyết định của người 2 KHÔNG được ghi nhận và không làm sai lệch kết quả đã chốt
      const histories = await prisma.stepDecisionHistory.findMany({
        where: { step: { workflow: { documentId: doc.id } } },
      });
      expect(histories.length).toBe(1);
      expect(histories[0].userId).toBe(approver1.id);
    });

    it('B.4: Chặn người duyệt bị vô hiệu hóa (inactive) thực hiện phê duyệt', async () => {
      // Cấu hình một bước duyệt có người dùng inactive
      const doc = await prisma.document.create({
        data: {
          documentNumber: `TK-INACT-${Date.now()}`,
          title: 'Hồ sơ test người duyệt inactive',
          templateId: formTplId,
          createdById: userAlpha.id,
          organizationId: orgAlphaId,
          status: DocumentStatus.IN_REVIEW,
          versions: {
            create: {
              versionNumber: 1,
              formData: { amount: 500 },
              sha256Hash: 'hash-test',
              createdById: userAlpha.id,
            },
          },
          workflow: {
            create: {
              status: WorkflowStatus.RUNNING,
              currentStepOrder: 1,
              steps: {
                create: {
                  stepOrder: 1,
                  stepName: 'Bước thẩm định',
                  stepType: StepType.SEQUENTIAL,
                  completionRule: StepCompletionRule.ALL_MUST_APPROVE,
                  status: StepStatus.IN_PROGRESS,
                  assignees: {
                    create: {
                      userId: approverInactive.id,
                      role: AssigneeRole.APPROVER,
                      decision: AssigneeDecision.PENDING,
                    },
                  },
                },
              },
            },
          },
        },
      });

      await expect(
        orchestrator.processAssigneeDecision({
          documentId: doc.id,
          userId: approverInactive.id,
          decision: AssigneeDecision.APPROVED,
        }),
      ).rejects.toThrow(/đã bị vô hiệu hóa \(inactive\)/);
    });

    it('B.5: Concurrency: Hai người cùng gửi quyết định đồng thời trên ALL_MUST_APPROVE', async () => {
      const wf = await workflowService.createWorkflowTemplate(
        {
          code: `WF_CONC_${Date.now()}`,
          title: 'Quy trình Concurrency ALL',
          steps: [
            {
              stepKey: 'step_conc',
              stepName: 'Bước đồng thời',
              stepOrder: 1,
              stepType: 'SEQUENTIAL',
              completionRule: 'ALL_MUST_APPROVE',
              approverConfig: { type: 'SPECIFIC_USERS', userIds: [approver1.id, approver2.id] },
              reviewerUserIds: [],
            },
          ],
        },
        adminAlpha,
      );
      const pubWf = await workflowService.publishWorkflowTemplate(wf.data.id, { releaseNotes: 'v1' }, adminAlpha);

      const doc = await orchestrator.createDocument({
        templateId: formTplId,
        workflowTemplateVersionId: pubWf.data.versionId,
        title: 'Hồ sơ kiểm thử tương tranh',
        formData: { amount: 4000 },
        userId: userAlpha.id,
        userOrganizationId: orgAlphaId,
        userDepartmentId: deptAlphaId,
        userRole: userAlpha.role,
      });
      await orchestrator.submitDocument({ documentId: doc.id, userId: userAlpha.id });

      // Mô phỏng 2 quyết định gửi gần như cùng thời điểm với hàng khóa row-level lock
      const [res1, res2] = await Promise.allSettled([
        orchestrator.processAssigneeDecision({
          documentId: doc.id,
          userId: approver1.id,
          decision: AssigneeDecision.APPROVED,
          decisionComment: 'Approver 1 đồng ý',
        }),
        orchestrator.processAssigneeDecision({
          documentId: doc.id,
          userId: approver2.id,
          decision: AssigneeDecision.APPROVED,
          decisionComment: 'Approver 2 đồng ý',
        }),
      ]);

      expect(res1.status === 'fulfilled' || res2.status === 'fulfilled').toBe(true);

      // Kiểm tra DB: Bước duyệt và hồ sơ phải ở trạng thái nhất quán
      const dbDoc = await prisma.document.findUniqueOrThrow({
        where: { id: doc.id },
        include: { workflow: { include: { steps: { include: { assignees: true } } } } },
      });

      expect([DocumentStatus.IN_REVIEW, DocumentStatus.APPROVED]).toContain(dbDoc.status);
    });
  });

  // ==========================================================================
  // HẠNG MỤC C: FORM & WORKFLOW INTEGRATION
  // ==========================================================================
  describe('Hạng mục C: Form và Workflow Integration', () => {
    it('C.1: Hồ sơ tự động kế thừa WorkflowTemplate liên kết với FormTemplate', async () => {
      // 1. Tạo và phát hành WorkflowTemplate
      const wf = await workflowService.createWorkflowTemplate(
        {
          code: `WF_LINK_${Date.now()}`,
          title: 'Quy trình chi phí liên kết biểu mẫu',
          steps: [
            {
              stepKey: 'step_link_1',
              stepName: 'Bước trưởng bộ phận',
              stepOrder: 1,
              stepType: 'SEQUENTIAL',
              completionRule: 'ALL_MUST_APPROVE',
              approverConfig: { type: 'SPECIFIC_USERS', userIds: [approver1.id] },
              reviewerUserIds: [],
            },
            {
              stepKey: 'step_link_2',
              stepName: 'Bước giám đốc khối',
              stepOrder: 2,
              stepType: 'SEQUENTIAL',
              completionRule: 'ALL_MUST_APPROVE',
              approverConfig: { type: 'SPECIFIC_USERS', userIds: [approver2.id] },
              reviewerUserIds: [],
            },
          ],
        },
        adminAlpha,
      );
      const pubWf = await workflowService.publishWorkflowTemplate(wf.data.id, { releaseNotes: 'v1' }, adminAlpha);

      // 2. Tạo FormTemplate và liên kết workflowTemplateId
      const formTpl = await prisma.formTemplate.create({
        data: {
          code: `FT_LINK_${Date.now()}`,
          title: 'Phiếu đề xuất chi tiêu',
          fields: [{ id: 'f1', key: 'desc', label: 'Mô tả', type: 'text', required: true, order: 1 }],
          layoutBlocks: [],
          workflowTemplateId: wf.data.id,
          status: TemplateStatus.PUBLISHED,
          createdById: adminAlpha.id,
          organizationId: orgAlphaId,
        },
      });

      // 3. Người dùng tạo hồ sơ mà KHÔNG truyền workflowTemplateId
      const doc = await orchestrator.createDocument({
        templateId: formTpl.id,
        title: 'Đề xuất mua sắm thiết bị',
        formData: { desc: 'Mua 2 màn hình 4K' },
        userId: userAlpha.id,
        userOrganizationId: orgAlphaId,
        userDepartmentId: deptAlphaId,
        userRole: userAlpha.role,
      });

      // 4. Kiểm tra hồ sơ tự động liên kết đúng WorkflowTemplateVersion
      const dbDoc = await prisma.document.findUniqueOrThrow({
        where: { id: doc.id },
        include: { workflow: { include: { steps: { orderBy: { stepOrder: 'asc' } } } } },
      });

      expect(dbDoc.workflowTemplateVersionId).toBe(pubWf.data.versionId);
      expect(dbDoc.workflow?.steps.length).toBe(2);
      expect(dbDoc.workflow?.steps[0].stepName).toBe('Bước trưởng bộ phận');
      expect(dbDoc.workflow?.steps[1].stepName).toBe('Bước giám đốc khối');

      // 5. Chu trình đầy đủ: Submit -> Duyệt Bước 1 -> Yêu cầu sửa Bước 2 -> Nộp lại -> Duyệt hoàn tất
      await orchestrator.submitDocument({ documentId: doc.id, userId: userAlpha.id });

      // Duyệt bước 1
      await orchestrator.processAssigneeDecision({
        documentId: doc.id,
        userId: approver1.id,
        decision: AssigneeDecision.APPROVED,
      });

      // Bước 2: Yêu cầu chỉnh sửa
      const revRes = await orchestrator.processAssigneeDecision({
        documentId: doc.id,
        userId: approver2.id,
        decision: AssigneeDecision.REVISION_REQUESTED,
        decisionComment: 'Cần giảm ngân sách',
      });
      expect(revRes.documentStatus).toBe(DocumentStatus.REVISION_REQUESTED);

      // Tác giả sửa và nộp lại (Resubmit)
      const resubmitRes = await orchestrator.resubmitDocument({
        documentId: doc.id,
        userId: userAlpha.id,
        newFormData: { desc: 'Mua 2 màn hình 2K (Đã giảm ngân sách)' },
        changeSummary: 'Giảm cấu hình màn hình',
      });
      expect(resubmitRes.newVersionNumber).toBe(2);
      expect(resubmitRes.documentStatus).toBe(DocumentStatus.IN_REVIEW);

      // Quy trình tự động reset về Bước 1
      const resetStep1 = await prisma.approvalStep.findFirstOrThrow({
        where: { workflow: { documentId: doc.id }, stepOrder: 1 },
      });
      expect(resetStep1.status).toBe(StepStatus.IN_PROGRESS);

      // Duyệt lại Bước 1 và Bước 2
      await orchestrator.processAssigneeDecision({
        documentId: doc.id,
        userId: approver1.id,
        decision: AssigneeDecision.APPROVED,
      });
      const finalRes = await orchestrator.processAssigneeDecision({
        documentId: doc.id,
        userId: approver2.id,
        decision: AssigneeDecision.APPROVED,
      });
      expect(finalRes.documentStatus).toBe(DocumentStatus.APPROVED);

      // Kiểm tra DB: DocumentVersion v2 đã lưu đúng hash và dữ liệu mới
      const v2Doc = await prisma.documentVersion.findUniqueOrThrow({
        where: { documentId_versionNumber: { documentId: doc.id, versionNumber: 2 } },
      });
      expect((v2Doc.formData as any).desc).toBe('Mua 2 màn hình 2K (Đã giảm ngân sách)');
    });
  });

  // ==========================================================================
  // HẠNG MỤC D: TENANT ISOLATION VÀ PHÂN QUYỀN TRUY CẬP
  // ==========================================================================
  describe('Hạng mục D: Tenant Isolation & RBAC', () => {
    it('D.1: Admin Alpha không thể xem hoặc sửa quy trình của Beta', async () => {
      // Beta tạo quy trình
      const betaWf = await workflowService.createWorkflowTemplate(
        {
          code: `WF_BETA_PRV_${Date.now()}`,
          title: 'Quy trình nội bộ công ty Beta',
          steps: [
            {
              stepKey: 'step_b',
              stepName: 'Bước Beta',
              stepOrder: 1,
              stepType: 'SEQUENTIAL',
              completionRule: 'ALL_MUST_APPROVE',
              approverConfig: { type: 'SPECIFIC_USERS', userIds: [adminBeta.id] },
              reviewerUserIds: [],
            },
          ],
        },
        adminBeta,
      );

      // Admin Alpha cố gắng xem chi tiết quy trình của Beta -> 403 Forbidden
      await expect(
        workflowService.getWorkflowTemplateById(betaWf.data.id, adminAlpha),
      ).rejects.toThrow(/Bạn không có quyền truy cập quy trình thuộc công ty\/tổ chức khác/);

      // Admin Alpha cố gắng sửa quy trình của Beta -> 403 Forbidden
      await expect(
        workflowService.updateWorkflowTemplate(betaWf.data.id, { title: 'Hack Beta' }, adminAlpha),
      ).rejects.toThrow(/Bạn không có quyền thao tác trên quy trình của công ty\/tổ chức khác/);
    });

    it('D.2: USER thông thường không có quyền tạo, sửa hoặc phát hành workflow template', async () => {
      await expect(
        workflowService.createWorkflowTemplate(
          {
            code: `WF_HACK_${Date.now()}`,
            title: 'Quy trình do User tạo lậu',
            steps: [
              {
                stepKey: 's1',
                stepName: 'S1',
                stepOrder: 1,
                stepType: 'SEQUENTIAL',
                completionRule: 'ALL_MUST_APPROVE',
                approverConfig: { type: 'SPECIFIC_USERS', userIds: [userAlpha.id] },
                reviewerUserIds: [],
              },
            ],
          },
          userAlpha,
        ),
      ).rejects.toThrow(/Chỉ Quản trị viên \(ADMIN\) mới có quyền/);
    });

    it('D.3: Quy trình dùng chung (organizationId = null): Chỉ SUPER_ADMIN mới được quản trị', async () => {
      // Super Admin tạo quy trình dùng chung toàn tập đoàn
      const globalWf = await workflowService.createWorkflowTemplate(
        {
          code: `WF_GLOBAL_${Date.now()}`,
          title: 'Quy trình chuẩn toàn tập đoàn',
          organizationId: null,
          steps: [
            {
              stepKey: 'sg1',
              stepName: 'Bước chung',
              stepOrder: 1,
              stepType: 'SEQUENTIAL',
              completionRule: 'ALL_MUST_APPROVE',
              approverConfig: { type: 'SPECIFIC_USERS', userIds: [approver1.id] },
              reviewerUserIds: [],
            },
          ],
        },
        superAdminUser,
      );

      // Admin Alpha cố tình chỉnh sửa quy trình chung -> 403 Forbidden
      await expect(
        workflowService.updateWorkflowTemplate(
          globalWf.data.id,
          { title: 'Alpha chiếm quyền quy trình tập đoàn' },
          adminAlpha,
        ),
      ).rejects.toThrow(/Chỉ Quản trị viên cấp cao \(SUPER_ADMIN\) mới có quyền/);
    });
  });
});
