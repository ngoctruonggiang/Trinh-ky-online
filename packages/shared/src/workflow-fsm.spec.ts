import { describe, expect, it } from 'vitest';
import {
  AssigneeDecision,
  AssigneeRole,
  DocumentStatus,
  StepCompletionRule,
  StepStatus,
  StepType,
  WorkflowStatus,
} from './enums.js';
import { SignatureRecord, WorkflowInstance } from './types.js';
import { WorkflowFSM } from './workflow-fsm.js';

describe('WorkflowFSM (Lõi máy trạng thái quy trình duyệt)', () => {
  const createMockWorkflow = (): WorkflowInstance => ({
    id: 'wf-1',
    documentId: 'doc-1',
    status: WorkflowStatus.RUNNING,
    currentStepOrder: 1,
    steps: [
      {
        id: 'step-1',
        workflowId: 'wf-1',
        stepOrder: 1,
        stepName: 'Trưởng phòng thẩm tra',
        stepType: StepType.SEQUENTIAL,
        completionRule: StepCompletionRule.ALL_MUST_APPROVE,
        status: StepStatus.IN_PROGRESS,
        assignees: [
          {
            id: 'asg-1',
            stepId: 'step-1',
            userId: 'user-tp',
            userFullName: 'Trưởng phòng A',
            userEmail: 'tp@company.com',
            role: AssigneeRole.APPROVER,
            decision: AssigneeDecision.PENDING,
          },
          {
            id: 'asg-reviewer',
            stepId: 'step-1',
            userId: 'user-reviewer',
            userFullName: 'Giám sát B',
            userEmail: 'reviewer@company.com',
            role: AssigneeRole.REVIEWER,
            decision: AssigneeDecision.PENDING,
          },
        ],
      },
      {
        id: 'step-2',
        workflowId: 'wf-1',
        stepOrder: 2,
        stepName: 'Ban Giám Đốc Phê Duyệt',
        stepType: StepType.SEQUENTIAL,
        completionRule: StepCompletionRule.ALL_MUST_APPROVE,
        status: StepStatus.WAITING,
        assignees: [
          {
            id: 'asg-2',
            stepId: 'step-2',
            userId: 'user-gd',
            userFullName: 'Giám đốc C',
            userEmail: 'gd@company.com',
            role: AssigneeRole.APPROVER,
            decision: AssigneeDecision.PENDING,
          },
        ],
      },
    ],
  });

  it('1. Duyệt tuần tự: Bước 1 duyệt xong thì chuyển sang Bước 2, Bước 2 duyệt xong thì hoàn tất hồ sơ', () => {
    const wf = createMockWorkflow();

    // Bước 1: Trưởng phòng duyệt
    const res1 = WorkflowFSM.processDecision({
      workflow: wf,
      userId: 'user-tp',
      decision: AssigneeDecision.APPROVED,
      decisionComment: 'Đồng ý duyệt bước 1',
    });

    expect(res1.success).toBe(true);
    expect(res1.newDocumentStatus).toBe(DocumentStatus.IN_REVIEW);
    expect(res1.newWorkflowStatus).toBe(WorkflowStatus.RUNNING);
    expect(res1.updatedWorkflow.currentStepOrder).toBe(2);
    expect(res1.updatedWorkflow.steps[0].status).toBe(StepStatus.COMPLETED);
    expect(res1.updatedWorkflow.steps[1].status).toBe(StepStatus.IN_PROGRESS);
    expect(res1.shouldNotifyUserIds).toContain('user-gd');

    // Bước 2: Giám đốc duyệt (bước cuối)
    const res2 = WorkflowFSM.processDecision({
      workflow: res1.updatedWorkflow,
      userId: 'user-gd',
      decision: AssigneeDecision.APPROVED,
      decisionComment: 'Phê duyệt cuối cùng',
    });

    expect(res2.success).toBe(true);
    expect(res2.newDocumentStatus).toBe(DocumentStatus.APPROVED);
    expect(res2.newWorkflowStatus).toBe(WorkflowStatus.COMPLETED);
    expect(res2.updatedWorkflow.steps[1].status).toBe(StepStatus.COMPLETED);
  });

  it('2. Bước song song ALL_MUST_APPROVE: Cần tất cả người duyệt đồng ý', () => {
    const wf = createMockWorkflow();
    // Thay đổi bước 1 thành song song với 2 người duyệt
    wf.steps[0].stepType = StepType.PARALLEL;
    wf.steps[0].completionRule = StepCompletionRule.ALL_MUST_APPROVE;
    wf.steps[0].assignees = [
      {
        id: 'asg-1a',
        stepId: 'step-1',
        userId: 'user-1a',
        userFullName: 'Phó phòng 1',
        userEmail: 'pp1@company.com',
        role: AssigneeRole.APPROVER,
        decision: AssigneeDecision.PENDING,
      },
      {
        id: 'asg-1b',
        stepId: 'step-1',
        userId: 'user-1b',
        userFullName: 'Phó phòng 2',
        userEmail: 'pp2@company.com',
        role: AssigneeRole.APPROVER,
        decision: AssigneeDecision.PENDING,
      },
    ];

    // Người 1a duyệt -> Bước vẫn IN_PROGRESS, chưa chuyển sang bước 2
    const res1 = WorkflowFSM.processDecision({
      workflow: wf,
      userId: 'user-1a',
      decision: AssigneeDecision.APPROVED,
    });
    expect(res1.success).toBe(true);
    expect(res1.updatedWorkflow.steps[0].status).toBe(StepStatus.IN_PROGRESS);
    expect(res1.updatedWorkflow.currentStepOrder).toBe(1);

    // Người 1b duyệt -> Bước hoàn tất, chuyển sang bước 2
    const res2 = WorkflowFSM.processDecision({
      workflow: res1.updatedWorkflow,
      userId: 'user-1b',
      decision: AssigneeDecision.APPROVED,
    });
    expect(res2.success).toBe(true);
    expect(res2.updatedWorkflow.steps[0].status).toBe(StepStatus.COMPLETED);
    expect(res2.updatedWorkflow.currentStepOrder).toBe(2);
  });

  it('3. Bước song song ANY_CAN_APPROVE: Chỉ cần 1 người duyệt là hoàn thành bước ngay lập tức', () => {
    const wf = createMockWorkflow();
    wf.steps[0].stepType = StepType.PARALLEL;
    wf.steps[0].completionRule = StepCompletionRule.ANY_CAN_APPROVE;
    wf.steps[0].assignees = [
      {
        id: 'asg-1a',
        stepId: 'step-1',
        userId: 'user-1a',
        userFullName: 'Phó phòng 1',
        userEmail: 'pp1@company.com',
        role: AssigneeRole.APPROVER,
        decision: AssigneeDecision.PENDING,
      },
      {
        id: 'asg-1b',
        stepId: 'step-1',
        userId: 'user-1b',
        userFullName: 'Phó phòng 2',
        userEmail: 'pp2@company.com',
        role: AssigneeRole.APPROVER,
        decision: AssigneeDecision.PENDING,
      },
    ];

    // Người 1a duyệt -> Hoàn thành bước ngay lập tức và chuyển bước 2
    const res = WorkflowFSM.processDecision({
      workflow: wf,
      userId: 'user-1a',
      decision: AssigneeDecision.APPROVED,
    });
    expect(res.success).toBe(true);
    expect(res.updatedWorkflow.steps[0].status).toBe(StepStatus.COMPLETED);
    expect(res.updatedWorkflow.currentStepOrder).toBe(2);
  });

  it('4. Từ chối hồ sơ: Quy trình và hồ sơ lập tức chuyển REJECTED, các bước sau bị hủy', () => {
    const wf = createMockWorkflow();

    const res = WorkflowFSM.processDecision({
      workflow: wf,
      userId: 'user-tp',
      decision: AssigneeDecision.REJECTED,
      decisionComment: 'Sai định mức ngân sách',
    });

    expect(res.success).toBe(true);
    expect(res.newDocumentStatus).toBe(DocumentStatus.REJECTED);
    expect(res.newWorkflowStatus).toBe(WorkflowStatus.REJECTED);
    expect(res.updatedWorkflow.steps[0].status).toBe(StepStatus.REJECTED);
    expect(res.updatedWorkflow.steps[1].status).toBe(StepStatus.CANCELLED);
  });

  it('5. Yêu cầu sửa (Revision): Chuyển hồ sơ thành REVISION_REQUESTED và vô hiệu hóa chữ ký cũ', () => {
    const wf = createMockWorkflow();

    const mockSignatures: SignatureRecord[] = [
      {
        id: 'sig-old',
        documentId: 'doc-1',
        versionNumber: 1,
        stepId: 'step-0',
        userId: 'creator-user',
        userFullName: 'Người tạo',
        signatureImageUrl: '/signatures/creator.png',
        contentHash: 'hash-v1',
        signedAt: new Date().toISOString(),
        isValid: true,
      },
    ];

    const res = WorkflowFSM.processDecision({
      workflow: wf,
      userId: 'user-tp',
      decision: AssigneeDecision.REVISION_REQUESTED,
      decisionComment: 'Cần bổ sung hóa đơn đỏ',
      existingSignatures: mockSignatures,
    });

    expect(res.success).toBe(true);
    expect(res.newDocumentStatus).toBe(DocumentStatus.REVISION_REQUESTED);
    expect(res.updatedWorkflow.steps[0].status).toBe(StepStatus.REVISION_REQUESTED);

    // Chữ ký cũ phải bị vô hiệu hóa
    expect(res.invalidatedSignatures).toBeDefined();
    expect(res.invalidatedSignatures![0].isValid).toBe(false);
    expect(res.invalidatedSignatures![0].invalidatedReason).toContain(
      'Vô hiệu hóa do yêu cầu chỉnh sửa'
    );
  });

  it('6. REVIEWER không được phép bấm duyệt hoặc từ chối (Chỉ có quyền xem và bình luận)', () => {
    const wf = createMockWorkflow();

    const res = WorkflowFSM.processDecision({
      workflow: wf,
      userId: 'user-reviewer', // Reviewer
      decision: AssigneeDecision.APPROVED,
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('Người giám sát (REVIEWER) chỉ có quyền xem');
  });

  it('7. startWorkflow: Gửi hồ sơ hợp lệ từ DRAFT -> chuyển IN_REVIEW, Step 1 thành IN_PROGRESS', () => {
    const wf = createMockWorkflow();
    wf.status = WorkflowStatus.PENDING;
    wf.steps[0].status = StepStatus.WAITING;

    const res = WorkflowFSM.startWorkflow({
      workflow: wf,
      documentStatus: DocumentStatus.DRAFT,
    });

    expect(res.success).toBe(true);
    expect(res.newDocumentStatus).toBe(DocumentStatus.IN_REVIEW);
    expect(res.newWorkflowStatus).toBe(WorkflowStatus.RUNNING);
    expect(res.updatedWorkflow.steps[0].status).toBe(StepStatus.IN_PROGRESS);
    expect(res.shouldNotifyUserIds).toContain('user-tp');
  });

  it('8. startWorkflow: Chặn gửi duyệt khi thiếu bước duyệt hoặc tài liệu không phải DRAFT', () => {
    const emptyWf = createMockWorkflow();
    emptyWf.steps = [];

    const res1 = WorkflowFSM.startWorkflow({
      workflow: emptyWf,
      documentStatus: DocumentStatus.DRAFT,
    });
    expect(res1.success).toBe(false);
    expect(res1.error).toContain('Quy trình không có bất kỳ bước duyệt nào');

    const wf = createMockWorkflow();
    const res2 = WorkflowFSM.startWorkflow({
      workflow: wf,
      documentStatus: DocumentStatus.APPROVED,
    });
    expect(res2.success).toBe(false);
    expect(res2.error).toContain('Chỉ có thể gửi duyệt tài liệu ở trạng thái bản nháp');
  });

  it('9. Một Assignee không thể quyết định hai lần (Chống double-decision)', () => {
    const wf = createMockWorkflow();

    // Lần 1: Duyệt thành công
    const res1 = WorkflowFSM.processDecision({
      workflow: wf,
      userId: 'user-tp',
      decision: AssigneeDecision.APPROVED,
    });
    expect(res1.success).toBe(true);

    // Lần 2: Cố tình gọi lại quyết định trên cùng assignee
    const res2 = WorkflowFSM.processDecision({
      workflow: res1.updatedWorkflow,
      userId: 'user-tp',
      decision: AssigneeDecision.APPROVED,
    });
    expect(res2.success).toBe(false);
  });

  it('10. Chặn phê duyệt hồ sơ đã ở trạng thái REJECTED, CANCELLED hoặc APPROVED', () => {
    const wf = createMockWorkflow();

    const resReject = WorkflowFSM.processDecision({
      workflow: wf,
      documentStatus: DocumentStatus.REJECTED,
      userId: 'user-tp',
      decision: AssigneeDecision.APPROVED,
    });
    expect(resReject.success).toBe(false);
    expect(resReject.error).toContain('Không thể thực hiện phê duyệt trên tài liệu đã bị từ chối');

    const resCancel = WorkflowFSM.processDecision({
      workflow: wf,
      documentStatus: DocumentStatus.CANCELLED,
      userId: 'user-tp',
      decision: AssigneeDecision.APPROVED,
    });
    expect(resCancel.success).toBe(false);
    expect(resCancel.error).toContain('Không thể thực hiện phê duyệt trên tài liệu đã bị hủy');

    const resApproved = WorkflowFSM.processDecision({
      workflow: wf,
      documentStatus: DocumentStatus.APPROVED,
      userId: 'user-tp',
      decision: AssigneeDecision.APPROVED,
    });
    expect(resApproved.success).toBe(false);
    expect(resApproved.error).toContain('Tài liệu đã được phê duyệt hoàn tất');
  });

  it('11. resubmitWorkflow: Tái khởi động quy trình từ Bước 1, reset quyết định người duyệt', () => {
    const wf = createMockWorkflow();
    // Giả sử bước 1 đã COMPLETED, bước 2 yêu cầu sửa
    wf.steps[0].status = StepStatus.COMPLETED;
    wf.steps[0].assignees[0].decision = AssigneeDecision.APPROVED;
    wf.steps[1].status = StepStatus.REVISION_REQUESTED;
    wf.steps[1].assignees[0].decision = AssigneeDecision.REVISION_REQUESTED;
    wf.currentStepOrder = 2;

    const res = WorkflowFSM.resubmitWorkflow({
      workflow: wf,
      documentStatus: DocumentStatus.REVISION_REQUESTED,
      resubmittedById: 'author-1',
      changeSummary: 'Cập nhật lại số tiền theo yêu cầu',
    });

    expect(res.success).toBe(true);
    expect(res.newDocumentStatus).toBe(DocumentStatus.IN_REVIEW);
    expect(res.newWorkflowStatus).toBe(WorkflowStatus.RUNNING);
    expect(res.updatedWorkflow.currentStepOrder).toBe(1);

    // Bước 1 phải được kích hoạt lại IN_PROGRESS, assignees reset về PENDING
    expect(res.updatedWorkflow.steps[0].status).toBe(StepStatus.IN_PROGRESS);
    expect(res.updatedWorkflow.steps[0].assignees[0].decision).toBe(AssigneeDecision.PENDING);

    // Bước 2 phải chuyển về WAITING, assignees reset về PENDING
    expect(res.updatedWorkflow.steps[1].status).toBe(StepStatus.WAITING);
    expect(res.updatedWorkflow.steps[1].assignees[0].decision).toBe(AssigneeDecision.PENDING);
    expect(res.shouldNotifyUserIds).toContain('user-tp');
  });

  it('12. resubmitWorkflow: Chặn nộp lại nếu hồ sơ không ở trạng thái REVISION_REQUESTED', () => {
    const wf = createMockWorkflow();

    const res = WorkflowFSM.resubmitWorkflow({
      workflow: wf,
      documentStatus: DocumentStatus.IN_REVIEW, // Không hợp lệ
      resubmittedById: 'author-1',
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('Chỉ có thể nộp lại hồ sơ đang ở trạng thái Yêu cầu chỉnh sửa');
  });

  it('13. cancelWorkflow: Hủy hồ sơ hợp lệ từ IN_REVIEW, đóng các bước còn lại', () => {
    const wf = createMockWorkflow();

    const res = WorkflowFSM.cancelWorkflow({
      workflow: wf,
      documentStatus: DocumentStatus.IN_REVIEW,
      cancelledById: 'creator-user',
      cancelReason: 'Thay đổi kế hoạch công tác',
    });

    expect(res.success).toBe(true);
    expect(res.newDocumentStatus).toBe(DocumentStatus.CANCELLED);
    expect(res.newWorkflowStatus).toBe(WorkflowStatus.CANCELLED);
    expect(res.updatedWorkflow.steps[0].status).toBe(StepStatus.CANCELLED);
    expect(res.updatedWorkflow.steps[1].status).toBe(StepStatus.CANCELLED);
  });

  it('14. cancelWorkflow: Chặn hủy hồ sơ đã APPROVED hoặc REJECTED', () => {
    const wf = createMockWorkflow();

    const resApproved = WorkflowFSM.cancelWorkflow({
      workflow: wf,
      documentStatus: DocumentStatus.APPROVED,
      cancelledById: 'creator-user',
    });
    expect(resApproved.success).toBe(false);
    expect(resApproved.error).toContain('Không thể hủy hồ sơ đã được phê duyệt hoàn tất');

    const resRejected = WorkflowFSM.cancelWorkflow({
      workflow: wf,
      documentStatus: DocumentStatus.REJECTED,
      cancelledById: 'creator-user',
    });
    expect(resRejected.success).toBe(false);
    expect(resRejected.error).toContain('Không thể hủy hồ sơ đã bị từ chối');
  });
});

