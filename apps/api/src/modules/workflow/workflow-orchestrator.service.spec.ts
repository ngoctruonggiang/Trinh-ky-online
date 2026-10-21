import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  AssigneeDecision,
  AssigneeRole,
  AuditAction,
  DocumentStatus,
  StepCompletionRule,
  StepStatus,
  StepType,
  WorkflowStatus,
} from '@trinh-ky/shared';
import { WorkflowOrchestratorService } from './workflow-orchestrator.service.js';

describe('WorkflowOrchestratorService (Điều phối Transaction, Concurrency & Audit)', () => {
  let mockPrisma: any;
  let orchestrator: WorkflowOrchestratorService;

  beforeEach(() => {
    mockPrisma = {
      $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => {
        return await cb(mockPrisma);
      }),
      document: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      approvalWorkflow: {
        update: vi.fn(),
      },
      approvalStep: {
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      stepAssignee: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      documentVersion: {
        create: vi.fn(),
      },
      stepDecisionHistory: {
        create: vi.fn(),
      },
      signatureEvent: {
        create: vi.fn(),
        updateMany: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
    };

    orchestrator = new WorkflowOrchestratorService(mockPrisma);
  });

  const createMockDocumentData = () => ({
    id: 'doc-123',
    status: DocumentStatus.IN_REVIEW,
    currentVersion: 1,
    versions: [
      {
        id: 'ver-1',
        versionNumber: 1,
        formData: { amount: 5000000, reason: 'Tạm ứng công tác' },
        sha256Hash: 'hash-version-1',
      },
    ],
    workflow: {
      id: 'wf-123',
      documentId: 'doc-123',
      status: WorkflowStatus.RUNNING,
      currentStepOrder: 1,
      version: 0,
      steps: [
        {
          id: 'step-1',
          workflowId: 'wf-123',
          stepOrder: 1,
          stepName: 'Trưởng phòng thẩm tra',
          stepType: StepType.SEQUENTIAL,
          completionRule: StepCompletionRule.ALL_MUST_APPROVE,
          status: StepStatus.IN_PROGRESS,
          version: 0,
          assignees: [
            {
              id: 'asg-1',
              stepId: 'step-1',
              userId: 'user-tp',
              role: AssigneeRole.APPROVER,
              decision: AssigneeDecision.PENDING,
            },
            {
              id: 'asg-reviewer',
              stepId: 'step-1',
              userId: 'user-reviewer',
              role: AssigneeRole.REVIEWER,
              decision: AssigneeDecision.PENDING,
            },
          ],
        },
        {
          id: 'step-2',
          workflowId: 'wf-123',
          stepOrder: 2,
          stepName: 'Ban Giám Đốc Phê Duyệt',
          stepType: StepType.SEQUENTIAL,
          completionRule: StepCompletionRule.ALL_MUST_APPROVE,
          status: StepStatus.WAITING,
          version: 0,
          assignees: [
            {
              id: 'asg-2',
              stepId: 'step-2',
              userId: 'user-gd',
              role: AssigneeRole.APPROVER,
              decision: AssigneeDecision.PENDING,
            },
          ],
        },
      ],
    },
    signatureEvents: [],
  });

  it('1. submitDocument: Khởi động quy trình từ DRAFT, cập nhật DB và ghi AuditLog', () => {
    const docData = createMockDocumentData();
    docData.status = DocumentStatus.DRAFT;
    docData.workflow.status = WorkflowStatus.PENDING;
    docData.workflow.steps[0].status = StepStatus.WAITING;

    mockPrisma.document.findUnique.mockResolvedValue(docData);

    return orchestrator
      .submitDocument({
        documentId: 'doc-123',
        userId: 'creator-user',
        ipAddress: '192.168.1.10',
      })
      .then((res) => {
        expect(res.success).toBe(true);
        expect(res.documentStatus).toBe(DocumentStatus.IN_REVIEW);
        expect(res.workflowStatus).toBe(WorkflowStatus.RUNNING);

        // Kiểm tra gọi Document update
        expect(mockPrisma.document.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'doc-123' },
            data: expect.objectContaining({ status: DocumentStatus.IN_REVIEW }),
          })
        );

        // Kiểm tra ghi AuditLog SUBMIT_DOCUMENT
        expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              action: AuditAction.SUBMIT_DOCUMENT,
              documentId: 'doc-123',
              userId: 'creator-user',
            }),
          })
        );
      });
  });

  it('2. processAssigneeDecision: Concurrency guard chặn khi assignee đã duyệt trước đó', async () => {
    const docData = createMockDocumentData();
    mockPrisma.document.findUnique.mockResolvedValue(docData);

    // Mô phỏng conditional update count = 0 (tức là đã có giao dịch khác đổi trạng thái PENDING trước)
    mockPrisma.stepAssignee.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      orchestrator.processAssigneeDecision({
        documentId: 'doc-123',
        userId: 'user-tp',
        decision: AssigneeDecision.APPROVED,
      })
    ).rejects.toThrow('Xung đột tương tranh');
  });

  it('3. processAssigneeDecision: Chặn REVIEWER bấm duyệt', async () => {
    const docData = createMockDocumentData();
    mockPrisma.document.findUnique.mockResolvedValue(docData);

    await expect(
      orchestrator.processAssigneeDecision({
        documentId: 'doc-123',
        userId: 'user-reviewer',
        decision: AssigneeDecision.APPROVED,
      })
    ).rejects.toThrow('REVIEWER');
  });

  it('4. processAssigneeDecision: Duyệt hợp lệ tạo StepDecisionHistory và kích hoạt bước tiếp theo', async () => {
    const docData = createMockDocumentData();
    mockPrisma.document.findUnique.mockResolvedValue(docData);
    mockPrisma.stepAssignee.updateMany.mockResolvedValue({ count: 1 });

    const res = await orchestrator.processAssigneeDecision({
      documentId: 'doc-123',
      userId: 'user-tp',
      decision: AssigneeDecision.APPROVED,
      decisionComment: 'Hồ sơ đầy đủ, đồng ý duyệt',
      signatureImageUrl: '/signatures/user-tp.png',
      ipAddress: '10.0.0.1',
    });

    expect(res.success).toBe(true);
    expect(res.documentStatus).toBe(DocumentStatus.IN_REVIEW);
    expect(res.workflowStatus).toBe(WorkflowStatus.RUNNING);

    // Lưu StepDecisionHistory gắn với DocumentVersion v1
    expect(mockPrisma.stepDecisionHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stepId: 'step-1',
          documentVersionId: 'ver-1',
          userId: 'user-tp',
          decision: AssigneeDecision.APPROVED,
        }),
      })
    );

    // Lưu SignatureEvent
    expect(mockPrisma.signatureEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          documentId: 'doc-123',
          documentVersionId: 'ver-1',
          userId: 'user-tp',
          signatureImageUrl: '/signatures/user-tp.png',
          contentHash: 'hash-version-1',
          isValid: true,
        }),
      })
    );

    // Bước 1 được đánh dấu COMPLETED qua OCC updateMany
    expect(mockPrisma.approvalStep.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'step-1', status: StepStatus.IN_PROGRESS }),
        data: expect.objectContaining({ status: StepStatus.COMPLETED }),
      })
    );

    // Bước 2 được kích hoạt IN_PROGRESS
    expect(mockPrisma.approvalStep.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'step-2' },
        data: expect.objectContaining({ status: StepStatus.IN_PROGRESS }),
      })
    );

    // Ghi AuditLog APPROVE_STEP
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: AuditAction.APPROVE_STEP,
          documentId: 'doc-123',
          userId: 'user-tp',
        }),
      })
    );
  });

  it('5. processAssigneeDecision: Yêu cầu sửa (REVISION_REQUESTED) tự động vô hiệu hóa toàn bộ chữ ký cũ', async () => {
    const docData = createMockDocumentData();
    // Giả sử đã có chữ ký trên version 1
    docData.signatureEvents = [
      {
        id: 'sig-1',
        documentId: 'doc-123',
        documentVersionId: 'ver-1',
        stepId: 'step-0',
        userId: 'creator-user',
        signatureImageUrl: '/signatures/creator.png',
        contentHash: 'hash-version-1',
        signedAt: new Date(),
        isValid: true,
      },
    ] as any;

    mockPrisma.document.findUnique.mockResolvedValue(docData);
    mockPrisma.stepAssignee.updateMany.mockResolvedValue({ count: 1 });

    const res = await orchestrator.processAssigneeDecision({
      documentId: 'doc-123',
      userId: 'user-tp',
      decision: AssigneeDecision.REVISION_REQUESTED,
      decisionComment: 'Cần bổ sung bảng kê chi phí chi tiết',
    });

    expect(res.success).toBe(true);
    expect(res.documentStatus).toBe(DocumentStatus.REVISION_REQUESTED);

    // Chữ ký của version 1 phải được update isValid = false
    expect(mockPrisma.signatureEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          documentId: 'doc-123',
          documentVersionId: 'ver-1',
          isValid: true,
        },
        data: expect.objectContaining({
          isValid: false,
          invalidatedReason: expect.stringContaining('Vô hiệu hóa do yêu cầu chỉnh sửa'),
        }),
      })
    );

    // Ghi AuditLog REQUEST_REVISION
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: AuditAction.REQUEST_REVISION,
          documentId: 'doc-123',
          userId: 'user-tp',
        }),
      })
    );
  });

  it('6. resubmitDocument: Tạo DocumentVersion mới (v2), tính SHA-256 mới, chạy lại từ Step 1', async () => {
    const docData = createMockDocumentData();
    docData.status = DocumentStatus.REVISION_REQUESTED;
    docData.workflow.status = WorkflowStatus.RUNNING;
    docData.workflow.currentStepOrder = 1;
    docData.workflow.steps[0].status = StepStatus.REVISION_REQUESTED;

    mockPrisma.document.findUnique.mockResolvedValue(docData);

    const newFormData = { amount: 6000000, reason: 'Tạm ứng công tác (đã bổ sung bảng kê)' };

    const res = await orchestrator.resubmitDocument({
      documentId: 'doc-123',
      userId: 'creator-user',
      newFormData,
      changeSummary: 'Bổ sung bảng kê chi phí theo yêu cầu của Trưởng phòng',
    });

    expect(res.success).toBe(true);
    expect(res.newVersionNumber).toBe(2);
    expect(res.documentStatus).toBe(DocumentStatus.IN_REVIEW);
    expect(res.workflowStatus).toBe(WorkflowStatus.RUNNING);

    // Tạo DocumentVersion v2 mới
    expect(mockPrisma.documentVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          documentId: 'doc-123',
          versionNumber: 2,
          formData: newFormData,
          changeSummary: 'Bổ sung bảng kê chi phí theo yêu cầu của Trưởng phòng',
          createdById: 'creator-user',
        }),
      })
    );

    // Reset Bước 1 thành IN_PROGRESS
    expect(mockPrisma.approvalStep.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'step-1' },
        data: expect.objectContaining({ status: StepStatus.IN_PROGRESS }),
      })
    );

    // Reset Assignee bước 1 về PENDING
    expect(mockPrisma.stepAssignee.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stepId: 'step-1' },
        data: expect.objectContaining({ decision: AssigneeDecision.PENDING }),
      })
    );

    // Reset Bước 2 thành WAITING
    expect(mockPrisma.approvalStep.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'step-2' },
        data: expect.objectContaining({ status: StepStatus.WAITING }),
      })
    );

    // Ghi AuditLog RESUBMIT_DOCUMENT
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: AuditAction.RESUBMIT_DOCUMENT,
          documentId: 'doc-123',
          userId: 'creator-user',
        }),
      })
    );
  });

  it('7. cancelDocument: Hủy tài liệu thành công từ IN_REVIEW và ghi AuditLog', async () => {
    const docData = createMockDocumentData();
    mockPrisma.document.findUnique.mockResolvedValue(docData);

    const res = await orchestrator.cancelDocument({
      documentId: 'doc-123',
      userId: 'creator-user',
      cancelReason: 'Không còn nhu cầu tạm ứng',
    });

    expect(res.success).toBe(true);
    expect(res.documentStatus).toBe(DocumentStatus.CANCELLED);
    expect(res.workflowStatus).toBe(WorkflowStatus.CANCELLED);

    expect(mockPrisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'doc-123' },
        data: expect.objectContaining({ status: DocumentStatus.CANCELLED }),
      })
    );

    expect(mockPrisma.approvalWorkflow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wf-123' },
        data: expect.objectContaining({ status: WorkflowStatus.CANCELLED }),
      })
    );

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: AuditAction.CANCEL_DOCUMENT,
          documentId: 'doc-123',
          userId: 'creator-user',
        }),
      })
    );
  });

  it('8. cancelDocument: Chặn hủy hồ sơ đã APPROVED', async () => {
    const docData = createMockDocumentData();
    docData.status = DocumentStatus.APPROVED;
    mockPrisma.document.findUnique.mockResolvedValue(docData);

    await expect(
      orchestrator.cancelDocument({
        documentId: 'doc-123',
        userId: 'creator-user',
      })
    ).rejects.toThrow('Không thể hủy hồ sơ đã được phê duyệt hoàn tất');
  });

  it('9. Tính toàn vẹn Transaction: Lỗi khi ghi audit hoặc DB sẽ làm rollback toàn bộ giao dịch', async () => {
    const docData = createMockDocumentData();
    mockPrisma.document.findUnique.mockResolvedValue(docData);
    mockPrisma.stepAssignee.updateMany.mockResolvedValue({ count: 1 });

    // Giả lập lỗi ở bước ghi AuditLog
    mockPrisma.auditLog.create.mockRejectedValue(new Error('Lỗi kết nối cơ sở dữ liệu khi ghi AuditLog'));

    await expect(
      orchestrator.processAssigneeDecision({
        documentId: 'doc-123',
        userId: 'user-tp',
        decision: AssigneeDecision.APPROVED,
      })
    ).rejects.toThrow('Lỗi kết nối cơ sở dữ liệu khi ghi AuditLog');
  });
});
