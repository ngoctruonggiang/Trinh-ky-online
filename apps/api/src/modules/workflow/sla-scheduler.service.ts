import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { NotificationService } from '../notification/notification.service.js';
import { NotificationType, NotificationStatus, StepStatus, WorkflowStatus, DocumentStatus, AssigneeDecision, AssigneeRole } from '@trinh-ky/shared';

export interface SlaCheckItemDetail {
  stepId: string;
  stepName: string;
  documentId: string;
  documentNumber: string;
  type: 'SLA_WARNING' | 'SLA_OVERDUE';
  userId: string;
  idempotencyKey: string;
  status: 'SENT' | 'SKIPPED_DUPLICATE' | 'ERROR';
  error?: string;
}

export interface SlaCheckSummary {
  scannedStepsCount: number;
  warningsSent: number;
  overduesSent: number;
  skippedAlreadySent: number;
  errorsCount: number;
  processedAt: string;
  details: SlaCheckItemDetail[];
}

@Injectable()
export class SlaSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlaSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService
  ) {}

  onModuleInit() {
    // Khởi động scheduler quét định kỳ (mặc định mỗi 5 phút hoặc cấu hình qua env)
    const intervalMs = Number(process.env.SLA_CHECK_INTERVAL_MS) || 5 * 60 * 1000;
    if (process.env.NODE_ENV !== 'test' && intervalMs > 0) {
      this.timer = setInterval(() => {
        this.processSlaChecks().catch((err) => {
          this.logger.error('Lỗi khi chạy định kỳ SLA Scheduler:', err);
        });
      }, intervalMs);
      this.logger.log(`SLA Scheduler đã khởi động với tần suất ${intervalMs / 1000}s`);
    }
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Định dạng thời gian theo múi giờ Việt Nam (UTC+7)
   */
  private formatVnDateTime(date: Date): string {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  /**
   * Quét và gửi thông báo SLA (SLA_WARNING, SLA_OVERDUE) với cơ chế bảo vệ Idempotency và Concurrency Lock
   * @param referenceNow Thời điểm mốc kiểm tra (mặc định là thời gian hiện tại)
   */
  async processSlaChecks(referenceNow: Date = new Date()): Promise<SlaCheckSummary> {
    const summary: SlaCheckSummary = {
      scannedStepsCount: 0,
      warningsSent: 0,
      overduesSent: 0,
      skippedAlreadySent: 0,
      errorsCount: 0,
      processedAt: referenceNow.toISOString(),
      details: [],
    };

    // 1. Quét danh sách các bước duyệt đang xử lý (IN_PROGRESS) của các hồ sơ đang duyệt (IN_REVIEW)
    const activeSteps = await this.prisma.approvalStep.findMany({
      where: {
        status: StepStatus.IN_PROGRESS,
        dueDate: { not: null },
        workflow: {
          status: WorkflowStatus.RUNNING,
          document: {
            status: DocumentStatus.IN_REVIEW,
          },
        },
      },
      include: {
        workflow: {
          include: {
            document: {
              select: {
                id: true,
                documentNumber: true,
                title: true,
                status: true,
              },
            },
          },
        },
        assignees: {
          where: {
            role: AssigneeRole.APPROVER,
            decision: AssigneeDecision.PENDING,
          },
          select: {
            id: true,
            userId: true,
            role: true,
            decision: true,
          },
        },
      },
      orderBy: {
        dueDate: 'asc',
      },
    });

    summary.scannedStepsCount = activeSteps.length;

    // Ngưỡng sắp đến hạn: trong vòng 24 giờ tới (86,400,000 ms)
    const nearDueThresholdMs = 24 * 60 * 60 * 1000;

    for (const step of activeSteps) {
      if (!step.dueDate || step.assignees.length === 0) {
        continue;
      }

      const dueDate = new Date(step.dueDate);
      const isOverdue = dueDate.getTime() < referenceNow.getTime();
      const isNearDue =
        !isOverdue &&
        dueDate.getTime() - referenceNow.getTime() <= nearDueThresholdMs;

      if (!isOverdue && !isNearDue) {
        // Hồ sơ vẫn còn nhiều thời gian (ON_TRACK) -> Không cần gửi cảnh báo
        continue;
      }

      const notifType = isOverdue
        ? NotificationType.SLA_OVERDUE
        : NotificationType.SLA_WARNING;

      const formattedDueDate = this.formatVnDateTime(dueDate);
      const doc = step.workflow.document;

      // 2. Xử lý từng bước bên trong Transaction với Khóa hàng bi quan (Row-level Lock)
      try {
        await this.prisma.$transaction(async (tx) => {
          // Khóa hàng ApprovalStep để chống hai worker chạy đồng thời
          await tx.$executeRawUnsafe(
            'SELECT id FROM approval_steps WHERE id = $1 FOR UPDATE',
            step.id
          );

          // Kiểm tra lại trạng thái bước duyệt: nếu bước đã hoàn tất hoặc bị hủy trong lúc chờ lock -> bỏ qua
          const currentStepState = await tx.approvalStep.findUnique({
            where: { id: step.id },
            include: {
              workflow: {
                include: {
                  document: true,
                },
              },
            },
          });

          if (
            !currentStepState ||
            currentStepState.status !== StepStatus.IN_PROGRESS ||
            currentStepState.workflow.status !== WorkflowStatus.RUNNING ||
            currentStepState.workflow.document.status !== DocumentStatus.IN_REVIEW
          ) {
            return;
          }

          // Lấy danh sách assignee đang PENDING mới nhất tại thời điểm khóa
          const currentAssignees = await tx.stepAssignee.findMany({
            where: {
              stepId: step.id,
              role: AssigneeRole.APPROVER,
              decision: AssigneeDecision.PENDING,
            },
          });

          for (const assignee of currentAssignees) {
            const idempotencyKey = `${notifType}:${step.id}:${assignee.userId}`;

            // Kiểm tra xem đã có thông báo với idempotencyKey này chưa
            const existingNotif = await tx.notification.findUnique({
              where: { idempotencyKey },
            });

            if (existingNotif) {
              summary.skippedAlreadySent++;
              summary.details.push({
                stepId: step.id,
                stepName: step.stepName,
                documentId: doc.id,
                documentNumber: doc.documentNumber,
                type: notifType,
                userId: assignee.userId,
                idempotencyKey,
                status: 'SKIPPED_DUPLICATE',
              });
              continue;
            }

            // Tạo thông báo với idempotencyKey an toàn
            const title = isOverdue
              ? `Cảnh báo quá hạn: Hồ sơ ${doc.documentNumber}`
              : `Nhắc nhở sắp đến hạn: Hồ sơ ${doc.documentNumber}`;

            const content = isOverdue
              ? `Bước "${step.stepName}" của hồ sơ "${doc.title}" đã quá hạn xử lý quy định vào ${formattedDueDate}. Vui lòng xử lý ngay.`
              : `Bước "${step.stepName}" của hồ sơ "${doc.title}" sẽ đến hạn xử lý vào ${formattedDueDate}. Vui lòng sắp xếp phê duyệt.`;

            await tx.notification.create({
              data: {
                userId: assignee.userId,
                documentId: doc.id,
                type: notifType,
                title,
                content,
                idempotencyKey,
                status: NotificationStatus.SENT,
                metadata: {
                  stepId: step.id,
                  stepName: step.stepName,
                  dueDate: step.dueDate,
                  isOverdue,
                },
              },
            });

            if (isOverdue) {
              summary.overduesSent++;
            } else {
              summary.warningsSent++;
            }

            summary.details.push({
              stepId: step.id,
              stepName: step.stepName,
              documentId: doc.id,
              documentNumber: doc.documentNumber,
              type: notifType,
              userId: assignee.userId,
              idempotencyKey,
              status: 'SENT',
            });
          }

          // Cập nhật timestamp ghi nhận đã gửi trên ApprovalStep
          if (isOverdue && !currentStepState.slaOverdueSentAt) {
            await tx.approvalStep.update({
              where: { id: step.id },
              data: { slaOverdueSentAt: referenceNow },
            });
          } else if (isNearDue && !currentStepState.slaWarningSentAt) {
            await tx.approvalStep.update({
              where: { id: step.id },
              data: { slaWarningSentAt: referenceNow },
            });
          }
        });
      } catch (stepErr: any) {
        summary.errorsCount++;
        this.logger.error(
          `Lỗi khi xử lý SLA cho bước ${step.id} (${step.stepName}):`,
          stepErr
        );
        summary.details.push({
          stepId: step.id,
          stepName: step.stepName,
          documentId: doc.id,
          documentNumber: doc.documentNumber,
          type: notifType,
          userId: 'N/A',
          idempotencyKey: 'ERROR',
          status: 'ERROR',
          error: stepErr.message || 'Lỗi không xác định',
        });
      }
    }

    return summary;
  }
}
