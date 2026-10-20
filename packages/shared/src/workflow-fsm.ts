import {
  AssigneeDecision,
  AssigneeRole,
  DocumentStatus,
  StepCompletionRule,
  StepStatus,
  StepType,
  WorkflowStatus,
} from './enums.js';
import {
  FSMTransitionResult,
  SignatureRecord,
  WorkflowAssignee,
  WorkflowInstance,
  WorkflowStep,
} from './types.js';

export class WorkflowFSM {
  /**
   * Kiểm tra quyền của một người dùng trên bước hiện tại
   */
  public static getAssigneeInCurrentStep(
    workflow: WorkflowInstance,
    userId: string
  ): { step: WorkflowStep; assignee: WorkflowAssignee } | null {
    const currentStep = workflow.steps.find(
      (s) => s.stepOrder === workflow.currentStepOrder
    );
    if (!currentStep || currentStep.status !== StepStatus.IN_PROGRESS) {
      return null;
    }

    const assignee = currentStep.assignees.find((a) => a.userId === userId);
    if (!assignee) return null;

    return { step: currentStep, assignee };
  }

  /**
   * Xử lý quyết định của một Assignee trong bước hiện tại
   */
  public static processDecision(params: {
    workflow: WorkflowInstance;
    userId: string;
    decision: AssigneeDecision;
    decisionComment?: string;
    existingSignatures?: SignatureRecord[];
    nowISO?: string;
  }): FSMTransitionResult {
    const {
      workflow,
      userId,
      decision,
      decisionComment,
      existingSignatures = [],
      nowISO = new Date().toISOString(),
    } = params;

    // Clone workflow để đảm bảo tính bất biến (immutability) trong tính toán FSM
    const updatedWorkflow: WorkflowInstance = JSON.parse(JSON.stringify(workflow));

    const currentStep = updatedWorkflow.steps.find(
      (s) => s.stepOrder === updatedWorkflow.currentStepOrder
    );

    if (!currentStep) {
      return {
        success: false,
        error: `Không tìm thấy bước duyệt thứ ${updatedWorkflow.currentStepOrder}`,
        newDocumentStatus: DocumentStatus.IN_REVIEW,
        newWorkflowStatus: updatedWorkflow.status,
        updatedWorkflow,
        shouldNotifyUserIds: [],
      };
    }

    if (currentStep.status !== StepStatus.IN_PROGRESS) {
      return {
        success: false,
        error: `Bước duyệt "${currentStep.stepName}" không ở trạng thái đang xử lý (IN_PROGRESS)`,
        newDocumentStatus: DocumentStatus.IN_REVIEW,
        newWorkflowStatus: updatedWorkflow.status,
        updatedWorkflow,
        shouldNotifyUserIds: [],
      };
    }

    const assignee = currentStep.assignees.find((a) => a.userId === userId);
    if (!assignee) {
      return {
        success: false,
        error: `Người dùng ${userId} không được phân công trong bước "${currentStep.stepName}"`,
        newDocumentStatus: DocumentStatus.IN_REVIEW,
        newWorkflowStatus: updatedWorkflow.status,
        updatedWorkflow,
        shouldNotifyUserIds: [],
      };
    }

    // REVIEWER chỉ có quyền xem và bình luận, KHÔNG được phép duyệt / từ chối / yêu cầu sửa
    if (assignee.role === AssigneeRole.REVIEWER) {
      return {
        success: false,
        error: `Người giám sát (REVIEWER) chỉ có quyền xem và bình luận, không có thẩm quyền ra quyết định phê duyệt.`,
        newDocumentStatus: DocumentStatus.IN_REVIEW,
        newWorkflowStatus: updatedWorkflow.status,
        updatedWorkflow,
        shouldNotifyUserIds: [],
      };
    }

    if (assignee.decision !== AssigneeDecision.PENDING) {
      return {
        success: false,
        error: `Người duyệt đã thực hiện thao tác trước đó (${assignee.decision})`,
        newDocumentStatus: DocumentStatus.IN_REVIEW,
        newWorkflowStatus: updatedWorkflow.status,
        updatedWorkflow,
        shouldNotifyUserIds: [],
      };
    }

    // Cập nhật quyết định của người duyệt
    assignee.decision = decision;
    assignee.decisionComment = decisionComment;
    assignee.decidedAt = nowISO;

    // 1. Trường hợp: TỪ CHỐI (REJECTED)
    if (decision === AssigneeDecision.REJECTED) {
      currentStep.status = StepStatus.REJECTED;
      currentStep.completedAt = nowISO;
      updatedWorkflow.status = WorkflowStatus.REJECTED;
      updatedWorkflow.completedAt = nowISO;

      // Hủy tất cả các bước còn lại chưa chạy
      updatedWorkflow.steps.forEach((s) => {
        if (s.stepOrder > currentStep.stepOrder) {
          s.status = StepStatus.CANCELLED;
        }
      });

      return {
        success: true,
        newDocumentStatus: DocumentStatus.REJECTED,
        newWorkflowStatus: WorkflowStatus.REJECTED,
        updatedWorkflow,
        shouldNotifyUserIds: currentStep.assignees.map((a) => a.userId),
      };
    }

    // 2. Trường hợp: YÊU CẦU SỬA (REVISION_REQUESTED)
    if (decision === AssigneeDecision.REVISION_REQUESTED) {
      currentStep.status = StepStatus.REVISION_REQUESTED;

      // Vô hiệu hóa các chữ ký đã ký trước đó do tài liệu sẽ bị sửa đổi
      const invalidatedSignatures: SignatureRecord[] = existingSignatures.map((sig) => {
        if (sig.isValid) {
          return {
            ...sig,
            isValid: false,
            invalidatedReason: `Vô hiệu hóa do yêu cầu chỉnh sửa từ bước: ${currentStep.stepName} (${decisionComment || 'Không có ghi chú'})`,
            invalidatedAt: nowISO,
          };
        }
        return sig;
      });

      return {
        success: true,
        newDocumentStatus: DocumentStatus.REVISION_REQUESTED,
        newWorkflowStatus: WorkflowStatus.RUNNING,
        updatedWorkflow,
        shouldNotifyUserIds: currentStep.assignees.map((a) => a.userId),
        invalidatedSignatures,
      };
    }

    // 3. Trường hợp: ĐỒNG Ý / PHÊ DUYỆT (APPROVED)
    const approvers = currentStep.assignees.filter(
      (a) => a.role === AssigneeRole.APPROVER
    );
    const approvedCount = approvers.filter(
      (a) => a.decision === AssigneeDecision.APPROVED
    ).length;

    let isStepComplete = false;
    if (currentStep.stepType === StepType.PARALLEL) {
      if (currentStep.completionRule === StepCompletionRule.ANY_CAN_APPROVE) {
        // Chỉ cần 1 người duyệt là hoàn thành bước
        isStepComplete = approvedCount >= 1;
      } else {
        // ALL_MUST_APPROVE: tất cả approver phải duyệt
        isStepComplete = approvedCount === approvers.length;
      }
    } else {
      // SEQUENTIAL: tất cả approver trong bước phải hoàn thành
      isStepComplete = approvedCount === approvers.length;
    }

    if (!isStepComplete) {
      // Bước vẫn đang chờ những người còn lại
      return {
        success: true,
        newDocumentStatus: DocumentStatus.IN_REVIEW,
        newWorkflowStatus: WorkflowStatus.RUNNING,
        updatedWorkflow,
        shouldNotifyUserIds: [],
      };
    }

    // Bước hiện tại đã hoàn tất!
    currentStep.status = StepStatus.COMPLETED;
    currentStep.completedAt = nowISO;

    // Kiểm tra xem có bước tiếp theo không
    const nextStep = updatedWorkflow.steps.find(
      (s) => s.stepOrder === currentStep.stepOrder + 1
    );

    if (nextStep) {
      // Chuyển sang bước kế tiếp
      nextStep.status = StepStatus.IN_PROGRESS;
      nextStep.startedAt = nowISO;
      updatedWorkflow.currentStepOrder = nextStep.stepOrder;

      const notifyUserIds = nextStep.assignees.map((a) => a.userId);

      return {
        success: true,
        newDocumentStatus: DocumentStatus.IN_REVIEW,
        newWorkflowStatus: WorkflowStatus.RUNNING,
        updatedWorkflow,
        shouldNotifyUserIds: notifyUserIds,
      };
    } else {
      // Đã hoàn thành bước cuối cùng -> TOÀN BỘ QUY TRÌNH HOÀN TẤT
      updatedWorkflow.status = WorkflowStatus.COMPLETED;
      updatedWorkflow.completedAt = nowISO;

      return {
        success: true,
        newDocumentStatus: DocumentStatus.APPROVED,
        newWorkflowStatus: WorkflowStatus.COMPLETED,
        updatedWorkflow,
        shouldNotifyUserIds: [],
      };
    }
  }

