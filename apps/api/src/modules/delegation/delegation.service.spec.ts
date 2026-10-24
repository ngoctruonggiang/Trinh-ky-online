import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DelegationService } from './delegation.service.js';
import {
  AssigneeDecision,
  AssigneeRole,
  NotificationType,
} from '@trinh-ky/shared';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

describe('DelegationService (Delegation Policy Engine Unit Tests)', () => {
  let service: DelegationService;
  let mockPrisma: any;
  let mockNotificationService: any;

  beforeEach(() => {
    mockPrisma = {
      $transaction: vi.fn(async (callback: any) => callback(mockPrisma)),
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'mock-policy-id', is_active: true, start_date: new Date('2026-10-01'), end_date: new Date('2026-12-01') }]),
      user: {
        findUnique: vi.fn(),
      },
      department: {
        findUnique: vi.fn(),
      },
      formTemplate: {
        findUnique: vi.fn(),
      },
      delegationPolicy: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
    };

    mockNotificationService = {
      createNotification: vi.fn().mockResolvedValue({ id: 'notif-1' }),
    };

    service = new DelegationService(mockPrisma, mockNotificationService);
  });

  describe('1. createPolicy (Tạo chính sách ủy quyền)', () => {
    const validDto = {
      delegateeId: 'user-b',
      startDate: '2026-10-24T00:00:00.000Z',
      endDate: '2026-10-30T00:00:00.000Z',
      reason: 'Đi công tác nước ngoài',
    };

    it('1.1. Chặn self-delegation: Không cho phép tự ủy quyền cho chính mình', async () => {
      await expect(
        service.createPolicy('user-a', 'USER', 'org-1', {
          ...validDto,
          delegateeId: 'user-a',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('1.2. Chặn thời gian không hợp lệ: startDate >= endDate', async () => {
      await expect(
        service.createPolicy('user-a', 'USER', 'org-1', {
          ...validDto,
          startDate: '2026-10-31T00:00:00.000Z',
          endDate: '2026-10-25T00:00:00.000Z',
        })
      ).rejects.toThrow('startDate');
    });

    it('1.3. Chặn USER thường tạo chính sách thay mặt cho người khác (chỉ ADMIN/SUPER_ADMIN)', async () => {
      await expect(
        service.createPolicy('user-a', 'USER', 'org-1', {
          ...validDto,
          delegatorId: 'user-c',
        })
      ).rejects.toThrow(ForbiddenException);
    });

    it('1.4. Chặn tài khoản người dùng inactive (vô hiệu hóa)', async () => {
      mockPrisma.user.findUnique.mockImplementation(({ where }: any) => {
        if (where.id === 'user-a') {
          return Promise.resolve({
            id: 'user-a',
            fullName: 'Nguyen Van A',
            isActive: false, // Inactive!
            organizationId: 'org-1',
          });
        }
        if (where.id === 'user-b') {
          return Promise.resolve({
            id: 'user-b',
            fullName: 'Tran Thi B',
            isActive: true,
            organizationId: 'org-1',
          });
        }
        return Promise.resolve(null);
      });

      await expect(
        service.createPolicy('user-a', 'USER', 'org-1', validDto)
      ).rejects.toThrow('vô hiệu hóa');
    });

    it('1.5. Chặn vi phạm ranh giới tổ chức (Tenant Isolation: khác organizationId)', async () => {
      mockPrisma.user.findUnique.mockImplementation(({ where }: any) => {
        if (where.id === 'user-a') {
          return Promise.resolve({
            id: 'user-a',
            fullName: 'Nguyen Van A',
            isActive: true,
            organizationId: 'org-1',
          });
        }
        if (where.id === 'user-b') {
          return Promise.resolve({
            id: 'user-b',
            fullName: 'Tran Thi B',
            isActive: true,
            organizationId: 'org-2', // Khác org!
          });
        }
        return Promise.resolve(null);
      });

      await expect(
        service.createPolicy('user-a', 'USER', 'org-1', validDto)
      ).rejects.toThrow('Tenant Isolation');
    });

    it('1.6. Chặn chu trình trực tiếp A -> B -> A (Direct cycle detection)', async () => {
      mockPrisma.user.findUnique.mockImplementation(({ where }: any) => {
        if (where.id === 'user-a') {
          return Promise.resolve({
            id: 'user-a',
            fullName: 'Nguyen Van A',
            isActive: true,
            organizationId: 'org-1',
          });
        }
        if (where.id === 'user-b') {
          return Promise.resolve({
            id: 'user-b',
            fullName: 'Tran Thi B',
            isActive: true,
            organizationId: 'org-1',
          });
        }
        return Promise.resolve(null);
      });

      // B đã ủy quyền trước đó cho A trong khoảng thời gian này
      mockPrisma.delegationPolicy.findMany.mockResolvedValueOnce([
        {
          id: 'existing-p1',
          delegatorId: 'user-b',
          delegateeId: 'user-a',
          startDate: new Date('2026-10-20T00:00:00.000Z'),
          endDate: new Date('2026-11-05T00:00:00.000Z'),
          scopeDepartmentId: null,
          scopeTemplateId: null,
        },
      ]);

      await expect(
        service.createPolicy('user-a', 'USER', 'org-1', validDto)
      ).rejects.toThrow('chu trình ủy quyền khép kín');
    });

    it('1.7. Chặn chu trình gián tiếp A -> B -> C -> A (Indirect cycle detection)', async () => {
      mockPrisma.user.findUnique.mockImplementation(({ where }: any) => {
        if (where.id === 'user-a') {
          return Promise.resolve({
            id: 'user-a',
            fullName: 'Nguyen Van A',
            isActive: true,
            organizationId: 'org-1',
          });
        }
        if (where.id === 'user-b') {
          return Promise.resolve({
            id: 'user-b',
            fullName: 'Tran Thi B',
            isActive: true,
            organizationId: 'org-1',
          });
        }
        return Promise.resolve(null);
      });

      // B đã ủy quyền cho C, và C đã ủy quyền cho A
      mockPrisma.delegationPolicy.findMany.mockResolvedValueOnce([
        {
          id: 'p-b-c',
          delegatorId: 'user-b',
          delegateeId: 'user-c',
          startDate: new Date('2026-10-20T00:00:00.000Z'),
          endDate: new Date('2026-11-05T00:00:00.000Z'),
          scopeDepartmentId: null,
          scopeTemplateId: null,
        },
        {
          id: 'p-c-a',
          delegatorId: 'user-c',
          delegateeId: 'user-a',
          startDate: new Date('2026-10-20T00:00:00.000Z'),
          endDate: new Date('2026-11-05T00:00:00.000Z'),
          scopeDepartmentId: null,
          scopeTemplateId: null,
        },
      ]);

      await expect(
        service.createPolicy('user-a', 'USER', 'org-1', validDto)
      ).rejects.toThrow('chu trình ủy quyền khép kín');
    });

    it('1.8. Temporal cycle detection: Không chặn chu trình nếu các cạnh không có thời gian giao nhau chung (Disjoint windows)', async () => {
      // A -> B: tháng 1-3
      // B -> C: tháng 4-6
      // Policy mới: C -> A: tháng 2-5
      const existing = [
        {
          id: 'p-a-b',
          delegatorId: 'user-a',
          delegateeId: 'user-b',
          startDate: new Date('2026-01-01T00:00:00.000Z'),
          endDate: new Date('2026-03-31T23:59:59.000Z'),
        },
        {
          id: 'p-b-c',
          delegatorId: 'user-b',
          delegateeId: 'user-c',
          startDate: new Date('2026-04-01T00:00:00.000Z'),
          endDate: new Date('2026-06-30T23:59:59.000Z'),
        },
      ];

      const newEdge = {
        delegatorId: 'user-c',
        delegateeId: 'user-a',
        startDate: new Date('2026-02-01T00:00:00.000Z'),
        endDate: new Date('2026-05-31T23:59:59.000Z'),
      };

      const hasCycle = service.checkTemporalCycle(existing, newEdge);
      expect(hasCycle).toBe(false);
    });

    it('1.9. Temporal cycle detection: Phát hiện chu trình khi có thời gian giao nhau chung (Overlapping windows)', async () => {
      // A -> B: tháng 1-5
      // B -> C: tháng 3-7
      // Policy mới: C -> A: tháng 2-6
      const existing = [
        {
          id: 'p-a-b',
          delegatorId: 'user-a',
          delegateeId: 'user-b',
          startDate: new Date('2026-01-01T00:00:00.000Z'),
          endDate: new Date('2026-05-31T23:59:59.000Z'),
        },
        {
          id: 'p-b-c',
          delegatorId: 'user-b',
          delegateeId: 'user-c',
          startDate: new Date('2026-03-01T00:00:00.000Z'),
          endDate: new Date('2026-07-31T23:59:59.000Z'),
        },
      ];

      const newEdge = {
        delegatorId: 'user-c',
        delegateeId: 'user-a',
        startDate: new Date('2026-02-01T00:00:00.000Z'),
        endDate: new Date('2026-06-30T23:59:59.000Z'),
      };

      const hasCycle = service.checkTemporalCycle(existing, newEdge);
      expect(hasCycle).toBe(true);
    });

    it('1.10. Tạo chính sách thành công, ghi AuditLog và gửi Notification', async () => {
      mockPrisma.user.findUnique.mockImplementation(({ where }: any) => {
        if (where.id === 'user-a') {
          return Promise.resolve({
            id: 'user-a',
            fullName: 'Nguyen Van A',
            email: 'a@example.com',
            isActive: true,
            organizationId: 'org-1',
          });
        }
        if (where.id === 'user-b') {
          return Promise.resolve({
            id: 'user-b',
            fullName: 'Tran Thi B',
            email: 'b@example.com',
            isActive: true,
            organizationId: 'org-1',
          });
        }
        return Promise.resolve(null);
      });

      mockPrisma.delegationPolicy.findMany.mockResolvedValueOnce([]); // Không có xung đột
      mockPrisma.delegationPolicy.create.mockResolvedValueOnce({
        id: 'policy-new-1',
        organizationId: 'org-1',
        delegatorId: 'user-a',
        delegateeId: 'user-b',
        startDate: new Date('2026-10-24T00:00:00.000Z'),
        endDate: new Date('2026-10-30T00:00:00.000Z'),
        scopeDepartmentId: null,
        scopeTemplateId: null,
        reason: 'Đi công tác nước ngoài',
        isActive: true,
        createdById: 'user-a',
        revokedAt: null,
        revokedById: null,
        createdAt: new Date('2026-10-23T12:00:00.000Z'),
        updatedAt: new Date('2026-10-23T12:00:00.000Z'),
        delegator: { fullName: 'Nguyen Van A', email: 'a@example.com' },
        delegatee: { fullName: 'Tran Thi B', email: 'b@example.com' },
        createdBy: { fullName: 'Nguyen Van A' },
      });

      const result = await service.createPolicy('user-a', 'USER', 'org-1', validDto);

      expect(result.id).toBe('policy-new-1');
      expect(result.delegatorName).toBe('Nguyen Van A');
      expect(result.delegateeName).toBe('Tran Thi B');
      expect(mockPrisma.auditLog.create).toHaveBeenCalled();
      expect(mockNotificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-b',
          type: NotificationType.DELEGATION_ASSIGNED,
        })
      );
    });
  });

  describe('2. revokePolicy (Thu hồi chính sách - Soft Revoke)', () => {
    it('2.1. Delegator thu hồi chính sách của mình thành công và gửi thông báo cho delegatee', async () => {
      const existingPolicy = {
        id: 'policy-1',
        organizationId: 'org-1',
        delegatorId: 'user-a',
        delegateeId: 'user-b',
        isActive: true,
        reason: 'Lý do ban đầu',
        delegator: { fullName: 'Nguyen Van A', email: 'a@example.com' },
        delegatee: { fullName: 'Tran Thi B', email: 'b@example.com' },
      };

      mockPrisma.delegationPolicy.findUnique.mockResolvedValueOnce(existingPolicy);
      mockPrisma.delegationPolicy.update.mockResolvedValueOnce({
        ...existingPolicy,
        isActive: false,
        revokedAt: new Date(),
        revokedById: 'user-a',
        startDate: new Date('2026-10-24'),
        endDate: new Date('2026-10-30'),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await service.revokePolicy('policy-1', 'user-a', 'USER', 'org-1', 'Về sớm hơn dự kiến');

      expect(res.isActive).toBe(false);
      expect(mockPrisma.auditLog.create).toHaveBeenCalled();
      expect(mockNotificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-b',
          type: NotificationType.DELEGATION_REVOKED,
        })
      );
    });

    it('2.2. Người ngoài không có quyền thu hồi chính sách (ForbiddenException)', async () => {
      mockPrisma.delegationPolicy.findUnique.mockResolvedValueOnce({
        id: 'policy-1',
        organizationId: 'org-1',
        delegatorId: 'user-a',
        delegateeId: 'user-b',
        isActive: true,
      });

      await expect(
        service.revokePolicy('policy-1', 'user-stranger', 'USER', 'org-1')
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('3. resolveActiveDelegation (Deterministic Policy Resolution Engine)', () => {
    const mockStep = {
      id: 'step-1',
      stepName: 'Phê duyệt ban giám đốc',
      assignees: [
        {
          id: 'asg-1',
          userId: 'director-a',
          role: AssigneeRole.APPROVER,
          decision: AssigneeDecision.PENDING,
          user: { id: 'director-a', fullName: 'Giam Doc A', email: 'a@corp.vn', isActive: true },
        },
      ],
    };

    it('3.1. Trả về null nếu không có chính sách nào khớp thời gian hoặc scope', async () => {
      mockPrisma.delegationPolicy.findMany.mockResolvedValueOnce([]);

      const result = await service.resolveActiveDelegation({
        document: { id: 'doc-1', organizationId: 'org-1', templateId: 'tpl-1' },
        step: mockStep,
        actorId: 'delegatee-x',
        now: new Date('2026-10-25T10:00:00Z'),
      });

      expect(result).toBeNull();
    });

    it('3.2. Deterministic specificity scoring: Ưu tiên template-specific policy hơn org-wide policy', async () => {
      const orgWidePolicy = {
        id: 'policy-org-wide',
        delegatorId: 'director-a',
        delegateeId: 'deputy-b',
        organizationId: 'org-1',
        scopeDepartmentId: null,
        scopeTemplateId: null,
        createdAt: new Date('2026-10-20'),
        delegator: { id: 'director-a', fullName: 'Giam Doc A', email: 'a@corp.vn' },
        delegatee: { id: 'deputy-b', fullName: 'Pho Giam Doc B', email: 'b@corp.vn' },
      };

      const templateSpecificPolicy = {
        id: 'policy-template-specific',
        delegatorId: 'director-a',
        delegateeId: 'deputy-b',
        organizationId: 'org-1',
        scopeDepartmentId: null,
        scopeTemplateId: 'tpl-payment',
        createdAt: new Date('2026-10-21'),
        delegator: { id: 'director-a', fullName: 'Giam Doc A', email: 'a@corp.vn' },
        delegatee: { id: 'deputy-b', fullName: 'Pho Giam Doc B', email: 'b@corp.vn' },
      };

      // Giả lập DB trả về cả 2 chính sách khớp
      mockPrisma.delegationPolicy.findMany.mockResolvedValueOnce([
        orgWidePolicy,
        templateSpecificPolicy,
      ]);

      const result = await service.resolveActiveDelegation({
        document: {
          id: 'doc-1',
          organizationId: 'org-1',
          templateId: 'tpl-payment', // Khớp templateId của templateSpecificPolicy
        },
        step: mockStep,
        actorId: 'deputy-b',
        now: new Date('2026-10-25T10:00:00Z'),
      });

      expect(result).not.toBeNull();
      // Phải chọn templateSpecificPolicy (Score 2) thay vì orgWidePolicy (Score 0)
      expect(result!.policy.id).toBe('policy-template-specific');
      expect(result!.assignee.userId).toBe('director-a');
      expect(result!.delegatorName).toBe('Giam Doc A');
    });

    it('3.3. Deterministic tie-breaker: Khi score và createdAt hoàn toàn bằng nhau, tie-break bằng id (localeCompare)', async () => {
      const fixedCreatedAt = new Date('2026-10-22T08:00:00.000Z');
      const policyAlpha = {
        id: 'policy-aaa',
        delegatorId: 'director-a',
        delegateeId: 'deputy-b',
        organizationId: 'org-1',
        scopeDepartmentId: null,
        scopeTemplateId: null,
        createdAt: fixedCreatedAt,
        delegator: { id: 'director-a', fullName: 'Giam Doc A', email: 'a@corp.vn' },
        delegatee: { id: 'deputy-b', fullName: 'Pho Giam Doc B', email: 'b@corp.vn' },
      };

      const policyZeta = {
        id: 'policy-zzz',
        delegatorId: 'director-a',
        delegateeId: 'deputy-b',
        organizationId: 'org-1',
        scopeDepartmentId: null,
        scopeTemplateId: null,
        createdAt: fixedCreatedAt, // createdAt trùng nhau từng mili-giây
        delegator: { id: 'director-a', fullName: 'Giam Doc A', email: 'a@corp.vn' },
        delegatee: { id: 'deputy-b', fullName: 'Pho Giam Doc B', email: 'b@corp.vn' },
      };

      // Đưa policy-aaa trước, policy-zzz sau
      mockPrisma.delegationPolicy.findMany.mockResolvedValueOnce([
        policyAlpha,
        policyZeta,
      ]);

      const result = await service.resolveActiveDelegation({
        document: { id: 'doc-1', organizationId: 'org-1' },
        step: mockStep,
        actorId: 'deputy-b',
        now: new Date('2026-10-25T10:00:00Z'),
      });

      expect(result).not.toBeNull();
      // 'policy-zzz'.localeCompare('policy-aaa') > 0 -> policy-zzz được chọn một cách nhất quán (deterministic)
      expect(result!.policy.id).toBe('policy-zzz');
    });
  });

  describe('4. getPolicies (Tenant Isolation & RBAC Controls)', () => {
    it('4.1. USER query với role=all chỉ trả về policy của chính mình (OR: delegatorId = user hoặc delegateeId = user)', async () => {
      mockPrisma.delegationPolicy.count.mockResolvedValueOnce(0);
      mockPrisma.delegationPolicy.findMany.mockResolvedValueOnce([]);

      await service.getPolicies('user-1', 'USER', 'org-alpha', { role: 'all' });

      expect(mockPrisma.delegationPolicy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'org-alpha',
            OR: [{ delegatorId: 'user-1' }, { delegateeId: 'user-1' }],
          },
        })
      );
    });

    it('4.2. ADMIN bị khóa cứng vào organizationId của mình và không thể vượt quyền xem tổ chức khác', async () => {
      mockPrisma.delegationPolicy.count.mockResolvedValueOnce(0);
      mockPrisma.delegationPolicy.findMany.mockResolvedValueOnce([]);

      await service.getPolicies('admin-1', 'ADMIN', 'org-alpha', { organizationId: 'org-beta' as any });

      expect(mockPrisma.delegationPolicy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'org-alpha', // Khóa cứng vào org của admin, bỏ qua org-beta do client gửi
          },
        })
      );
    });
  });
});
