import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TemplateStatus, UserRole } from '@prisma/client';
import { WorkflowTemplateService } from './workflow-template.service.js';
import { UserPrincipal } from '../../common/interfaces/user-principal.interface.js';
import { WorkflowStepConfig } from '@trinh-ky/shared';

describe('WorkflowTemplateService (Workflow Builder & Versioned Approval Engine)', () => {
  let service: WorkflowTemplateService;
  let mockPrisma: any;

  const mockAdminUser: UserPrincipal = {
    id: 'admin-01',
    email: 'admin@vinagroup.vn',
    fullName: 'Admin VinaGroup',
    role: UserRole.ADMIN,
    organizationId: 'org-alpha',
    departmentId: 'dept-01',
  };

  const mockOtherAdmin: UserPrincipal = {
    id: 'admin-02',
    email: 'admin2@vinagroup.vn',
    fullName: 'Admin Cong Ty Beta',
    role: UserRole.ADMIN,
    organizationId: 'org-beta',
    departmentId: 'dept-02',
  };

  const mockRegularUser: UserPrincipal = {
    id: 'user-01',
    email: 'user@vinagroup.vn',
    fullName: 'Nhân viên A',
    role: UserRole.USER,
    organizationId: 'org-alpha',
    departmentId: 'dept-01',
  };

  const mockSuperAdmin: UserPrincipal = {
    id: 'super-admin-01',
    email: 'superadmin@vinagroup.vn',
    fullName: 'Super Admin',
    role: UserRole.SUPER_ADMIN,
    organizationId: null,
    departmentId: null,
  };

  const sampleValidSteps: WorkflowStepConfig[] = [
    {
      stepKey: 'step_manager',
      stepName: 'Trưởng phòng phê duyệt',
      stepOrder: 1,
      stepType: 'SEQUENTIAL',
      completionRule: 'ALL_MUST_APPROVE',
      approverConfig: {
        type: 'DEPARTMENT_ROLE',
        role: 'MANAGER',
        departmentPolicy: 'SAME_AS_DOCUMENT',
      },
      reviewerUserIds: [],
    },
    {
      stepKey: 'step_director',
      stepName: 'Giám đốc phê duyệt',
      stepOrder: 2,
      stepType: 'SEQUENTIAL',
      completionRule: 'ANY_CAN_APPROVE',
      approverConfig: {
        type: 'ORGANIZATION_ROLE',
        role: 'DIRECTOR',
      },
      reviewerUserIds: [],
    },
  ];

  beforeEach(() => {
    mockPrisma = {
      workflowTemplate: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      workflowTemplateVersion: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
    };

    service = new WorkflowTemplateService(mockPrisma);
  });

  describe('Phân quyền & Khởi tạo (createWorkflowTemplate)', () => {
    it('Chặn nhân viên thường (USER) tạo quy trình phê duyệt', async () => {
      await expect(
        service.createWorkflowTemplate(
          {
            code: 'WF_TEST',
            title: 'Quy trình test',
            steps: sampleValidSteps,
          },
          mockRegularUser,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Chặn ADMIN công ty tạo quy trình dùng chung toàn hệ thống (organizationId: null)', async () => {
      await expect(
        service.createWorkflowTemplate(
          {
            code: 'WF_GLOBAL',
            title: 'Quy trình toàn hệ thống',
            organizationId: null,
            steps: sampleValidSteps,
          },
          mockAdminUser,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Cho phép SUPER_ADMIN tạo quy trình dùng chung toàn hệ thống', async () => {
      mockPrisma.workflowTemplate.findUnique.mockResolvedValue(null);
      mockPrisma.workflowTemplate.create.mockResolvedValue({
        id: 'wf-global-01',
        code: 'WF_GLOBAL',
        title: 'Quy trình toàn hệ thống',
        organizationId: null,
        status: TemplateStatus.DRAFT,
        steps: sampleValidSteps,
      });

      const res = await service.createWorkflowTemplate(
        {
          code: 'WF_GLOBAL',
          title: 'Quy trình toàn hệ thống',
          organizationId: null,
          steps: sampleValidSteps,
        },
        mockSuperAdmin,
      );

      expect(res.data.id).toBe('wf-global-01');
      expect(mockPrisma.workflowTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: null,
            createdById: mockSuperAdmin.id,
          }),
        }),
      );
    });

    it('Bắt buộc ADMIN công ty phải gán quy trình cho công ty của mình', async () => {
      mockPrisma.workflowTemplate.findUnique.mockResolvedValue(null);
      mockPrisma.workflowTemplate.create.mockResolvedValue({
        id: 'wf-alpha-01',
        code: 'WF_CHI_TIEU',
        title: 'Quy trình chi tiêu',
        organizationId: 'org-alpha',
        status: TemplateStatus.DRAFT,
        steps: sampleValidSteps,
      });

      const res = await service.createWorkflowTemplate(
        {
          code: 'WF_CHI_TIEU',
          title: 'Quy trình chi tiêu',
          steps: sampleValidSteps,
        },
        mockAdminUser,
      );

      expect(res.data.id).toBe('wf-alpha-01');
      expect(mockPrisma.workflowTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: 'org-alpha',
          }),
        }),
      );
    });

    it('Báo lỗi ConflictException (409) khi trùng mã code trong cùng tổ chức', async () => {
      mockPrisma.workflowTemplate.findUnique.mockResolvedValue({
        id: 'existing-wf',
        code: 'WF_DUPLICATE',
      });

      await expect(
        service.createWorkflowTemplate(
          {
            code: 'WF_DUPLICATE',
            title: 'Quy trình trùng mã',
            steps: sampleValidSteps,
          },
          mockAdminUser,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('Báo lỗi BadRequestException khi cấu hình bước không hợp lệ (bước rỗng)', async () => {
      await expect(
        service.createWorkflowTemplate(
          {
            code: 'WF_INVALID',
            title: 'Quy trình lỗi',
            steps: [],
          },
          mockAdminUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('Báo lỗi BadRequestException khi thứ tự bước không liên tục từ 1 (1, 3)', async () => {
      const invalidSteps: WorkflowStepConfig[] = [
        {
          stepKey: 'step_1',
          stepName: 'Bước 1',
          stepOrder: 1,
          stepType: 'SEQUENTIAL',
          completionRule: 'ALL_MUST_APPROVE',
          approverConfig: { type: 'ORGANIZATION_ROLE', role: 'DIRECTOR' },
          reviewerUserIds: [],
        },
        {
          stepKey: 'step_3',
          stepName: 'Bước 3',
          stepOrder: 3, // Lỗi: nhảy cóc thứ tự
          stepType: 'SEQUENTIAL',
          completionRule: 'ALL_MUST_APPROVE',
          approverConfig: { type: 'ORGANIZATION_ROLE', role: 'DIRECTOR' },
          reviewerUserIds: [],
        },
      ];

      await expect(
        service.createWorkflowTemplate(
          {
            code: 'WF_GAP_ORDER',
            title: 'Quy trình lỗi order',
            steps: invalidSteps,
          },
          mockAdminUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('Báo lỗi BadRequestException khi trùng lặp stepKey', async () => {
      const duplicateKeySteps: WorkflowStepConfig[] = [
        {
          stepKey: 'step_duplicate',
          stepName: 'Bước 1',
          stepOrder: 1,
          stepType: 'SEQUENTIAL',
          completionRule: 'ALL_MUST_APPROVE',
          approverConfig: { type: 'ORGANIZATION_ROLE', role: 'DIRECTOR' },
          reviewerUserIds: [],
        },
        {
          stepKey: 'step_duplicate',
          stepName: 'Bước 2',
          stepOrder: 2,
          stepType: 'SEQUENTIAL',
          completionRule: 'ALL_MUST_APPROVE',
          approverConfig: { type: 'ORGANIZATION_ROLE', role: 'DIRECTOR' },
          reviewerUserIds: [],
        },
      ];

      await expect(
        service.createWorkflowTemplate(
          {
            code: 'WF_DUP_KEY',
            title: 'Quy trình trùng stepKey',
            steps: duplicateKeySteps,
          },
          mockAdminUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Bảo vệ Đa tổ chức (Tenant Isolation)', () => {
    it('Chặn ADMIN công ty Alpha sửa quy trình thuộc công ty Beta', async () => {
      mockPrisma.workflowTemplate.findUnique.mockResolvedValue({
        id: 'wf-beta-01',
        organizationId: 'org-beta',
        status: TemplateStatus.DRAFT,
      });

      await expect(
        service.updateWorkflowTemplate(
          'wf-beta-01',
          {
            title: 'Sửa trộm quy trình',
          },
          mockAdminUser,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Chặn ADMIN công ty sửa quy trình dùng chung toàn hệ thống (organizationId: null)', async () => {
      mockPrisma.workflowTemplate.findUnique.mockResolvedValue({
        id: 'wf-global-01',
        organizationId: null,
        status: TemplateStatus.DRAFT,
      });

      await expect(
        service.updateWorkflowTemplate(
          'wf-global-01',
          {
            title: 'Sửa quy trình dùng chung',
          },
          mockAdminUser,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Cho phép SUPER_ADMIN chỉnh sửa quy trình toàn hệ thống', async () => {
      mockPrisma.workflowTemplate.findUnique.mockResolvedValue({
        id: 'wf-global-01',
        organizationId: null,
        status: TemplateStatus.DRAFT,
        code: 'WF_GLOBAL',
        title: 'Cũ',
        steps: sampleValidSteps,
      });
      mockPrisma.workflowTemplate.update.mockResolvedValue({
        id: 'wf-global-01',
        title: 'Mới được cập nhật',
        status: TemplateStatus.DRAFT,
      });

      const res = await service.updateWorkflowTemplate(
        'wf-global-01',
        {
          title: 'Mới được cập nhật',
        },
        mockSuperAdmin,
      );

      expect(res.data.title).toBe('Mới được cập nhật');
    });
  });

  describe('Vòng đời Phát hành & Bản nháp (Lifecycle & Draft Versioning)', () => {
    it('Phát hành quy trình bản nháp ban đầu (v1) thành công', async () => {
      mockPrisma.workflowTemplate.findUnique.mockResolvedValue({
        id: 'wf-01',
        code: 'WF_TAM_UNG',
        organizationId: 'org-alpha',
        status: TemplateStatus.DRAFT,
        currentVersion: 1,
        title: 'Quy trình tạm ứng',
        category: 'Tài chính',
        steps: sampleValidSteps,
        versions: [],
      });

      mockPrisma.workflowTemplateVersion.create.mockResolvedValue({
        id: 'v1-id',
        workflowTemplateId: 'wf-01',
        versionNumber: 1,
        status: TemplateStatus.PUBLISHED,
        contentHash: 'hash-v1',
      });

      mockPrisma.workflowTemplate.update.mockResolvedValue({
        id: 'wf-01',
        status: TemplateStatus.PUBLISHED,
        currentVersion: 1,
      });

      const res = await service.publishWorkflowTemplate(
        'wf-01',
        {
          releaseNotes: 'Phát hành v1',
        },
        mockAdminUser,
      );

      expect(res.data.status).toBe(TemplateStatus.PUBLISHED);
      expect(mockPrisma.workflowTemplateVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            versionNumber: 1,
            status: TemplateStatus.PUBLISHED,
          }),
        }),
      );
    });

    it('Tạo bản nháp cho phiên bản tiếp theo (v2) từ quy trình đã PUBLISHED', async () => {
      mockPrisma.workflowTemplate.findUnique.mockResolvedValue({
        id: 'wf-01',
        code: 'WF_TAM_UNG',
        organizationId: 'org-alpha',
        status: TemplateStatus.PUBLISHED,
        currentVersion: 1,
        title: 'Quy trình tạm ứng',
        category: 'Tài chính',
        steps: sampleValidSteps,
        versions: [],
      });

      mockPrisma.workflowTemplateVersion.create.mockResolvedValue({
        id: 'v2-draft-id',
        workflowTemplateId: 'wf-01',
        versionNumber: 2,
        status: TemplateStatus.DRAFT,
        steps: sampleValidSteps,
        createdAt: new Date(),
      });

      const res = await service.createDraftVersion('wf-01', mockAdminUser);

      expect(res.data.versionNumber).toBe(2);
      expect(res.data.status).toBe(TemplateStatus.DRAFT);
    });

    it('Hủy bản nháp v2 an toàn (discardDraftVersion) mà không làm mất v1', async () => {
      mockPrisma.workflowTemplate.findUnique.mockResolvedValue({
        id: 'wf-01',
        code: 'WF_TAM_UNG',
        organizationId: 'org-alpha',
        status: TemplateStatus.PUBLISHED,
        currentVersion: 1,
        versions: [
          {
            id: 'v2-draft-id',
            versionNumber: 2,
            status: TemplateStatus.DRAFT,
          },
        ],
      });

      mockPrisma.workflowTemplateVersion.delete.mockResolvedValue({
        id: 'v2-draft-id',
      });

      const res = await service.discardDraftVersion('wf-01', mockAdminUser);
      expect(res.success).toBe(true);
      expect(mockPrisma.workflowTemplateVersion.delete).toHaveBeenCalledWith({
        where: { id: 'v2-draft-id' },
      });
    });

    it('Bắt lỗi 409 Conflict khi xảy ra tranh chấp phát hành đồng thời (Concurrency Lock)', async () => {
      mockPrisma.workflowTemplate.findUnique.mockResolvedValue({
        id: 'wf-01',
        code: 'WF_TAM_UNG',
        organizationId: 'org-alpha',
        status: TemplateStatus.DRAFT,
        currentVersion: 1,
        title: 'Quy trình',
        category: 'Chung',
        steps: sampleValidSteps,
        versions: [],
      });

      // Giả lập lỗi Unique Constraint P2002 từ Prisma
      const p2002Error: any = new Error('Unique constraint failed');
      p2002Error.code = 'P2002';
      mockPrisma.workflowTemplateVersion.create.mockRejectedValue(p2002Error);

      await expect(
        service.publishWorkflowTemplate(
          'wf-01',
          {
            releaseNotes: 'Publish cùng lúc',
          },
          mockAdminUser,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });
});
