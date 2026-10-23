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
} from '@prisma/client';
import { WorkflowOrchestratorService } from '../src/modules/workflow/workflow-orchestrator.service.js';
import { DocumentReadService } from '../src/modules/workflow/document-read.service.js';
import { NotificationService } from '../src/modules/notification/notification.service.js';
import { UserPrincipal } from '../src/common/interfaces/user-principal.interface.js';

describe('Phase 12: Advanced Approvals, Reassignment, SLA & Notifications (Real PostgreSQL)', () => {
  let prisma: PrismaClient;
  let orchestrator: WorkflowOrchestratorService;
  let readService: DocumentReadService;
  let notifService: NotificationService;

  let orgAlphaId: string;
  let orgBetaId: string;

  let superAdmin: UserPrincipal;
  let adminAlpha: UserPrincipal;
  let userAlpha: UserPrincipal;
  let approver1: any;
  let approver2: any;
  let approverNew: any;
  let approverBeta: any;
  let approverInactive: any;

  let testTemplateId: string;
  let testWorkflowTemplateId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5432/trinh_ky_online_dev?schema=public';

    prisma = new PrismaClient();
    await prisma.$connect();
    console.log('✅ Đã kết nối PostgreSQL vật lý cho Phase 12 Integration Suite.');

    orchestrator = new WorkflowOrchestratorService(prisma);
    readService = new DocumentReadService(prisma as any);
    notifService = new NotificationService(prisma as any);

    // 1. Khởi tạo Tổ chức thử nghiệm
    const orgAlpha = await prisma.organization.create({
      data: {
        code: `ALPHA_P12_${Date.now()}`,
        name: 'Công ty Alpha P12',
      },
    });
    orgAlphaId = orgAlpha.id;

    const orgBeta = await prisma.organization.create({
      data: {
        code: `BETA_P12_${Date.now()}`,
        name: 'Công ty Beta P12',
      },
    });
    orgBetaId = orgBeta.id;

    // 2. Khởi tạo Người dùng
    const ts = Date.now();
    const superAdminUser = await prisma.user.create({
      data: {
        email: `super_p12_${ts}@corp.com`,
        passwordHash: 'hashed_pw',
        fullName: 'Super Admin P12',
        role: UserRole.SUPER_ADMIN,
        isActive: true,
      },
    });
    superAdmin = {
      id: superAdminUser.id,
      email: superAdminUser.email,
      fullName: superAdminUser.fullName,
      role: UserRole.SUPER_ADMIN,
      organizationId: null,
    };

    const adminAlphaUser = await prisma.user.create({
      data: {
        email: `admin_alpha_${ts}@alpha.com`,
        passwordHash: 'hashed_pw',
        fullName: 'Admin Alpha P12',
        role: UserRole.ADMIN,
        organizationId: orgAlphaId,
        isActive: true,
      },
    });
    adminAlpha = {
      id: adminAlphaUser.id,
      email: adminAlphaUser.email,
      fullName: adminAlphaUser.fullName,
      role: UserRole.ADMIN,
      organizationId: orgAlphaId,
    };

    const userAlphaEntity = await prisma.user.create({
      data: {
        email: `emp_alpha_${ts}@alpha.com`,
        passwordHash: 'hashed_pw',
        fullName: 'Nhân viên Alpha',
        role: UserRole.USER,
        organizationId: orgAlphaId,
        isActive: true,
      },
    });
    userAlpha = {
      id: userAlphaEntity.id,
      email: userAlphaEntity.email,
      fullName: userAlphaEntity.fullName,
      role: UserRole.USER,
      organizationId: orgAlphaId,
    };

    approver1 = await prisma.user.create({
      data: {
        email: `approver1_${ts}@alpha.com`,
        passwordHash: 'hashed_pw',
        fullName: 'Người duyệt 1 Alpha',
        role: UserRole.USER,
        organizationId: orgAlphaId,
        isActive: true,
      },
    });

    approver2 = await prisma.user.create({
      data: {
        email: `approver2_${ts}@alpha.com`,
        passwordHash: 'hashed_pw',
        fullName: 'Người duyệt 2 Alpha',
        role: UserRole.USER,
        organizationId: orgAlphaId,
        isActive: true,
      },
    });

    approverNew = await prisma.user.create({
      data: {
        email: `approver_new_${ts}@alpha.com`,
        passwordHash: 'hashed_pw',
        fullName: 'Người duyệt thay thế Alpha',
        role: UserRole.USER,
        organizationId: orgAlphaId,
        isActive: true,
      },
    });

    approverBeta = await prisma.user.create({
      data: {
        email: `approver_beta_${ts}@beta.com`,
        passwordHash: 'hashed_pw',
        fullName: 'Người duyệt Beta (ngoài tổ chức)',
        role: UserRole.USER,
        organizationId: orgBetaId,
        isActive: true,
      },
    });

    approverInactive = await prisma.user.create({
      data: {
        email: `approver_inactive_${ts}@alpha.com`,
        passwordHash: 'hashed_pw',
        fullName: 'Người duyệt Inactive Alpha',
        role: UserRole.USER,
        organizationId: orgAlphaId,
        isActive: false, // Inactive!
      },
    });

    // 3. Khởi tạo FormTemplate đã Publish
    const template = await prisma.formTemplate.create({
      data: {
        code: `TPL_P12_${ts}`,
        title: 'Mẫu kiểm thử Phase 12 Reassignment & SLA',
        status: TemplateStatus.PUBLISHED,
        organizationId: orgAlphaId,
        createdById: adminAlpha.id,
        fields: [
          { id: 'f1', key: 'title', label: 'Tiêu đề', type: 'text', required: true, order: 1 },
          { id: 'f2', key: 'amount', label: 'Số tiền', type: 'number', required: true, order: 2 },
        ],
        layoutBlocks: [{ id: 'b1', type: 'header', config: { title: 'Đơn' }, order: 1 }],
      },
    });
    testTemplateId = template.id;

    await prisma.formTemplateVersion.create({
      data: {
        templateId: template.id,
        versionNumber: 1,
        title: template.title,
        status: TemplateStatus.PUBLISHED,
        createdById: adminAlpha.id,
        fields: template.fields as any,
        layoutBlocks: template.layoutBlocks as any,
      },
    });

    // 4. Khởi tạo WorkflowTemplate có cấu hình dueDays (SLA)
    const wfTemplate = await prisma.workflowTemplate.create({
      data: {
        code: `WF_P12_${ts}`,
        title: 'Quy trình kiểm thử Phase 12 SLA',
        status: TemplateStatus.PUBLISHED,
        organizationId: orgAlphaId,
        createdById: adminAlpha.id,
        steps: [
          {
            stepKey: 'step_1',
            stepName: 'Bước 1: Trưởng phòng duyệt',
            stepOrder: 1,
            stepType: 'SEQUENTIAL',
            completionRule: 'ALL_MUST_APPROVE',
            dueDays: 2, // SLA 2 ngày
            approverConfig: {
              type: 'SPECIFIC_USERS',
              userIds: [approver1.id, approver2.id],
            },
          },
          {
            stepKey: 'step_2',
            stepName: 'Bước 2: Giám đốc duyệt',
            stepOrder: 2,
            stepType: 'SEQUENTIAL',
            completionRule: 'ANY_CAN_APPROVE',
            dueDays: 5, // SLA 5 ngày
            approverConfig: {
              type: 'SPECIFIC_USERS',
              userIds: [approverNew.id],
            },
          },
        ],
      },
    });
    testWorkflowTemplateId = wfTemplate.id;

    const wfVersion = await prisma.workflowTemplateVersion.create({
      data: {
        workflowTemplateId: wfTemplate.id,
        versionNumber: 1,
        title: wfTemplate.title,
        status: TemplateStatus.PUBLISHED,
        createdById: adminAlpha.id,
        steps: wfTemplate.steps as any,
      },
    });

    await prisma.formTemplate.update({
      where: { id: testTemplateId },
      data: { workflowTemplateId: wfTemplate.id },
    });
    await prisma.formTemplateVersion.updateMany({
      where: { templateId: testTemplateId },
      data: { workflowTemplateVersionId: wfVersion.id },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('1. Reassign Approver (Chuyển giao người duyệt)', () => {
    it('1.1. Chuyển giao thành công trên bước đang chờ duyệt trong ALL_MUST_APPROVE', async () => {
      // Tạo hồ sơ và submit
      const doc = await orchestrator.createDocument({
        templateId: testTemplateId,
        title: 'Hồ sơ thử nghiệm chuyển giao',
        formData: { title: 'Duyệt chi phí', amount: 5000000 },
        userId: userAlpha.id,
        userOrganizationId: orgAlphaId,
        userRole: 'USER',
      });

      await orchestrator.submitDocument({
        documentId: doc.id,
        userId: userAlpha.id,
      });

      // Lấy thông tin bước 1
      const docDetail = await readService.getDocumentDetail(doc.id, adminAlpha);
      const step1 = docDetail.workflow.steps[0];
      expect(step1.status).toBe(StepStatus.IN_PROGRESS);
      expect(step1.assignees.length).toBe(2);

      // Admin Alpha chuyển giao approver1 sang approverNew
      const reassignResult = await orchestrator.reassignApprover({
        documentId: doc.id,
        stepId: step1.id,
        oldUserId: approver1.id,
        newUserId: approverNew.id,
        reason: 'Anh approver1 đi công tác 2 tuần, chuyển giao cho approverNew',
        actorId: adminAlpha.id,
        actorRole: adminAlpha.role,
        actorOrganizationId: adminAlpha.organizationId,
      });

      expect(reassignResult.success).toBe(true);

      // Kiểm tra trong database:
      // 1. StepAssignee được cập nhật sang approverNew
      const updatedDoc = await readService.getDocumentDetail(doc.id, adminAlpha);
      const updatedStep1 = updatedDoc.workflow.steps[0];
      const assigneeIds = updatedStep1.assignees.map((a) => a.userId);
      expect(assigneeIds).toContain(approverNew.id);
      expect(assigneeIds).not.toContain(approver1.id);
      // Approver2 vẫn giữ nguyên vẹn
      expect(assigneeIds).toContain(approver2.id);

      // 2. Lịch sử chuyển giao được lưu lại
      expect(updatedDoc.reassignmentHistories.length).toBe(1);
      const history = updatedDoc.reassignmentHistories[0];
      expect(history.oldUserId).toBe(approver1.id);
      expect(history.newUserId).toBe(approverNew.id);
      expect(history.reassignedById).toBe(adminAlpha.id);
      expect(history.reason).toContain('đi công tác');

      // 3. Thông báo in-app được gửi tới cả hai người
      const notifsNew = await notifService.getUserNotifications(approverNew.id, {});
      expect(notifsNew.items.some((n) => n.type === 'ASSIGNED_STEP')).toBe(true);

      const notifsOld = await notifService.getUserNotifications(approver1.id, {});
      expect(notifsOld.items.some((n) => n.type === 'REASSIGNED_STEP')).toBe(true);

      // 4. AuditLog được ghi lại
      const auditLog = await prisma.auditLog.findFirst({
        where: { documentId: doc.id, action: 'REASSIGN_APPROVER' },
      });
      expect(auditLog).toBeDefined();
      expect(auditLog?.userId).toBe(adminAlpha.id);
    });

    it('1.2. Chặn chuyển giao khi người duyệt cũ đã ra quyết định (Bất biến lịch sử)', async () => {
      const doc = await orchestrator.createDocument({
        templateId: testTemplateId,
        title: 'Hồ sơ test bất biến quyết định',
        formData: { title: 'Đã duyệt 1 phần', amount: 1000000 },
        userId: userAlpha.id,
        userOrganizationId: orgAlphaId,
        userRole: 'USER',
      });
      await orchestrator.submitDocument({ documentId: doc.id, userId: userAlpha.id });

      // approver1 ra quyết định APPROVE
      await orchestrator.processAssigneeDecision({
        documentId: doc.id,
        userId: approver1.id,
        decision: AssigneeDecision.APPROVED,
        decisionComment: 'Tôi đồng ý',
      });

      // Cố tình reassign approver1 sau khi đã approve -> Bị từ chối
      await expect(
        orchestrator.reassignApprover({
          documentId: doc.id,
          oldUserId: approver1.id,
          newUserId: approverNew.id,
          reason: 'Muốn thay người đã duyệt',
          actorId: adminAlpha.id,
          actorRole: adminAlpha.role,
          actorOrganizationId: adminAlpha.organizationId,
        })
      ).rejects.toThrow('Không thể chuyển giao người duyệt đã ra quyết định');
    });

    it('1.3. Chặn chuyển giao khi bước duyệt đã kết thúc (COMPLETED)', async () => {
      const doc = await orchestrator.createDocument({
        templateId: testTemplateId,
        title: 'Hồ sơ test bước đã hoàn tất',
        formData: { title: 'Đã hoàn tất bước 1', amount: 2000000 },
        userId: userAlpha.id,
        userOrganizationId: orgAlphaId,
        userRole: 'USER',
      });
      await orchestrator.submitDocument({ documentId: doc.id, userId: userAlpha.id });

      // Cả 2 approver duyệt để hoàn tất bước 1
      await orchestrator.processAssigneeDecision({
        documentId: doc.id,
        userId: approver1.id,
        decision: AssigneeDecision.APPROVED,
      });
      await orchestrator.processAssigneeDecision({
        documentId: doc.id,
        userId: approver2.id,
        decision: AssigneeDecision.APPROVED,
      });

      const docDetail = await readService.getDocumentDetail(doc.id, adminAlpha);
      const step1 = docDetail.workflow.steps[0];
      expect(step1.status).toBe(StepStatus.COMPLETED);

      // Cố tình chuyển giao trên step1 đã COMPLETED -> Bị từ chối
      await expect(
        orchestrator.reassignApprover({
          documentId: doc.id,
          stepId: step1.id,
          oldUserId: approver2.id,
          newUserId: approverNew.id,
          reason: 'Đổi người khi bước đã xong',
          actorId: adminAlpha.id,
          actorRole: adminAlpha.role,
          actorOrganizationId: adminAlpha.organizationId,
        })
      ).rejects.toThrow('không ở trạng thái đang xử lý');
    });

    it('1.4. Chặn chuyển giao cho người dùng ngoài tổ chức (Tenant Isolation)', async () => {
      const doc = await orchestrator.createDocument({
        templateId: testTemplateId,
        title: 'Hồ sơ test tenant isolation',
        formData: { title: 'Chi nhánh Alpha', amount: 3000000 },
        userId: userAlpha.id,
        userOrganizationId: orgAlphaId,
        userRole: 'USER',
      });
      await orchestrator.submitDocument({ documentId: doc.id, userId: userAlpha.id });

      // Chuyển giao cho approverBeta thuộc công ty Beta
      await expect(
        orchestrator.reassignApprover({
          documentId: doc.id,
          oldUserId: approver1.id,
          newUserId: approverBeta.id,
          reason: 'Ủy nhiệm chéo công ty',
          actorId: adminAlpha.id,
          actorRole: adminAlpha.role,
          actorOrganizationId: adminAlpha.organizationId,
        })
      ).rejects.toThrow('thuộc tổ chức khác');
    });

    it('1.5. Chặn chuyển giao cho người dùng đã bị vô hiệu hóa (Inactive)', async () => {
      const doc = await orchestrator.createDocument({
        templateId: testTemplateId,
        title: 'Hồ sơ test inactive approver',
        formData: { title: 'Thử nghiệm inactive', amount: 4000000 },
        userId: userAlpha.id,
        userOrganizationId: orgAlphaId,
        userRole: 'USER',
      });
      await orchestrator.submitDocument({ documentId: doc.id, userId: userAlpha.id });

      await expect(
        orchestrator.reassignApprover({
          documentId: doc.id,
          oldUserId: approver1.id,
          newUserId: approverInactive.id,
          reason: 'Gán cho người đã nghỉ việc',
          actorId: adminAlpha.id,
          actorRole: adminAlpha.role,
          actorOrganizationId: adminAlpha.organizationId,
        })
      ).rejects.toThrow('đã bị vô hiệu hóa (inactive)');
    });

    it('1.6. Cho phép chính người duyệt thực hiện tự chuyển giao (Self-reassignment)', async () => {
      const doc = await orchestrator.createDocument({
        templateId: testTemplateId,
        title: 'Hồ sơ test self reassignment',
        formData: { title: 'Tự chuyển quyền', amount: 5000000 },
        userId: userAlpha.id,
        userOrganizationId: orgAlphaId,
        userRole: 'USER',
      });
      await orchestrator.submitDocument({ documentId: doc.id, userId: userAlpha.id });

      // approver1 tự chuyển giao quyền của chính mình cho approverNew
      const result = await orchestrator.reassignApprover({
        documentId: doc.id,
        oldUserId: approver1.id,
        newUserId: approverNew.id,
        reason: 'Tôi xin nghỉ phép đột xuất hôm nay',
        actorId: approver1.id, // Self!
        actorRole: UserRole.USER,
        actorOrganizationId: orgAlphaId,
      });

      expect(result.success).toBe(true);
      expect(result.newUserId).toBe(approverNew.id);
    });

    it('1.7. Chặn 403 nếu người dùng thường khác cố tình chuyển giao', async () => {
      const doc = await orchestrator.createDocument({
        templateId: testTemplateId,
        title: 'Hồ sơ test unauthorized reassign',
        formData: { title: 'Trái quyền', amount: 6000000 },
        userId: userAlpha.id,
        userOrganizationId: orgAlphaId,
        userRole: 'USER',
      });
      await orchestrator.submitDocument({ documentId: doc.id, userId: userAlpha.id });

      // userAlpha (người tạo, role USER, không phải approver1) cố tình chuyển giao
      await expect(
        orchestrator.reassignApprover({
          documentId: doc.id,
          oldUserId: approver1.id,
          newUserId: approverNew.id,
          reason: 'Tôi muốn đổi người duyệt hồ sơ của tôi',
          actorId: userAlpha.id,
          actorRole: UserRole.USER,
          actorOrganizationId: orgAlphaId,
        })
      ).rejects.toThrow('Bạn không có quyền chuyển giao người duyệt cho hồ sơ này');
    });

    it('1.8. Xử lý đồng thời hai yêu cầu chuyển giao cạnh tranh (Concurrency Race Condition)', async () => {
      const doc = await orchestrator.createDocument({
        templateId: testTemplateId,
        title: 'Hồ sơ test race condition',
        formData: { title: 'Tranh chấp chuyển giao', amount: 7000000 },
        userId: userAlpha.id,
        userOrganizationId: orgAlphaId,
        userRole: 'USER',
      });
      await orchestrator.submitDocument({ documentId: doc.id, userId: userAlpha.id });

      // Tạo thêm user dự phòng
      const approverAlt = await prisma.user.create({
        data: {
          email: `alt_race_${Date.now()}@alpha.com`,
          passwordHash: 'hash',
          fullName: 'Người duyệt phụ',
          role: UserRole.USER,
          organizationId: orgAlphaId,
          isActive: true,
        },
      });

      // 2 yêu cầu reassign đồng thời trên cùng approver1
      const req1 = orchestrator.reassignApprover({
        documentId: doc.id,
        oldUserId: approver1.id,
        newUserId: approverNew.id,
        reason: 'Yêu cầu 1',
        actorId: adminAlpha.id,
        actorRole: adminAlpha.role,
        actorOrganizationId: adminAlpha.organizationId,
      });

      const req2 = orchestrator.reassignApprover({
        documentId: doc.id,
        oldUserId: approver1.id,
        newUserId: approverAlt.id,
        reason: 'Yêu cầu 2',
        actorId: superAdmin.id,
        actorRole: superAdmin.role,
        actorOrganizationId: superAdmin.organizationId,
      });

      const results = await Promise.allSettled([req1, req2]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Nhờ Pessimistic Lock `FOR UPDATE`, 1 bên sẽ thành công trước, bên kia thất bại do approver1 không còn tồn tại trong step
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0] as PromiseRejectedResult).reason.message).toContain('không phải là người duyệt');
    });
  });

  describe('2. SLA & Thời hạn xử lý (Due Date Tracking)', () => {
    it('2.1. Tính toán chính xác dueDate theo dueDays khi bắt đầu xử lý bước', async () => {
      const beforeSubmit = new Date();
      const doc = await orchestrator.createDocument({
        templateId: testTemplateId,
        title: 'Hồ sơ test SLA due date',
        formData: { title: 'Theo dõi hạn SLA', amount: 8000000 },
        userId: userAlpha.id,
        userOrganizationId: orgAlphaId,
        userRole: 'USER',
      });

      await orchestrator.submitDocument({ documentId: doc.id, userId: userAlpha.id });

      const docDetail = await readService.getDocumentDetail(doc.id, userAlpha);
      const step1 = docDetail.workflow.steps[0];

      // Bước 1 có dueDays = 2 -> dueDate phải là ~ 2 ngày sau
      expect(step1.dueDays).toBe(2);
      expect(step1.dueDate).toBeDefined();

      const dueDate = new Date(step1.dueDate!);
      const expectedMinDate = new Date(beforeSubmit.getTime() + 2 * 24 * 3600 * 1000 - 5000);
      const expectedMaxDate = new Date(beforeSubmit.getTime() + 2 * 24 * 3600 * 1000 + 10000);

      expect(dueDate.getTime()).toBeGreaterThanOrEqual(expectedMinDate.getTime());
      expect(dueDate.getTime()).toBeLessThanOrEqual(expectedMaxDate.getTime());

      // Document.dueDate cũng được đồng bộ với hạn bước 1
      expect(docDetail.dueDate).toBe(step1.dueDate);
      expect(docDetail.isOverdue).toBe(false);
      expect(docDetail.slaStatus).toBe('ON_TRACK');
    });

    it('2.2. Nhận diện chính xác trạng thái quá hạn (OVERDUE) mà không tự động chuyển APPROVED', async () => {
      const doc = await orchestrator.createDocument({
        templateId: testTemplateId,
        title: 'Hồ sơ test trạng thái quá hạn',
        formData: { title: 'Quá hạn SLA', amount: 9000000 },
        userId: userAlpha.id,
        userOrganizationId: orgAlphaId,
        userRole: 'USER',
      });
      await orchestrator.submitDocument({ documentId: doc.id, userId: userAlpha.id });

      // Giả lập lùi dueDate về quá khứ (cách đây 3 ngày)
      const pastDate = new Date(Date.now() - 3 * 24 * 3600 * 1000);
      const step1Record = await prisma.approvalStep.findFirst({
        where: { workflow: { documentId: doc.id }, stepOrder: 1 },
      });

      await prisma.approvalStep.update({
        where: { id: step1Record!.id },
        data: { dueDate: pastDate },
      });
      await prisma.document.update({
        where: { id: doc.id },
        data: { dueDate: pastDate },
      });

      const docDetail = await readService.getDocumentDetail(doc.id, userAlpha);
      const step1 = docDetail.workflow.steps[0];

      // Kiểm tra SLA status
      expect(step1.isOverdue).toBe(true);
      expect(docDetail.isOverdue).toBe(true);
      expect(docDetail.slaStatus).toBe('OVERDUE');

      // Tách bạch trạng thái nghiệp vụ: Document vẫn là IN_REVIEW, không tự phê duyệt
      expect(docDetail.status).toBe(DocumentStatus.IN_REVIEW);
      expect(step1.status).toBe(StepStatus.IN_PROGRESS);
    });

    it('2.3. Chuyển sang bước 2 tính toán lại dueDate mới theo SLA bước 2', async () => {
      const doc = await orchestrator.createDocument({
        templateId: testTemplateId,
        title: 'Hồ sơ test chuyển bước SLA',
        formData: { title: 'Bước 2 SLA 5 ngày', amount: 10000000 },
        userId: userAlpha.id,
        userOrganizationId: orgAlphaId,
        userRole: 'USER',
      });
      await orchestrator.submitDocument({ documentId: doc.id, userId: userAlpha.id });

      // Cả 2 duyệt bước 1
      await orchestrator.processAssigneeDecision({
        documentId: doc.id,
        userId: approver1.id,
        decision: AssigneeDecision.APPROVED,
      });
      const nowBeforeStep2 = new Date();
      await orchestrator.processAssigneeDecision({
        documentId: doc.id,
        userId: approver2.id,
        decision: AssigneeDecision.APPROVED,
      });

      const docDetail = await readService.getDocumentDetail(doc.id, userAlpha);
      expect(docDetail.currentStepOrder).toBe(2);

      const step2 = docDetail.workflow.steps[1];
      expect(step2.status).toBe(StepStatus.IN_PROGRESS);
      expect(step2.dueDays).toBe(5); // SLA bước 2 là 5 ngày

      const step2DueDate = new Date(step2.dueDate!);
      const expectedStep2Min = new Date(nowBeforeStep2.getTime() + 5 * 24 * 3600 * 1000 - 5000);
      expect(step2DueDate.getTime()).toBeGreaterThanOrEqual(expectedStep2Min.getTime());

      // Lịch sử bước 1 vẫn giữ nguyên vẹn thời hạn ban đầu
      const step1 = docDetail.workflow.steps[0];
      expect(step1.status).toBe(StepStatus.COMPLETED);
      expect(step1.dueDate).toBeDefined();
    });
  });
});
