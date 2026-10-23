import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { NotificationType } from '@trinh-ky/shared';

export interface CreateNotificationDto {
  userId: string;
  documentId?: string;
  type: NotificationType;
  title: string;
  content: string;
  metadata?: any;
}

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

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
   * Tạo thông báo mới (hỗ trợ chống duplicate thông báo giống nhau trong cùng ngày)
   */
  async createNotification(dto: CreateNotificationDto) {
    return await this.prisma.notification.create({
      data: {
        userId: dto.userId,
        documentId: dto.documentId,
        type: dto.type,
        title: dto.title,
        content: dto.content,
        metadata: dto.metadata,
      },
    });
  }
}