  /**
   * Khởi tạo quy trình duyệt khi người dùng gửi hồ sơ (SUBMIT)
   */
  public static startWorkflow(
    workflow: WorkflowInstance,
    nowISO = new Date().toISOString()
  ): FSMTransitionResult {
    const updatedWorkflow: WorkflowInstance = JSON.parse(JSON.stringify(workflow));

    if (updatedWorkflow.steps.length === 0) {
      return {
        success: false,
        error: 'Quy trình không có bất kỳ bước duyệt nào.',
        newDocumentStatus: DocumentStatus.DRAFT,
        newWorkflowStatus: WorkflowStatus.PENDING,
        updatedWorkflow,
        shouldNotifyUserIds: [],
      };
    }

    // Kích hoạt bước đầu tiên
    const firstStep = updatedWorkflow.steps.sort((a, b) => a.stepOrder - b.stepOrder)[0];
    firstStep.status = StepStatus.IN_PROGRESS;
    firstStep.startedAt = nowISO;

    updatedWorkflow.currentStepOrder = firstStep.stepOrder;
    updatedWorkflow.status = WorkflowStatus.RUNNING;
    updatedWorkflow.startedAt = nowISO;

    // Các bước còn lại đặt là WAITING
    updatedWorkflow.steps.forEach((s) => {
      if (s.stepOrder > firstStep.stepOrder) {
        s.status = StepStatus.WAITING;
      }
    });

    return {
      success: true,
      newDocumentStatus: DocumentStatus.IN_REVIEW,
      newWorkflowStatus: WorkflowStatus.RUNNING,
      updatedWorkflow,
      shouldNotifyUserIds: firstStep.assignees.map((a) => a.userId),
    };
  }
}
