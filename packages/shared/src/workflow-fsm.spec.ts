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
});
