import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotificationService } from './notification.service.js';
import { NotificationType } from '@trinh-ky/shared';

describe('NotificationService (In-App Notification Engine)', () => {
  let service: NotificationService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      notification: {
        count: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        create: vi.fn(),
      },
    };
    service = new NotificationService(mockPrisma);
  });

  describe('1. getUserNotifications', () => {
    it('1.1. Lấy danh sách thông báo và số lượng chưa đọc với phân trang chính xác', async () => {
      mockPrisma.notification.count.mockResolvedValueOnce(5); // total
      mockPrisma.notification.count.mockResolvedValueOnce(2); // unreadCount
      mockPrisma.notification.findMany.mockResolvedValueOnce([
        {
          id: 'notif-1',
          userId: 'user-1',
          documentId: 'doc-1',
          type: NotificationType.ASSIGNED_STEP,
          title: 'Bạn được phân công duyệt',
          content: 'Nội dung thông báo',
          isRead: false,
          readAt: null,
          metadata: { stepId: 'step-1' },
          createdAt: new Date('2026-10-23T10:00:00Z'),
          document: {
            id: 'doc-1',
            documentNumber: 'TK-2026-0001',
            title: 'Hồ sơ tạm ứng',
            status: 'IN_REVIEW',
          },
        },
      ]);

      const result = await service.getUserNotifications('user-1', { page: 1, limit: 10 });
      expect(result.items.length).toBe(1);
      expect(result.unreadCount).toBe(2);
      expect(result.pagination.total).toBe(5);
      expect(result.items[0].documentNumber).toBe('TK-2026-0001');
      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          skip: 0,
          take: 10,
        })
      );
    });

    it('1.2. Lọc theo trạng thái isRead: false', async () => {
      mockPrisma.notification.count.mockResolvedValueOnce(2);
      mockPrisma.notification.count.mockResolvedValueOnce(2);
      mockPrisma.notification.findMany.mockResolvedValueOnce([]);

      await service.getUserNotifications('user-1', { isRead: false });
      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', isRead: false },
        })
      );
    });
  });

  describe('2. markAsRead & markAllAsRead', () => {
    it('2.1. Đánh dấu đã đọc thành công cho thông báo của chính mình', async () => {
      mockPrisma.notification.findUnique.mockResolvedValue({
        id: 'notif-1',
        userId: 'user-1',
        isRead: false,
      });
      mockPrisma.notification.update.mockResolvedValue({
        id: 'notif-1',
        userId: 'user-1',
        isRead: true,
        readAt: new Date(),
      });

      const updated = await service.markAsRead('user-1', 'notif-1');
      expect(updated.isRead).toBe(true);
      expect(mockPrisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'notif-1' },
          data: expect.objectContaining({ isRead: true }),
        })
      );
    });

    it('2.2. Từ chối 403 nếu người dùng cố đánh dấu thông báo của người khác', async () => {
      mockPrisma.notification.findUnique.mockResolvedValue({
        id: 'notif-2',
        userId: 'other-user',
        isRead: false,
      });

      await expect(service.markAsRead('user-1', 'notif-2')).rejects.toThrow(
        'Bạn không có quyền thao tác trên thông báo này.'
      );
    });

    it('2.3. markAllAsRead cập nhật tất cả thông báo chưa đọc', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 4 });

      const result = await service.markAllAsRead('user-1');
      expect(result.success).toBe(true);
      expect(result.updatedCount).toBe(4);
      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', isRead: false },
          data: expect.objectContaining({ isRead: true }),
        })
      );
    });
  });

  describe('3. createNotification', () => {
    it('3.1. Tạo thông báo mới đầy đủ trường', async () => {
      mockPrisma.notification.create.mockResolvedValue({
        id: 'notif-new',
        userId: 'user-2',
        type: NotificationType.REASSIGNED_STEP,
        title: 'Chuyển giao',
        content: 'Chuyển giao người duyệt',
      });

      const notif = await service.createNotification({
        userId: 'user-2',
        type: NotificationType.REASSIGNED_STEP,
        title: 'Chuyển giao',
        content: 'Chuyển giao người duyệt',
      });

      expect(notif.id).toBe('notif-new');
      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-2',
            type: NotificationType.REASSIGNED_STEP,
          }),
        })
      );
    });
  });
});
