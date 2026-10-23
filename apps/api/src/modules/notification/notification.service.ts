import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { NotificationType, NotificationStatus } from '@trinh-ky/shared';

export interface CreateNotificationDto {
  userId: string;
  documentId?: string;
  type: NotificationType;
  title: string;
  content: string;
  metadata?: any;
  idempotencyKey?: string;
  status?: NotificationStatus;
}

@Injectable()
export class NotificationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationService.name);
  private retryTimer: NodeJS.Timeout | null = null;
  private isRetrying = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    // Khởi động worker thử lại việc gửi thông báo định kỳ (mặc định mỗi 60s, tắt trong test)
    const intervalMs = Number(process.env.NOTIFICATION_RETRY_INTERVAL_MS) || 60 * 1000;
    if (process.env.NODE_ENV !== 'test' && intervalMs > 0) {
      this.retryTimer = setInterval(() => {
        if (this.isRetrying) return;
        this.isRetrying = true;
        this.retryFailedNotifications()
          .catch((err) => {
            this.logger.error('Lỗi khi chạy định kỳ Notification Retry Worker:', err);
          })
          .finally(() => {
            this.isRetrying = false;
          });
      }, intervalMs);
      this.logger.log(`Notification Retry Worker đã khởi động với tần suất ${intervalMs / 1000}s`);
    }
  }

  onModuleDestroy() {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /**
   * Lấy danh sách thông báo của người dùng với phân trang và lọc theo trạng thái đã đọc
   */
  async getUserNotifications(
    userId: string,
    query: { isRead?: boolean; page?: number; limit?: number }
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = { userId };
    if (typeof query.isRead === 'boolean') {
      where.isRead = query.isRead;
    }

    const [total, unreadCount, notifications] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
      this.prisma.notification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
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
      }),
    ]);

    return {
      items: notifications.map((n) => ({
        id: n.id,
        userId: n.userId,
        documentId: n.documentId,
        documentNumber: n.document?.documentNumber,
        documentTitle: n.document?.title,
        documentStatus: n.document?.status,
        type: n.type,
        title: n.title,
        content: n.content,
        isRead: n.isRead,
        readAt: n.readAt ? n.readAt.toISOString() : null,
        metadata: n.metadata,
        createdAt: n.createdAt.toISOString(),
      })),
      unreadCount,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Lấy số lượng thông báo chưa đọc của người dùng
   */
  async getUnreadCount(userId: string): Promise<number> {
    return await this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  /**
   * Đánh dấu 1 thông báo là đã đọc
   */
  async markAsRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException('Không tìm thấy thông báo.');
    }

    if (notification.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền thao tác trên thông báo này.');
    }

    if (!notification.isRead) {
      return await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });
    }

    return notification;
  }

  /**
   * Đánh dấu tất cả thông báo của người dùng là đã đọc
   */
  async markAllAsRead(userId: string) {
    const now = new Date();
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: {
        isRead: true,
        readAt: now,
      },
    });

    return {
      success: true,
      updatedCount: result.count,
    };
  }

  /**
   * Tạo thông báo mới (hỗ trợ database-level idempotency chống duplicate thông báo)
   */
  async createNotification(dto: CreateNotificationDto) {
    if (dto.idempotencyKey) {
      const existing = await this.prisma.notification.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
      });
      if (existing) {
        return existing;
      }
    }

    try {
      return await this.prisma.notification.create({
        data: {
          userId: dto.userId,
          documentId: dto.documentId,
          type: dto.type,
          title: dto.title,
          content: dto.content,
          metadata: dto.metadata,
          idempotencyKey: dto.idempotencyKey,
          status: dto.status || 'SENT',
        },
      });
    } catch (err: any) {
      // Bắt xung đột Unique Constraint P2002 nếu 2 worker insert đồng thời
      if (err.code === 'P2002' && dto.idempotencyKey) {
        const existing = await this.prisma.notification.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (existing) {
          return existing;
        }
      }
      throw err;
    }
  }

  /**
   * Thử lại việc gửi các thông báo bị lỗi (FAILED) hoặc đang chờ (PENDING)
   * Sử dụng khóa hàng hoặc kiểm soát tương tranh để đảm bảo an toàn khi nhiều worker chạy đồng thời.
   * Thông báo đã SENT tuyệt đối không bao giờ được gửi lại.
   * Lỗi vượt quá maxRetries sẽ dừng retry để tránh vòng lặp vô hạn.
   */
  async retryFailedNotifications(maxRetries: number = 3) {
    return await this.prisma.$transaction(async (tx) => {
      let candidateIds: string[] = [];

      try {
        // Áp dụng khóa hàng FOR UPDATE SKIP LOCKED trên PostgreSQL thật nếu có hỗ trợ
        const rawRows: any[] = await (tx as any).$queryRawUnsafe(
          `SELECT id FROM notifications 
           WHERE status IN ('FAILED', 'PENDING') 
             AND "retryCount" < $1 
           ORDER BY "createdAt" ASC 
           LIMIT 50 
           FOR UPDATE SKIP LOCKED`,
          maxRetries
        );
        candidateIds = rawRows.map((r) => r.id);
      } catch {
        // Fallback tương thích môi trường unit test hoặc DB mock
        const items = await tx.notification.findMany({
          where: {
            status: { in: ['FAILED', 'PENDING'] },
            retryCount: { lt: maxRetries },
          },
          take: 50,
          orderBy: { createdAt: 'asc' },
        });
        candidateIds = items.map((i) => i.id);
      }

      if (candidateIds.length === 0) {
        return { retriedCount: 0, totalFailed: 0 };
      }

      const targetNotifications = await tx.notification.findMany({
        where: { id: { in: candidateIds } },
      });

      const retriedIds: string[] = [];
      for (const item of targetNotifications) {
        // Bỏ qua nếu bản ghi đã chuyển sang SENT
        if (item.status === 'SENT') {
          continue;
        }

        try {
          // In-App Notification lưu trữ trong PostgreSQL:
          // Đánh dấu thành công sang SENT, xóa errorMessage và tăng retryCount
          await tx.notification.update({
            where: { id: item.id },
            data: {
              status: NotificationStatus.SENT,
              errorMessage: null,
              retryCount: item.retryCount + 1,
            },
          });
          retriedIds.push(item.id);
        } catch (err: any) {
          const nextRetryCount = item.retryCount + 1;
          await tx.notification.update({
            where: { id: item.id },
            data: {
              status: NotificationStatus.FAILED,
              retryCount: nextRetryCount,
              errorMessage: err.message || 'Lỗi gửi lại thông báo',
            },
          });
        }
      }

      return { retriedCount: retriedIds.length, totalFailed: targetNotifications.length };
    });
  }
}

