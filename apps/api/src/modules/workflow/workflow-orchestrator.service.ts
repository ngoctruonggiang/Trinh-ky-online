import { createHash } from 'crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import {
  AssigneeDecision,
  AssigneeRole,
  AuditAction,
  DocumentStatus,
  StepStatus,
  WorkflowStatus,
} from '@trinh-ky/shared';
import {
  WorkflowFSM,
  WorkflowInstance,
  WorkflowStep,
  WorkflowAssignee,
  SignatureRecord,
} from '@trinh-ky/shared';

export interface SubmitDocumentInput {
  documentId: string;
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface ProcessDecisionInput {
  documentId: string;
  userId: string;
  decision: AssigneeDecision;
  decisionComment?: string;
  signatureImageUrl?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface ResubmitDocumentInput {
  documentId: string;
  userId: string;
  newFormData: any;
  changeSummary?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface CancelDocumentInput {
  documentId: string;
  userId: string;
  cancelReason?: string;
  ipAddress?: string;
  userAgent?: string;
}

export class WorkflowOrchestratorService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Helper: Chuyển đổi dữ liệu Prisma Workflow sang định dạng Domain WorkflowInstance của FSM
   */
  private mapPrismaToWorkflowInstance(prismaWorkflow: any): WorkflowInstance {
    return {
      id: prismaWorkflow.id,
      documentId: prismaWorkflow.documentId,
      status: prismaWorkflow.status as WorkflowStatus,
      currentStepOrder: prismaWorkflow.currentStepOrder,
      version: prismaWorkflow.version,
      steps: prismaWorkflow.steps.map((step: any): WorkflowStep => ({
        id: step.id,
        workflowId: step.workflowId,
        stepOrder: step.stepOrder,
        stepName: step.stepName,
        stepType: step.stepType,
        completionRule: step.completionRule,
        status: step.status as StepStatus,
        version: step.version,
        assignees: step.assignees.map((a: any): WorkflowAssignee => ({
          id: a.id,
          stepId: a.stepId,
          userId: a.userId,
          userFullName: a.user?.fullName || '',
          userEmail: a.user?.email || '',
          role: a.role as AssigneeRole,
          decision: a.decision as AssigneeDecision,
          decisionComment: a.decisionComment || undefined,
          decidedAt: a.decidedAt ? a.decidedAt.toISOString() : undefined,
        })),
        startedAt: step.startedAt ? step.startedAt.toISOString() : undefined,
        completedAt: step.completedAt ? step.completedAt.toISOString() : undefined,
      })),
      startedAt: prismaWorkflow.startedAt ? prismaWorkflow.startedAt.toISOString() : undefined,
      completedAt: prismaWorkflow.completedAt ? prismaWorkflow.completedAt.toISOString() : undefined,
    };
  }

  /**
   * Tính mã băm SHA-256 từ nội dung dữ liệu
   */
  public computeContentHash(data: any): string {
    const serialized = typeof data === 'string' ? data : JSON.stringify(data);
    return createHash('sha256').update(serialized).digest('hex');
  }

  /**
   * Gửi hồ sơ trình duyệt (SUBMIT)
   */
  public async submitDocument(input: SubmitDocumentInput) {
    const { documentId, userId, ipAddress, userAgent } = input;
    const now = new Date();
    const nowISO = now.toISOString();

    return await this.prisma.$transaction(async (tx) => {
      // 1. Tải thông tin tài liệu kèm workflow và steps
      const document = await tx.document.findUnique({
        where: { id: documentId },
        include: {
          workflow: {
            include: {
              steps: {
                orderBy: { stepOrder: 'asc' },
                include: {
                  assignees: {
                    include: { user: true },
                  },
                },
              },
            },
          },
        },
      });

      if (!document) {
        throw new Error(`Không tìm thấy hồ sơ với id: ${documentId}`);
      }

      if (!document.workflow) {
        throw new Error(`Hồ sơ ${documentId} chưa được cấu hình quy trình duyệt (ApprovalWorkflow).`);
      }

      // 2. Chạy FSM kiểm tra tính hợp lệ và chuyển đổi trạng thái
      const domainWorkflow = this.mapPrismaToWorkflowInstance(document.workflow);
      const fsmResult = WorkflowFSM.startWorkflow({
        workflow: domainWorkflow,
        documentStatus: document.status as DocumentStatus,
        nowISO,
      });

      if (!fsmResult.success) {
        throw new Error(fsmResult.error || 'Khởi động quy trình duyệt thất bại.');
      }

      // 3. Cập nhật Database nguyên tử trong Transaction
      // Cập nhật Document
      await tx.document.update({
        where: { id: documentId },
        data: {
          status: fsmResult.newDocumentStatus,
          currentStepOrder: fsmResult.updatedWorkflow.currentStepOrder,
        },
      });

      // Cập nhật Workflow
      await tx.approvalWorkflow.update({
        where: { id: document.workflow.id },
        data: {
          status: fsmResult.newWorkflowStatus,
          currentStepOrder: fsmResult.updatedWorkflow.currentStepOrder,
          startedAt: now,
          version: { increment: 1 },
        },
      });

      // Kích hoạt bước 1
      const firstStep = fsmResult.updatedWorkflow.steps.find(
        (s) => s.stepOrder === fsmResult.updatedWorkflow.currentStepOrder
      );
      if (firstStep) {
        await tx.approvalStep.update({
          where: { id: firstStep.id },
          data: {
            status: StepStatus.IN_PROGRESS,
            startedAt: now,
            version: { increment: 1 },
          },
        });
      }

      // Ghi AuditLog
      await tx.auditLog.create({
        data: {
          documentId,
          userId,
          action: AuditAction.SUBMIT_DOCUMENT,
          details: {
            previousStatus: document.status,
            newStatus: fsmResult.newDocumentStatus,
            firstStepOrder: fsmResult.updatedWorkflow.currentStepOrder,
          },
          ipAddress,
        },
      });

      return {
        success: true,
        documentStatus: fsmResult.newDocumentStatus,
        workflowStatus: fsmResult.newWorkflowStatus,
        shouldNotifyUserIds: fsmResult.shouldNotifyUserIds,
      };
    });
  }

  /**
   * Xử lý quyết định của một Assignee trong bước hiện tại
   * Áp dụng Optimistic Concurrency Control (OCC) và Transaction toàn vẹn
   */
  public async processAssigneeDecision(input: ProcessDecisionInput) {
    const {
      documentId,
      userId,
      decision,
      decisionComment,
      signatureImageUrl,
      ipAddress,
      userAgent,
    } = input;
    const now = new Date();
    const nowISO = now.toISOString();

    return await this.prisma.$transaction(async (tx) => {
      // 1. Tải toàn bộ ngữ cảnh hiện tại
      const document = await tx.document.findUnique({
        where: { id: documentId },
        include: {
          versions: {
            orderBy: { versionNumber: 'desc' },
            take: 1,
          },
          workflow: {
            include: {
              steps: {
                orderBy: { stepOrder: 'asc' },
                include: {
                  assignees: {
                    include: { user: true },
                  },
                },
              },
            },
          },
          signatureEvents: {
            where: { isValid: true },
          },
        },
      });

      if (!document || !document.workflow) {
        throw new Error(`Không tìm thấy hồ sơ hoặc quy trình duyệt của id: ${documentId}`);
      }

      const activeVersion = document.versions[0];
      if (!activeVersion) {
        throw new Error(`Hồ sơ ${documentId} chưa có phiên bản nội dung (DocumentVersion).`);
      }

      const currentStep = document.workflow.steps.find(
        (s) => s.stepOrder === document.workflow!.currentStepOrder
      );

      if (!currentStep) {
        throw new Error(`Không tìm thấy bước duyệt thứ ${document.workflow.currentStepOrder}`);
      }

      const assignee = currentStep.assignees.find((a) => a.userId === userId);
      if (!assignee) {
        throw new Error(`Người dùng ${userId} không được phân công trong bước "${currentStep.stepName}"`);
      }

      if (assignee.role === AssigneeRole.REVIEWER) {
        throw new Error('Người giám sát (REVIEWER) chỉ có quyền xem và bình luận, không có thẩm quyền ra quyết định.');
      }

      // 2. Kiểm soát tương tranh cấp cơ sở dữ liệu (Database-level Optimistic Concurrency Control)
      // Điều kiện 1: Assignee phải ở trạng thái PENDING. Nếu một transaction khác đã ghi nhận trước, count sẽ bằng 0.
      const assigneeUpdateResult = await tx.stepAssignee.updateMany({
        where: {
          id: assignee.id,
          decision: AssigneeDecision.PENDING,
        },
        data: {
          decision,
          decisionComment,
          decidedAt: now,
        },
      });

      if (assigneeUpdateResult.count === 0) {
        throw new Error(
          'Xung đột tương tranh: Quyết định của người duyệt đã được xử lý bởi một yêu cầu đồng thời hoặc trước đó.'
        );
      }

      // 3. Chuẩn bị dữ liệu cho Domain FSM thuần túy
      const domainWorkflow = this.mapPrismaToWorkflowInstance(document.workflow);
      const existingSignatures: SignatureRecord[] = document.signatureEvents.map((sig) => ({
        id: sig.id,
        documentId: sig.documentId,
        versionNumber: activeVersion.versionNumber,
        stepId: sig.stepId || '',
        userId: sig.userId,
        userFullName: '',
        signatureImageUrl: sig.signatureImageUrl,
        contentHash: sig.contentHash,
        signedAt: sig.signedAt.toISOString(),
        isValid: sig.isValid,
        invalidatedReason: sig.invalidatedReason || undefined,
        invalidatedAt: sig.invalidatedAt ? sig.invalidatedAt.toISOString() : undefined,
      }));

      // Chạy FSM
      const fsmResult = WorkflowFSM.processDecision({
        workflow: domainWorkflow,
        documentStatus: document.status as DocumentStatus,
        userId,
        decision,
        decisionComment,
        existingSignatures,
        nowISO,
      });

      if (!fsmResult.success) {
        throw new Error(fsmResult.error || 'Quyết định phê duyệt không hợp lệ theo quy tắc FSM.');
      }

      // 4. Lưu lịch sử quyết định bất biến (StepDecisionHistory) gắn chặt với documentVersionId
      await tx.stepDecisionHistory.create({
        data: {
          stepId: currentStep.id,
          documentVersionId: activeVersion.id,
          userId,
          role: assignee.role,
          decision,
          decisionComment,
          decidedAt: now,
        },
      });

      // 5. Nếu APPROVE và có chữ ký cá nhân -> Lưu SignatureEvent gắn liền với Version và SHA-256
      if (decision === AssigneeDecision.APPROVED && signatureImageUrl) {
        await tx.signatureEvent.create({
          data: {
            documentId: document.id,
            documentVersionId: activeVersion.id,
            stepId: currentStep.id,
            userId,
            signatureImageUrl,
            contentHash: activeVersion.sha256Hash,
            ipAddress,
            userAgent,
            signedAt: now,
            isValid: true,
          },
        });
      }

      // 6. Xử lý các kịch bản FSM chuyển trạng thái:
      // Kịch bản A: Yêu cầu sửa (REVISION_REQUESTED) -> Vô hiệu hóa chữ ký của version hiện tại
      if (decision === AssigneeDecision.REVISION_REQUESTED) {
        await tx.signatureEvent.updateMany({
          where: {
            documentId: document.id,
            documentVersionId: activeVersion.id,
            isValid: true,
          },
          data: {
            isValid: false,
            invalidatedReason: `Vô hiệu hóa do yêu cầu chỉnh sửa từ bước "${currentStep.stepName}": ${decisionComment || 'Không có ghi chú'}`,
            invalidatedAt: now,
          },
        });

        // Cập nhật bước
        await tx.approvalStep.updateMany({
          where: { id: currentStep.id, status: StepStatus.IN_PROGRESS, version: currentStep.version },
          data: {
            status: StepStatus.REVISION_REQUESTED,
            version: { increment: 1 },
          },
        });

        await tx.approvalWorkflow.update({
          where: { id: document.workflow.id },
          data: {
            status: WorkflowStatus.RUNNING,
            version: { increment: 1 },
          },
        });

        await tx.document.update({
          where: { id: document.id },
          data: {
            status: DocumentStatus.REVISION_REQUESTED,
          },
        });
      }

      // Kịch bản B: Từ chối (REJECTED) -> Hủy các bước sau
      else if (decision === AssigneeDecision.REJECTED) {
        await tx.approvalStep.updateMany({
          where: { id: currentStep.id, status: StepStatus.IN_PROGRESS, version: currentStep.version },
          data: {
            status: StepStatus.REJECTED,
            completedAt: now,
            version: { increment: 1 },
          },
        });

        // Hủy các bước còn lại
        await tx.approvalStep.updateMany({
          where: {
            workflowId: document.workflow.id,
            stepOrder: { gt: currentStep.stepOrder },
          },
          data: {
            status: StepStatus.CANCELLED,
            version: { increment: 1 },
          },
        });

        await tx.approvalWorkflow.update({
          where: { id: document.workflow.id },
          data: {
            status: WorkflowStatus.REJECTED,
            completedAt: now,
            version: { increment: 1 },
          },
        });

        await tx.document.update({
          where: { id: document.id },
          data: {
            status: DocumentStatus.REJECTED,
          },
        });
      }

      // Kịch bản C: Đồng ý (APPROVED)
      else if (decision === AssigneeDecision.APPROVED) {
        const stepInFsm = fsmResult.updatedWorkflow.steps.find((s) => s.id === currentStep.id);
        if (stepInFsm && stepInFsm.status === StepStatus.COMPLETED) {
          // Áp dụng OCC: Chỉ transaction nào thực sự chuyển bước từ IN_PROGRESS sang COMPLETED mới kích hoạt bước sau
          const stepCompleteResult = await tx.approvalStep.updateMany({
            where: {
              id: currentStep.id,
              status: StepStatus.IN_PROGRESS,
              version: currentStep.version,
            },
            data: {
              status: StepStatus.COMPLETED,
              completedAt: now,
              version: { increment: 1 },
            },
          });

          // Nếu count > 0, transaction này là bên đầu tiên hoàn tất bước -> kích hoạt bước tiếp
          if (stepCompleteResult.count > 0) {
            const nextStep = fsmResult.updatedWorkflow.steps.find(
              (s) => s.stepOrder === currentStep.stepOrder + 1
            );
            if (nextStep) {
              await tx.approvalStep.update({
                where: { id: nextStep.id },
                data: {
                  status: StepStatus.IN_PROGRESS,
                  startedAt: now,
                  version: { increment: 1 },
                },
              });
            }

            // Cập nhật Workflow và Document tiến trình
            await tx.approvalWorkflow.update({
              where: { id: document.workflow.id },
              data: {
                status: fsmResult.newWorkflowStatus,
                currentStepOrder: fsmResult.updatedWorkflow.currentStepOrder,
                completedAt:
                  fsmResult.newWorkflowStatus === WorkflowStatus.COMPLETED
                    ? now
                    : undefined,
                version: { increment: 1 },
              },
            });

            await tx.document.update({
              where: { id: document.id },
              data: {
                status: fsmResult.newDocumentStatus,
                currentStepOrder: fsmResult.updatedWorkflow.currentStepOrder,
              },
            });
          }
        }
      }

      // 8. Ghi AuditLog
      const auditAction =
        decision === AssigneeDecision.APPROVED
          ? AuditAction.APPROVE_STEP
          : decision === AssigneeDecision.REJECTED
          ? AuditAction.REJECT_STEP
          : AuditAction.REQUEST_REVISION;

      await tx.auditLog.create({
        data: {
          documentId,
          userId,
          action: auditAction,
          details: {
            stepOrder: currentStep.stepOrder,
            stepName: currentStep.stepName,
            decision,
            decisionComment,
            versionNumber: activeVersion.versionNumber,
            documentStatus: fsmResult.newDocumentStatus,
            workflowStatus: fsmResult.newWorkflowStatus,
          },
          ipAddress,
        },
      });

      return {
        success: true,
        documentStatus: fsmResult.newDocumentStatus,
        workflowStatus: fsmResult.newWorkflowStatus,
        shouldNotifyUserIds: fsmResult.shouldNotifyUserIds,
        invalidatedSignaturesCount: fsmResult.invalidatedSignatures?.length || 0,
      };
    });
  }

  /**
   * Nộp lại hồ sơ sau khi chỉnh sửa (Resubmit)
   * Tạo DocumentVersion mới, tăng versionNumber, tính SHA-256 mới, chạy lại từ Step 1
   */
  public async resubmitDocument(input: ResubmitDocumentInput) {
    const { documentId, userId, newFormData, changeSummary, ipAddress, userAgent } = input;
    const now = new Date();
    const nowISO = now.toISOString();

    return await this.prisma.$transaction(async (tx) => {
      const document = await tx.document.findUnique({
        where: { id: documentId },
        include: {
          workflow: {
            include: {
              steps: {
                orderBy: { stepOrder: 'asc' },
                include: {
                  assignees: true,
                },
              },
            },
          },
        },
      });

      if (!document || !document.workflow) {
        throw new Error(`Không tìm thấy hồ sơ hoặc quy trình duyệt với id: ${documentId}`);
      }

      // 1. Chạy FSM kiểm tra tính hợp lệ
      const domainWorkflow = this.mapPrismaToWorkflowInstance(document.workflow);
      const fsmResult = WorkflowFSM.resubmitWorkflow({
        workflow: domainWorkflow,
        documentStatus: document.status as DocumentStatus,
        resubmittedById: userId,
        changeSummary,
        nowISO,
      });

      if (!fsmResult.success) {
        throw new Error(fsmResult.error || 'Nộp lại hồ sơ thất bại theo quy tắc FSM.');
      }

      // 2. Tạo phiên bản tài liệu mới (Immutable DocumentVersion)
      const newVersionNumber = document.currentVersion + 1;
      const newHash = this.computeContentHash(newFormData);

      const newVersion = await tx.documentVersion.create({
        data: {
          documentId,
          versionNumber: newVersionNumber,
          formData: newFormData,
          sha256Hash: newHash,
          changeSummary: changeSummary || 'Nộp lại sau khi chỉnh sửa nội dung',
          createdById: userId,
          createdAt: now,
        },
      });

      // 3. Reset các bước duyệt: Bước 1 thành IN_PROGRESS, các bước sau thành WAITING
      const sortedSteps = document.workflow.steps.sort((a, b) => a.stepOrder - b.stepOrder);
      const firstStep = sortedSteps[0];

      await tx.approvalStep.update({
        where: { id: firstStep.id },
        data: {
          status: StepStatus.IN_PROGRESS,
          startedAt: now,
          completedAt: null,
          version: { increment: 1 },
        },
      });

      // Reset toàn bộ assignees của bước 1
      await tx.stepAssignee.updateMany({
        where: { stepId: firstStep.id },
        data: {
          decision: AssigneeDecision.PENDING,
          decisionComment: null,
          decidedAt: null,
        },
      });

      // Các bước tiếp theo: Chuyển về WAITING và reset assignees
      for (const step of sortedSteps.slice(1)) {
        await tx.approvalStep.update({
          where: { id: step.id },
          data: {
            status: StepStatus.WAITING,
            startedAt: null,
            completedAt: null,
            version: { increment: 1 },
          },
        });

        await tx.stepAssignee.updateMany({
          where: { stepId: step.id },
          data: {
            decision: AssigneeDecision.PENDING,
            decisionComment: null,
            decidedAt: null,
          },
        });
      }

      // 4. Cập nhật Workflow và Document
      await tx.approvalWorkflow.update({
        where: { id: document.workflow.id },
        data: {
          status: WorkflowStatus.RUNNING,
          currentStepOrder: 1,
          completedAt: null,
          version: { increment: 1 },
        },
      });

      await tx.document.update({
        where: { id: document.id },
        data: {
          status: DocumentStatus.IN_REVIEW,
          currentVersion: newVersionNumber,
          currentStepOrder: 1,
        },
      });

      // 5. Ghi AuditLog
      await tx.auditLog.create({
        data: {
          documentId,
          userId,
          action: AuditAction.RESUBMIT_DOCUMENT,
          details: {
            newVersionNumber,
            contentHash: newHash,
            changeSummary,
          },
          ipAddress,
        },
      });

      return {
        success: true,
        newVersionNumber,
        contentHash: newHash,
        documentStatus: DocumentStatus.IN_REVIEW,
        workflowStatus: WorkflowStatus.RUNNING,
        shouldNotifyUserIds: fsmResult.shouldNotifyUserIds,
      };
    });
  }

  /**
   * Hủy hồ sơ trình ký (Cancel)
   * Chặn hủy khi đã APPROVED hoặc REJECTED.
   */
  public async cancelDocument(input: CancelDocumentInput) {
    const { documentId, userId, cancelReason, ipAddress, userAgent } = input;
    const now = new Date();
    const nowISO = now.toISOString();

    return await this.prisma.$transaction(async (tx) => {
      const document = await tx.document.findUnique({
        where: { id: documentId },
        include: {
          workflow: {
            include: {
              steps: true,
            },
          },
        },
      });

      if (!document || !document.workflow) {
        throw new Error(`Không tìm thấy hồ sơ hoặc quy trình duyệt với id: ${documentId}`);
      }

      // Chạy FSM kiểm tra trạng thái
      const domainWorkflow = this.mapPrismaToWorkflowInstance(document.workflow);
      const fsmResult = WorkflowFSM.cancelWorkflow({
        workflow: domainWorkflow,
        documentStatus: document.status as DocumentStatus,
        cancelledById: userId,
        cancelReason,
        nowISO,
      });

      if (!fsmResult.success) {
        throw new Error(fsmResult.error || 'Hủy hồ sơ thất bại theo quy tắc FSM.');
      }

      // Cập nhật Document & Workflow
      await tx.document.update({
        where: { id: document.id },
        data: {
          status: DocumentStatus.CANCELLED,
        },
      });

      await tx.approvalWorkflow.update({
        where: { id: document.workflow.id },
        data: {
          status: WorkflowStatus.CANCELLED,
          completedAt: now,
          version: { increment: 1 },
        },
      });

      // Đóng toàn bộ các bước chưa hoàn tất
      await tx.approvalStep.updateMany({
        where: {
          workflowId: document.workflow.id,
          status: { in: [StepStatus.IN_PROGRESS, StepStatus.WAITING] },
        },
        data: {
          status: StepStatus.CANCELLED,
          completedAt: now,
          version: { increment: 1 },
        },
      });

      // Ghi AuditLog
      await tx.auditLog.create({
        data: {
          documentId,
          userId,
          action: AuditAction.CANCEL_DOCUMENT,
          details: {
            cancelReason,
            previousStatus: document.status,
          },
          ipAddress,
        },
      });

      return {
        success: true,
        documentStatus: DocumentStatus.CANCELLED,
        workflowStatus: WorkflowStatus.CANCELLED,
      };
    });
  }
}
