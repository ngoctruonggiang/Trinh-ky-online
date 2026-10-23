import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { SlaSchedulerService } from '../src/modules/workflow/sla-scheduler.service.js';
import { NotificationService } from '../src/modules/notification/notification.service.js';
import {
  DocumentStatus,
  StepStatus,
  WorkflowStatus,
  NotificationType,
  AssigneeRole,
  AssigneeDecision,
  TemplateStatus,
  StepCompletionRule,
  StepType,
} from '@trinh-ky/shared';

describe('Phase 12.0.1: SLA Scheduler, Notification Reliability & Idempotency (Real PostgreSQL)', () => {
  let prisma: PrismaClient;
  let notificationService: NotificationService;
  let slaSchedulerService: SlaSchedulerService;

  const testSuffix = Date.now().toString().slice(-6);
  let orgAlphaId: string;
  let orgBetaId: string;
  let userAlpha1Id: string;
  let userAlpha2Id: string;
  let userBeta1Id: string;
  let workflowTemplateId: string;
  let workflowVersionId: string;
  let formTemplateId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    notificationService = new NotificationService(prisma as any);
    slaSchedulerService = new SlaSchedulerService(prisma as any, notificationService);

    // 1. Tạo tổ chức Alpha và Beta
    const orgAlpha = await prisma.organization.create({
      data: {
        code: `ORG_A_${testSuffix}`,
        name: `Tập đoàn Alpha ${testSuffix}`,
      },
    });
    orgAlphaId = orgAlpha.id;

    const orgBeta = await prisma.organization.create({
      data: {
        code: `ORG_B_${testSuffix}`,
        name: `Tập đoàn Beta ${testSuffix}`,
      },
    });
    orgBetaId = orgBeta.id;

    // 2. Tạo Users
    const uAlpha1 = await prisma.user.create({
      data: {
        email: `alpha1_${testSuffix}@vinagroup.vn`,
        fullName: `Nguyễn Văn Alpha 1 ${testSuffix}`,
        passwordHash: 'dummy_hash',
        role: 'USER',
        organizationId: orgAlphaId,
        isActive: true,
      },
    });
    userAlpha1Id = uAlpha1.id;

    const uAlpha2 = await prisma.user.create({
      data: {
        email: `alpha2_${testSuffix}@vinagroup.vn`,
        fullName: `Trần Thị Alpha 2 ${testSuffix}`,
        passwordHash: 'dummy_hash',
        role: 'USER',
        organizationId: orgAlphaId,
        isActive: true,
      },
    });
    userAlpha2Id = uAlpha2.id;

    const uBeta1 = await prisma.user.create({
      data: {
        email: `beta1_${testSuffix}@vinagroup.vn`,
        fullName: `Lê Văn Beta 1 ${testSuffix}`,
        passwordHash: 'dummy_hash',
        role: 'USER',
        organizationId: orgBetaId,
        isActive: true,
      },
    });
    userBeta1Id = uBeta1.id;

    // 3. Tạo WorkflowTemplate có dueDays = 2 ngày
    const wfTpl = await prisma.workflowTemplate.create({
      data: {
        code: `WF_SLA_${testSuffix}`,
        title: `Quy trình kiểm thử SLA ${testSuffix}`,
        status: TemplateStatus.PUBLISHED,
        createdById: userAlpha1Id,
        organizationId: orgAlphaId,
        steps: [
          {
            stepOrder: 1,
            stepName: 'Trưởng phòng duyệt SLA',
            stepType: StepType.SEQUENTIAL,
            completionRule: StepCompletionRule.ALL_MUST_APPROVE,
            dueDays: 2,
            approverConfig: {
              type: 'SPECIFIC_USERS',
              userIds: [userAlpha1Id],
            },
          },
        ],
      },
    });
    workflowTemplateId = wfTpl.id;

    const wfVer = await prisma.workflowTemplateVersion.create({
      data: {
        workflowTemplateId: wfTpl.id,
        versionNumber: 1,
        title: wfTpl.title,
        status: TemplateStatus.PUBLISHED,
        createdById: userAlpha1Id,
        steps: wfTpl.steps as any,
      },
    });
    workflowVersionId = wfVer.id;

    // 4. Tạo FormTemplate
    const formTpl = await prisma.formTemplate.create({
      data: {
        code: `FORM_SLA_${testSuffix}`,
        title: `Mẫu biểu SLA ${testSuffix}`,
        createdById: userAlpha1Id,
        organizationId: orgAlphaId,
        status: TemplateStatus.PUBLISHED,
        workflowTemplateId: wfTpl.id,
        fields: [],
        layoutBlocks: [],
      },
    });
    formTemplateId = formTpl.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /**
   * Helper tạo hồ sơ với bước duyệt có dueDate tùy chỉnh
   */
  async function createTestDocumentWithStep(params: {
    title: string;
    docNumber: string;
    dueDate: Date;
    assigneeUserId: string;
    stepStatus?: StepStatus;
    docStatus?: DocumentStatus;
    workflowStatus?: WorkflowStatus;
  }) {
    const doc = await prisma.document.create({
      data: {
        documentNumber: params.docNumber,
        title: params.title,
        templateId: formTemplateId,
        workflowTemplateVersionId: workflowVersionId,
        status: params.docStatus || DocumentStatus.IN_REVIEW,
        dueDate: params.dueDate,
        currentStepOrder: 1,
        currentVersion: 1,
        createdById: userAlpha1Id,
        organizationId: orgAlphaId,
      },
    });

    const workflow = await prisma.approvalWorkflow.create({
      data: {
        documentId: doc.id,
        status: params.workflowStatus || WorkflowStatus.RUNNING,
        currentStepOrder: 1,
      },
    });

    const step = await prisma.approvalStep.create({
      data: {
        workflowId: workflow.id,
        stepOrder: 1,
        stepName: 'Cấp thẩm quyền xét duyệt SLA',
        status: params.stepStatus || StepStatus.IN_PROGRESS,
        dueDate: params.dueDate,
        dueDays: 2,
        startedAt: new Date(params.dueDate.getTime() - 2 * 24 * 60 * 60 * 1000),
      },
    });

    await prisma.stepAssignee.create({
      data: {
        stepId: step.id,
        userId: params.assigneeUserId,
        role: AssigneeRole.APPROVER,
        decision: AssigneeDecision.PENDING,
      },
    });

    return { doc, workflow, step };
  }

  let doc1DocId: string;
  let doc2DocId: string;

  it('1. Quét SLA trên PostgreSQL thật: Gửi SLA_WARNING và SLA_OVERDUE với idempotencyKey chuẩn xác', async () => {
    const now = new Date();
    // Hồ sơ 1: Hạn xử lý trong 6 giờ tới -> Sắp đến hạn (NEAR_DUE)
    const nearDueDate = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    const doc1 = await createTestDocumentWithStep({
      title: 'Hồ sơ sắp đến hạn',
      docNumber: `TK-NEAR-${testSuffix}`,
      dueDate: nearDueDate,
      assigneeUserId: userAlpha1Id,
    });
    doc1DocId = doc1.doc.id;

    // Hồ sơ 2: Hạn xử lý 12 giờ trước -> Quá hạn (OVERDUE)
    const overDueDate = new Date(now.getTime() - 12 * 60 * 60 * 1000);
    const doc2 = await createTestDocumentWithStep({
      title: 'Hồ sơ đã quá hạn',
      docNumber: `TK-OVER-${testSuffix}`,
      dueDate: overDueDate,
      assigneeUserId: userAlpha2Id,
    });
    doc2DocId = doc2.doc.id;

    const summary = await slaSchedulerService.processSlaChecks(now);

    expect(summary.warningsSent).toBeGreaterThanOrEqual(1);
    expect(summary.overduesSent).toBeGreaterThanOrEqual(1);

    // Kiểm tra thông báo trong CSDL PostgreSQL
    const notif1 = await prisma.notification.findUnique({
      where: { idempotencyKey: `SLA_WARNING:${doc1.step.id}:${userAlpha1Id}` },
    });
    expect(notif1).not.toBeNull();
    expect(notif1?.type).toBe(NotificationType.SLA_WARNING);
    expect(notif1?.userId).toBe(userAlpha1Id);
    expect(notif1?.documentId).toBe(doc1.doc.id);

    const notif2 = await prisma.notification.findUnique({
      where: { idempotencyKey: `SLA_OVERDUE:${doc2.step.id}:${userAlpha2Id}` },
    });
    expect(notif2).not.toBeNull();
    expect(notif2?.type).toBe(NotificationType.SLA_OVERDUE);
    expect(notif2?.userId).toBe(userAlpha2Id);
    expect(notif2?.documentId).toBe(doc2.doc.id);

    // Kiểm tra timestamp được cập nhật trên ApprovalStep
    const updatedStep1 = await prisma.approvalStep.findUnique({ where: { id: doc1.step.id } });
    expect(updatedStep1?.slaWarningSentAt).not.toBeNull();

    const updatedStep2 = await prisma.approvalStep.findUnique({ where: { id: doc2.step.id } });
    expect(updatedStep2?.slaOverdueSentAt).not.toBeNull();
  });

  it('2. Idempotency (Scheduler chạy lặp): Không tạo trùng thông báo cho cùng một bước duyệt', async () => {
    const now = new Date();

    // Lấy số lượng thông báo của 2 hồ sơ trên
    const initialCount = await prisma.notification.count({
      where: { documentId: { in: [doc1DocId, doc2DocId] } },
    });
    expect(initialCount).toBe(2);

    // Chạy lại scheduler lần 2
    const summary2 = await slaSchedulerService.processSlaChecks(now);
    expect(summary2.warningsSent).toBe(0);
    expect(summary2.overduesSent).toBe(0);
    expect(summary2.skippedAlreadySent).toBeGreaterThanOrEqual(2);

    // Chạy lại scheduler lần 3
    const summary3 = await slaSchedulerService.processSlaChecks(now);
    expect(summary3.warningsSent).toBe(0);
    expect(summary3.overduesSent).toBe(0);

    // Tổng số thông báo của 2 hồ sơ không đổi
    const finalCount = await prisma.notification.count({
      where: { documentId: { in: [doc1DocId, doc2DocId] } },
    });
    expect(finalCount).toBe(initialCount);
  });

  it('3. Concurrency Lock: 2 worker chạy đồng thời không gửi lặp thông báo và không gây deadlock', async () => {
    const now = new Date();
    const overDueDate = new Date(now.getTime() - 8 * 60 * 60 * 1000);
    const docConcurrent = await createTestDocumentWithStep({
      title: 'Hồ sơ test concurrency workers',
      docNumber: `TK-CONC-${testSuffix}`,
      dueDate: overDueDate,
      assigneeUserId: userAlpha1Id,
    });

    // Chạy đồng thời 2 worker
    const [res1, res2] = await Promise.all([
      slaSchedulerService.processSlaChecks(now),
      slaSchedulerService.processSlaChecks(now),
    ]);

    // Tổng số overdueSent giữa 2 worker cho hồ sơ này đúng bằng 1
    const matchingDetail1 = res1.details.find((d) => d.stepId === docConcurrent.step.id && d.status === 'SENT');
    const matchingDetail2 = res2.details.find((d) => d.stepId === docConcurrent.step.id && d.status === 'SENT');

    const totalSent = (matchingDetail1 ? 1 : 0) + (matchingDetail2 ? 1 : 0);
    expect(totalSent).toBe(1);

    // Kiểm tra trong PostgreSQL chỉ có đúng 1 bản ghi
    const notifs = await prisma.notification.findMany({
      where: { idempotencyKey: `SLA_OVERDUE:${docConcurrent.step.id}:${userAlpha1Id}` },
    });
    expect(notifs.length).toBe(1);
  });

  it('4. Race condition: Bước duyệt chuyển sang COMPLETED trong lúc scheduler quét thì tự động bỏ qua', async () => {
    const now = new Date();
    const overDueDate = new Date(now.getTime() - 4 * 60 * 60 * 1000);
    const docRace = await createTestDocumentWithStep({
      title: 'Hồ sơ hoàn tất giữa chừng',
      docNumber: `TK-RACE-${testSuffix}`,
      dueDate: overDueDate,
      assigneeUserId: userAlpha2Id,
    });

    // Chuyển bước sang COMPLETED trước khi scheduler giao dịch
    await prisma.approvalStep.update({
      where: { id: docRace.step.id },
      data: { status: StepStatus.COMPLETED, completedAt: now },
    });

    const summary = await slaSchedulerService.processSlaChecks(now);

    // Không gửi thông báo cho bước đã COMPLETED
    const notif = await prisma.notification.findUnique({
      where: { idempotencyKey: `SLA_OVERDUE:${docRace.step.id}:${userAlpha2Id}` },
    });
    expect(notif).toBeNull();
  });

  it('5. Restart Resilience & Rollback: Transaction bị hủy không để lại bản ghi rác và lần chạy sau vẫn gửi được', async () => {
    const now = new Date();
    const overDueDate = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const docRollback = await createTestDocumentWithStep({
      title: 'Hồ sơ test restart rollback',
      docNumber: `TK-ROLL-${testSuffix}`,
      dueDate: overDueDate,
      assigneeUserId: userAlpha1Id,
    });

    // Giả lập transaction bị crash/restart
    try {
      await prisma.$transaction(async (tx) => {
        await tx.notification.create({
          data: {
            userId: userAlpha1Id,
            documentId: docRollback.doc.id,
            type: NotificationType.SLA_OVERDUE,
            title: 'Cảnh báo crash',
            content: 'Nội dung crash',
            idempotencyKey: `SLA_OVERDUE:${docRollback.step.id}:${userAlpha1Id}`,
            status: 'SENT',
          },
        });
        throw new Error('SIMULATED_SERVER_CRASH_OR_RESTART');
      });
    } catch (e: any) {
      expect(e.message).toBe('SIMULATED_SERVER_CRASH_OR_RESTART');
    }

    // Xác minh rollback: Bản ghi không tồn tại trong DB
    const notifBefore = await prisma.notification.findUnique({
      where: { idempotencyKey: `SLA_OVERDUE:${docRollback.step.id}:${userAlpha1Id}` },
    });
    expect(notifBefore).toBeNull();

    // Lần chạy tiếp theo của scheduler khôi phục bình thường
    const summary = await slaSchedulerService.processSlaChecks(now);
    const matching = summary.details.find(
      (d) => d.stepId === docRollback.step.id && d.status === 'SENT'
    );
    expect(matching).toBeDefined();

    const notifAfter = await prisma.notification.findUnique({
      where: { idempotencyKey: `SLA_OVERDUE:${docRollback.step.id}:${userAlpha1Id}` },
    });
    expect(notifAfter).not.toBeNull();
  });

  it('6. Quá hạn SLA tuyệt đối không tự động duyệt hồ sơ (Decoupled SLA state)', async () => {
    const now = new Date();
    const overDueDate = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const docCheck = await createTestDocumentWithStep({
      title: 'Hồ sơ quá hạn 2 ngày',
      docNumber: `TK-NOAUTO-${testSuffix}`,
      dueDate: overDueDate,
      assigneeUserId: userAlpha1Id,
    });

    await slaSchedulerService.processSlaChecks(now);

    const docInDb = await prisma.document.findUnique({ where: { id: docCheck.doc.id } });
    expect(docInDb?.status).toBe(DocumentStatus.IN_REVIEW); // Vẫn IN_REVIEW, không phải APPROVED

    const stepInDb = await prisma.approvalStep.findUnique({ where: { id: docCheck.step.id } });
    expect(stepInDb?.status).toBe(StepStatus.IN_PROGRESS); // Vẫn IN_PROGRESS, không phải COMPLETED
  });

  it('7. Bảo mật Notification API: Chặn User A thao tác trên thông báo của User B (403 Forbidden)', async () => {
    // Tạo 1 thông báo cho user Alpha 1
    const notifA = await notificationService.createNotification({
      userId: userAlpha1Id,
      type: NotificationType.ASSIGNED_STEP,
      title: 'Thông báo Alpha 1',
      content: 'Chỉ Alpha 1 được đọc',
      idempotencyKey: `SECURITY_TEST_1_${testSuffix}`,
    });

    // User Alpha 2 cố tình đọc thông báo của User Alpha 1 -> 403 Forbidden
    await expect(
      notificationService.markAsRead(userAlpha2Id, notifA.id)
    ).rejects.toThrow('Bạn không có quyền thao tác trên thông báo này.');

    // User Beta 1 khác công ty cũng bị chặn 403 Forbidden
    await expect(
      notificationService.markAsRead(userBeta1Id, notifA.id)
    ).rejects.toThrow('Bạn không có quyền thao tác trên thông báo này.');

    // Thông báo không tồn tại -> 404 NotFound
    await expect(
      notificationService.markAsRead(userAlpha1Id, 'non-existent-uuid')
    ).rejects.toThrow('Không tìm thấy thông báo.');

    // Chính User Alpha 1 đánh dấu đã đọc -> Thành công
    const readResult = await notificationService.markAsRead(userAlpha1Id, notifA.id);
    expect(readResult.isRead).toBe(true);
    expect(readResult.readAt).not.toBeNull();
  });

  it('8. Phân trang, bộ lọc isRead và cách ly thông báo giữa các người dùng', async () => {
    // Lấy danh sách của user Alpha 2
    const listA2 = await notificationService.getUserNotifications(userAlpha2Id, { page: 1, limit: 10 });
    // Không chứa bất kỳ thông báo nào của user Alpha 1
    for (const item of listA2.items) {
      expect(item.userId).toBe(userAlpha2Id);
    }

    // Đánh dấu tất cả đã đọc cho User Alpha 2
    const markAllRes = await notificationService.markAllAsRead(userAlpha2Id);
    expect(markAllRes.success).toBe(true);

    const unreadCountA2 = await notificationService.getUnreadCount(userAlpha2Id);
    expect(unreadCountA2).toBe(0);
  });
});
