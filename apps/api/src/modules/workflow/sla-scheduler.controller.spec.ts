import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SlaSchedulerController } from './sla-scheduler.controller.js';
import { ForbiddenException } from '@nestjs/common';
import { UserPrincipal } from '../../common/interfaces/user-principal.interface.js';

describe('SlaSchedulerController (Unit Tests)', () => {
  let controller: SlaSchedulerController;
  let mockSchedulerService: any;
  let mockPrisma: any;

  beforeEach(() => {
    mockSchedulerService = {
      processSlaChecks: vi.fn().mockResolvedValue({
        scannedStepsCount: 2,
        warningsSent: 1,
        overduesSent: 1,
        skippedAlreadySent: 0,
        errorsCount: 0,
        details: [],
      }),
    };

    mockPrisma = {
      document: {
        count: vi.fn().mockImplementation((args) => {
          if (args.where?.dueDate?.lt) return Promise.resolve(1);
          if (args.where?.dueDate?.gte) return Promise.resolve(2);
          return Promise.resolve(5); // total
        }),
      },
    };

    controller = new SlaSchedulerController(mockSchedulerService, mockPrisma);
  });

  it('1. ADMIN kích hoạt triggerSlaCheck thành công với phạm vi tổ chức (Tenant Isolation)', async () => {
    const adminUser: UserPrincipal = {
      id: 'admin-1',
      email: 'admin@vinagroup.vn',
      fullName: 'Admin User',
      role: 'ADMIN',
      organizationId: 'org-1',
      departmentId: null,
    };

    const res = await controller.triggerSlaCheck(adminUser);
    expect(res.success).toBe(true);
    expect(mockSchedulerService.processSlaChecks).toHaveBeenCalledWith(expect.any(Date), 'org-1');
  });

  it('2. SUPER_ADMIN kích hoạt triggerSlaCheck thành công trên phạm vi toàn hệ thống', async () => {
    const superAdmin: UserPrincipal = {
      id: 'sa-1',
      email: 'sa@vinagroup.vn',
      fullName: 'Super Admin',
      role: 'SUPER_ADMIN',
      organizationId: null,
      departmentId: null,
    };

    const res = await controller.triggerSlaCheck(superAdmin);
    expect(res.success).toBe(true);
    expect(mockSchedulerService.processSlaChecks).toHaveBeenCalledWith(expect.any(Date), undefined);
  });

  it('3. USER thông thường bị chặn 403 Forbidden khi triggerSlaCheck', async () => {
    const regularUser: UserPrincipal = {
      id: 'user-1',
      email: 'user@vinagroup.vn',
      fullName: 'Regular User',
      role: 'USER',
      organizationId: 'org-1',
      departmentId: null,
    };

    await expect(controller.triggerSlaCheck(regularUser)).rejects.toThrow(ForbiddenException);
    expect(mockSchedulerService.processSlaChecks).not.toHaveBeenCalled();
  });

  it('4. getSlaStatus trả về thống kê SLA chính xác theo tổ chức', async () => {
    const adminUser: UserPrincipal = {
      id: 'admin-1',
      email: 'admin@vinagroup.vn',
      fullName: 'Admin User',
      role: 'ADMIN',
      organizationId: 'org-alpha',
      departmentId: null,
    };

    const res = await controller.getSlaStatus(adminUser);
    expect(res.success).toBe(true);
    expect(res.data.totalInReview).toBe(5);
    expect(res.data.overdueCount).toBe(1);
    expect(res.data.nearDueCount).toBe(2);
    expect(res.data.onTrackCount).toBe(2);
    expect(mockPrisma.document.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-alpha' }) })
    );
  });

  it('5. USER thông thường bị chặn 403 Forbidden khi gọi getSlaStatus', async () => {
    const regularUser: UserPrincipal = {
      id: 'user-1',
      email: 'user@vinagroup.vn',
      fullName: 'Regular User',
      role: 'USER',
      organizationId: 'org-alpha',
      departmentId: null,
    };

    await expect(controller.getSlaStatus(regularUser)).rejects.toThrow(ForbiddenException);
    expect(mockPrisma.document.count).not.toHaveBeenCalled();
  });
});

