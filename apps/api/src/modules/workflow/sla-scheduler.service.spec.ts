import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SlaSchedulerService } from './sla-scheduler.service.js';
import {
  NotificationType,
  NotificationStatus,
  StepStatus,
  WorkflowStatus,
  DocumentStatus,
  AssigneeRole,
  AssigneeDecision,
} from '@trinh-ky/shared';

describe('SlaSchedulerService (Unit Tests)', () => {
  let service: SlaSchedulerService;
  let mockPrisma: any;
  let mockNotificationService: any;

  beforeEach(() => {
    mockPrisma = {
      approvalStep: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      stepAssignee: {
        findMany: vi.fn(),
      },
      notification: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      $transaction: vi.fn().mockImplementation(async (callback) => {
        return await callback({
          $executeRawUnsafe: vi.fn().mockResolvedValue(1),
          approvalStep: mockPrisma.approvalStep,
          stepAssignee: mockPrisma.stepAssignee,
          notification: mockPrisma.notification,
        });
      }),
    };

    mockNotificationService = {
      createNotification: vi.fn(),
    };

    service = new SlaSchedulerService(mockPrisma, mockNotificationService);
  });

  it('1. Bỏ qua các bước duyệt không có hạn xử lý hoặc không có assignee đang chờ', async () => {
    mockPrisma.approvalStep.findMany.mockResolvedValue([
      {
        id: 'step-no-due',
        dueDate: null,
        assignees: [],
        workflow: { document: { id: 'doc-1', documentNumber: 'TK-1', title: 'Doc 1' } },
      },
    ]);

    const result = await service.processSlaChecks();
    expect(result.scannedStepsCount).toBe(1);
    expect(result.warningsSent).toBe(0);
    expect(result.overduesSent).toBe(0);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('2. Bỏ qua các bước duyệt vẫn còn nhiều thời gian (ON_TRACK > 24h)', async () => {
    const now = new Date('2026-10-23T10:00:00.000Z');
    const futureDue = new Date('2026-10-26T10:00:00.000Z'); // 3 ngày nữa

    mockPrisma.approvalStep.findMany.mockResolvedValue([
      {
        id: 'step-on-track',
        stepName: 'Trưởng phòng duyệt',
        dueDate: futureDue,
        assignees: [{ id: 'asg-1', userId: 'user-1', role: AssigneeRole.APPROVER, decision: AssigneeDecision.PENDING }],
        workflow: { document: { id: 'doc-1', documentNumber: 'TK-1', title: 'Doc 1' } },
      },
    ]);

    const result = await service.processSlaChecks(now);
    expect(result.scannedStepsCount).toBe(1);
    expect(result.warningsSent).toBe(0);
    expect(result.overduesSent).toBe(0);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('3. Phát hiện bước sắp đến hạn (NEAR_DUE <= 24h) và gửi SLA_WARNING', async () => {
    const now = new Date('2026-10-23T10:00:00.000Z');
    const nearDue = new Date('2026-10-23T18:00:00.000Z'); // 8 tiếng nữa

    const stepMock = {
      id: 'step-near-due',
      stepName: 'Trưởng phòng duyệt',
      status: StepStatus.IN_PROGRESS,
      dueDate: nearDue,
      slaWarningSentAt: null,
      assignees: [{ id: 'asg-1', userId: 'user-approver-1', role: AssigneeRole.APPROVER, decision: AssigneeDecision.PENDING }],
      workflow: {
        status: WorkflowStatus.RUNNING,
        document: { id: 'doc-1', documentNumber: 'TK-2026-001', title: 'Tạm ứng công tác', status: DocumentStatus.IN_REVIEW },
      },
    };

    mockPrisma.approvalStep.findMany.mockResolvedValue([stepMock]);
    mockPrisma.approvalStep.findUnique.mockResolvedValue(stepMock);
    mockPrisma.stepAssignee.findMany.mockResolvedValue([
      { id: 'asg-1', stepId: 'step-near-due', userId: 'user-approver-1', role: AssigneeRole.APPROVER, decision: AssigneeDecision.PENDING },
    ]);
    mockPrisma.notification.findUnique.mockResolvedValue(null); // Chưa gửi trước đó
    mockPrisma.notification.create.mockResolvedValue({ id: 'notif-1' });

    const result = await service.processSlaChecks(now);

    expect(result.warningsSent).toBe(1);
    expect(result.overduesSent).toBe(0);
    expect(mockPrisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-approver-1',
          documentId: 'doc-1',
          type: NotificationType.SLA_WARNING,
          idempotencyKey: 'SLA_WARNING:step-near-due:user-approver-1',
        }),
      })
    );
    expect(mockPrisma.approvalStep.update).toHaveBeenCalledWith({
      where: { id: 'step-near-due' },
      data: { slaWarningSentAt: now },
    });
  });

  it('4. Phát hiện bước quá hạn (OVERDUE) và gửi SLA_OVERDUE', async () => {
    const now = new Date('2026-10-23T10:00:00.000Z');
    const overdueDate = new Date('2026-10-22T10:00:00.000Z'); // Đã quá hạn 1 ngày

    const stepMock = {
      id: 'step-overdue',
      stepName: 'Kế toán trưởng duyệt',
      status: StepStatus.IN_PROGRESS,
      dueDate: overdueDate,
      slaOverdueSentAt: null,
      assignees: [{ id: 'asg-2', userId: 'user-acc-1', role: AssigneeRole.APPROVER, decision: AssigneeDecision.PENDING }],
      workflow: {
        status: WorkflowStatus.RUNNING,
        document: { id: 'doc-2', documentNumber: 'TK-2026-002', title: 'Thanh toán mua sắm', status: DocumentStatus.IN_REVIEW },
      },
    };

    mockPrisma.approvalStep.findMany.mockResolvedValue([stepMock]);
    mockPrisma.approvalStep.findUnique.mockResolvedValue(stepMock);
    mockPrisma.stepAssignee.findMany.mockResolvedValue([
      { id: 'asg-2', stepId: 'step-overdue', userId: 'user-acc-1', role: AssigneeRole.APPROVER, decision: AssigneeDecision.PENDING },
    ]);
    mockPrisma.notification.findUnique.mockResolvedValue(null);
    mockPrisma.notification.create.mockResolvedValue({ id: 'notif-2' });

    const result = await service.processSlaChecks(now);

    expect(result.overduesSent).toBe(1);
    expect(result.warningsSent).toBe(0);
    expect(mockPrisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-acc-1',
          documentId: 'doc-2',
          type: NotificationType.SLA_OVERDUE,
          idempotencyKey: 'SLA_OVERDUE:step-overdue:user-acc-1',
        }),
      })
    );
    expect(mockPrisma.approvalStep.update).toHaveBeenCalledWith({
      where: { id: 'step-overdue' },
      data: { slaOverdueSentAt: now },
    });
  });

  it('5. Idempotency: Lần quét thứ 2 bỏ qua không tạo thông báo trùng (SKIPPED_DUPLICATE)', async () => {
    const now = new Date('2026-10-23T10:00:00.000Z');
    const overdueDate = new Date('2026-10-22T10:00:00.000Z');

    const stepMock = {
      id: 'step-overdue',
      stepName: 'Kế toán trưởng duyệt',
      status: StepStatus.IN_PROGRESS,
      dueDate: overdueDate,
      slaOverdueSentAt: now,
      assignees: [{ id: 'asg-2', userId: 'user-acc-1', role: AssigneeRole.APPROVER, decision: AssigneeDecision.PENDING }],
      workflow: {
        status: WorkflowStatus.RUNNING,
        document: { id: 'doc-2', documentNumber: 'TK-2026-002', title: 'Thanh toán mua sắm', status: DocumentStatus.IN_REVIEW },
      },
    };

    mockPrisma.approvalStep.findMany.mockResolvedValue([stepMock]);
    mockPrisma.approvalStep.findUnique.mockResolvedValue(stepMock);
    mockPrisma.stepAssignee.findMany.mockResolvedValue([
      { id: 'asg-2', stepId: 'step-overdue', userId: 'user-acc-1', role: AssigneeRole.APPROVER, decision: AssigneeDecision.PENDING },
    ]);
    // Giả lập thông báo đã tồn tại
    mockPrisma.notification.findUnique.mockResolvedValue({
      id: 'notif-already-exists',
      idempotencyKey: 'SLA_OVERDUE:step-overdue:user-acc-1',
    });

    const result = await service.processSlaChecks(now);

    expect(result.overduesSent).toBe(0);
    expect(result.skippedAlreadySent).toBe(1);
    expect(mockPrisma.notification.create).not.toHaveBeenCalled();
  });

  it('6. Chống thao tác lặp khi bước chuyển trạng thái (COMPLETED) trong lúc chờ lock', async () => {
    const now = new Date('2026-10-23T10:00:00.000Z');
    const overdueDate = new Date('2026-10-22T10:00:00.000Z');

    const stepMock = {
      id: 'step-race',
      stepName: 'Kế toán trưởng duyệt',
      status: StepStatus.IN_PROGRESS,
      dueDate: overdueDate,
      assignees: [{ id: 'asg-2', userId: 'user-acc-1', role: AssigneeRole.APPROVER, decision: AssigneeDecision.PENDING }],
      workflow: {
        status: WorkflowStatus.RUNNING,
        document: { id: 'doc-2', documentNumber: 'TK-2026-002', title: 'Thanh toán mua sắm', status: DocumentStatus.IN_REVIEW },
      },
    };

    mockPrisma.approvalStep.findMany.mockResolvedValue([stepMock]);
    // Khi lock xong, kiểm tra lại thì bước đã COMPLETED (do người duyệt vừa bấm duyệt xong)
    mockPrisma.approvalStep.findUnique.mockResolvedValue({
      ...stepMock,
      status: StepStatus.COMPLETED,
    });

    const result = await service.processSlaChecks(now);

    expect(result.overduesSent).toBe(0);
    expect(mockPrisma.notification.create).not.toHaveBeenCalled();
  });

  it('7. Quá hạn SLA tuyệt đối không tự động duyệt hồ sơ (Decoupled SLA state)', async () => {
    const now = new Date('2026-10-23T10:00:00.000Z');
    const overdueDate = new Date('2026-10-20T10:00:00.000Z');

    const stepMock = {
      id: 'step-overdue-no-auto-approve',
      stepName: 'Giám đốc duyệt',
      status: StepStatus.IN_PROGRESS,
      dueDate: overdueDate,
      assignees: [{ id: 'asg-3', userId: 'user-dir-1', role: AssigneeRole.APPROVER, decision: AssigneeDecision.PENDING }],
      workflow: {
        status: WorkflowStatus.RUNNING,
        document: { id: 'doc-3', documentNumber: 'TK-2026-003', title: 'Dự toán quý', status: DocumentStatus.IN_REVIEW },
      },
    };

    mockPrisma.approvalStep.findMany.mockResolvedValue([stepMock]);
    mockPrisma.approvalStep.findUnique.mockResolvedValue(stepMock);
    mockPrisma.stepAssignee.findMany.mockResolvedValue([
      { id: 'asg-3', stepId: stepMock.id, userId: 'user-dir-1', role: AssigneeRole.APPROVER, decision: AssigneeDecision.PENDING },
    ]);
    mockPrisma.notification.findUnique.mockResolvedValue(null);

    await service.processSlaChecks(now);

    // Xác nhận không có thao tác update document hoặc step sang APPROVED
    expect(mockPrisma.approvalStep.update).toHaveBeenCalledWith({
      where: { id: stepMock.id },
      data: { slaOverdueSentAt: now },
    });
    // Tuyệt đối không update document.status
    expect(mockPrisma.approvalStep.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: StepStatus.COMPLETED }) })
    );
  });
});
