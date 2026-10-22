import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TemplateStatus, UserRole } from '@prisma/client';
import { TemplateService } from './template.service.js';
import { UserPrincipal } from '../../common/interfaces/user-principal.interface.js';

describe('TemplateService (Form Builder & Dynamic Template Engine)', () => {
  let service: TemplateService;
  let mockPrisma: any;

  const mockAdminUser: UserPrincipal = {
    id: 'admin-01',
    email: 'admin@vinagroup.vn',
    fullName: 'Admin VinaGroup',
    role: UserRole.ADMIN,
    organizationId: 'org-alpha',
    departmentId: 'dept-01',
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

  const sampleValidFields = [
    {
      id: 'f1',
      key: 'so_tien',
      label: 'Số tiền tạm ứng',
      type: 'number' as const,
      required: true,
      order: 1,
      validation: { min: 10000 },
    },
    {
      id: 'f2',
      key: 'ly_do',
      label: 'Lý do tạm ứng',
      type: 'text' as const,
      required: true,
      order: 2,
    },
  ];

  beforeEach(() => {
    mockPrisma = {
      formTemplate: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      formTemplateVersion: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      $transaction: vi.fn(async (cb) => cb(mockPrisma)),
    };

    service = new TemplateService(mockPrisma as any);
  });

  describe('1. createTemplate', () => {
    it('Chặn người dùng thường (USER) tạo template (403 Forbidden)', async () => {
      await expect(
        service.createTemplate(
          {
            code: 'TAM_UNG',
            title: 'Giấy đề nghị tạm ứng',
            fields: sampleValidFields,
          },
          mockRegularUser
        )
      ).rejects.toThrow(ForbiddenException);
    });

    it('ADMIN tạo template thành công ở trạng thái DRAFT v1', async () => {
      mockPrisma.formTemplate.findUnique.mockResolvedValue(null);
      mockPrisma.formTemplate.create.mockResolvedValue({
        id: 'tmpl-01',
        code: 'TAM_UNG',
        title: 'Giấy đề nghị tạm ứng',
        status: TemplateStatus.DRAFT,
        currentVersion: 1,
      });

      const res = await service.createTemplate(
        {
          code: 'TAM_UNG',
          title: 'Giấy đề nghị tạm ứng',
          fields: sampleValidFields,
        },
        mockAdminUser
      );

      expect(res.success).toBe(true);
      expect(res.data.status).toBe(TemplateStatus.DRAFT);
      expect(res.data.currentVersion).toBe(1);
      expect(mockPrisma.formTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: 'org-alpha',
            status: TemplateStatus.DRAFT,
          }),
        })
      );
    });

    it('Chặn tạo template nếu schema có key trùng lặp', async () => {
      const duplicateFields = [
        { id: '1', key: 'so_tien', label: 'Tiền', type: 'number' as const, required: true, order: 1 },
        { id: '2', key: 'so_tien', label: 'Tiền 2', type: 'number' as const, required: true, order: 2 },
      ];

      await expect(
        service.createTemplate(
          {
            code: 'TRUNG_KEY',
            title: 'Mẫu trùng key',
            fields: duplicateFields,
          },
          mockAdminUser
        )
      ).rejects.toThrow(BadRequestException);
    });

    it('Chặn tạo template nếu mã code đã tồn tại (409 Conflict)', async () => {
      mockPrisma.formTemplate.findUnique.mockResolvedValue({ id: 'existed' });

      await expect(
        service.createTemplate(
          {
            code: 'DA_CO',
            title: 'Mẫu trùng code',
            fields: sampleValidFields,
          },
          mockAdminUser
        )
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('2. updateTemplate', () => {
    it('Chặn sửa template khi đã PUBLISHED (400 BadRequest)', async () => {
      mockPrisma.formTemplate.findUnique.mockResolvedValue({
        id: 'tmpl-01',
        status: TemplateStatus.PUBLISHED,
        organizationId: 'org-alpha',
        code: 'TAM_UNG',
        title: 'Đã phát hành',
      });

      await expect(
        service.updateTemplate(
          'tmpl-01',
          { title: 'Sửa tiêu đề' },
          mockAdminUser
        )
      ).rejects.toThrow(BadRequestException);
    });

    it('Cho phép ADMIN sửa template đang ở trạng thái DRAFT', async () => {
      mockPrisma.formTemplate.findUnique.mockResolvedValue({
        id: 'tmpl-01',
        status: TemplateStatus.DRAFT,
        organizationId: 'org-alpha',
        code: 'TAM_UNG',
        title: 'Bản nháp',
        fields: sampleValidFields,
      });
      mockPrisma.formTemplate.update.mockResolvedValue({
        id: 'tmpl-01',
        title: 'Bản nháp đã sửa',
        status: TemplateStatus.DRAFT,
        currentVersion: 1,
      });

      const res = await service.updateTemplate(
        'tmpl-01',
        { title: 'Bản nháp đã sửa' },
        mockAdminUser
      );

      expect(res.success).toBe(true);
      expect(res.data.title).toBe('Bản nháp đã sửa');
    });

    it('Chặn ADMIN công ty A sửa template của công ty B (403 Forbidden)', async () => {
      mockPrisma.formTemplate.findUnique.mockResolvedValue({
        id: 'tmpl-beta',
        status: TemplateStatus.DRAFT,
        organizationId: 'org-beta',
      });

      await expect(
        service.updateTemplate('tmpl-beta', { title: 'Hack' }, mockAdminUser)
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('3. publishTemplate (Phát hành & Quản lý phiên bản Versioning)', () => {
    it('Phát hành lần đầu từ DRAFT -> PUBLISHED tạo FormTemplateVersion v1', async () => {
      mockPrisma.formTemplate.findUnique.mockResolvedValue({
        id: 'tmpl-01',
        code: 'TAM_UNG',
        title: 'Giấy đề nghị tạm ứng',
        status: TemplateStatus.DRAFT,
        currentVersion: 1,
        organizationId: 'org-alpha',
        fields: sampleValidFields,
        layoutBlocks: [],
        defaultWorkflowSteps: [],
        versions: [],
      });

      mockPrisma.formTemplateVersion.create.mockResolvedValue({
        id: 'ver-01',
        templateId: 'tmpl-01',
        versionNumber: 1,
      });

      mockPrisma.formTemplate.update.mockResolvedValue({
        id: 'tmpl-01',
        status: TemplateStatus.PUBLISHED,
        currentVersion: 1,
      });

      const res = await service.publishTemplate(
        'tmpl-01',
        { changeSummary: 'Phát hành chính thức v1' },
        mockAdminUser
      );

      expect(res.success).toBe(true);
      expect(res.data.versionNumber).toBe(1);
      expect(mockPrisma.formTemplateVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            templateId: 'tmpl-01',
            versionNumber: 1,
            status: TemplateStatus.PUBLISHED,
          }),
        })
      );
    });

    it('Phát hành phiên bản mới cho template đã PUBLISHED tăng lên v2', async () => {
      mockPrisma.formTemplate.findUnique.mockResolvedValue({
        id: 'tmpl-01',
        code: 'TAM_UNG',
        title: 'Giấy đề nghị tạm ứng',
        status: TemplateStatus.PUBLISHED,
        currentVersion: 1,
        organizationId: 'org-alpha',
        fields: sampleValidFields,
        layoutBlocks: [],
        defaultWorkflowSteps: [],
        versions: [{ id: 'ver-01', versionNumber: 1 }],
      });

      mockPrisma.formTemplateVersion.create.mockResolvedValue({
        id: 'ver-02',
        templateId: 'tmpl-01',
        versionNumber: 2,
      });

      mockPrisma.formTemplate.update.mockResolvedValue({
        id: 'tmpl-01',
        status: TemplateStatus.PUBLISHED,
        currentVersion: 2,
      });

      const res = await service.publishTemplate(
        'tmpl-01',
        { changeSummary: 'Nâng cấp lên v2' },
        mockAdminUser
      );

      expect(res.success).toBe(true);
      expect(res.data.versionNumber).toBe(2);
      expect(mockPrisma.formTemplateVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            versionNumber: 2,
          }),
        })
      );
    });

    it('Chặn phát hành template đã bị ARCHIVED (400 BadRequest)', async () => {
      mockPrisma.formTemplate.findUnique.mockResolvedValue({
        id: 'tmpl-archived',
        status: TemplateStatus.ARCHIVED,
        organizationId: 'org-alpha',
      });

      await expect(
        service.publishTemplate('tmpl-archived', {}, mockAdminUser)
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('4. getTemplates (Danh sách và Phân quyền tổ chức)', () => {
    it('USER chỉ nhìn thấy các template đã PUBLISHED', async () => {
      mockPrisma.formTemplate.count.mockResolvedValue(1);
      mockPrisma.formTemplate.findMany.mockResolvedValue([
        {
          id: 'tmpl-01',
          code: 'TAM_UNG',
          title: 'Tạm ứng',
          status: TemplateStatus.PUBLISHED,
          currentVersion: 1,
          fields: sampleValidFields,
        },
      ]);

      await service.getTemplates(mockRegularUser, {});

      expect(mockPrisma.formTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: TemplateStatus.PUBLISHED,
          }),
        })
      );
    });

    it('ADMIN xem được cả template DRAFT và ARCHIVED của tổ chức mình', async () => {
      mockPrisma.formTemplate.count.mockResolvedValue(2);
      mockPrisma.formTemplate.findMany.mockResolvedValue([]);

      await service.getTemplates(mockAdminUser, { status: 'ALL' });

      expect(mockPrisma.formTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { organizationId: 'org-alpha' },
              { organizationId: null },
            ],
          }),
        })
      );
    });
  });

  describe('5. validateFormDataForTemplate (Xác thực dữ liệu form)', () => {
    it('Báo lỗi nếu thiếu trường bắt buộc', async () => {
      mockPrisma.formTemplate.findUnique.mockResolvedValue({
        id: 'tmpl-01',
        organizationId: 'org-alpha',
        fields: sampleValidFields,
      });

      const res = await service.validateFormDataForTemplate('tmpl-01', {}, mockRegularUser);
      expect(res.valid).toBe(false);
      expect(res.errors['so_tien']).toBeDefined();
      expect(res.errors['ly_do']).toBeDefined();
    });

    it('Thành công nếu dữ liệu điền hợp lệ', async () => {
      mockPrisma.formTemplate.findUnique.mockResolvedValue({
        id: 'tmpl-01',
        organizationId: 'org-alpha',
        fields: sampleValidFields,
      });

      const res = await service.validateFormDataForTemplate(
        'tmpl-01',
        { so_tien: 500000, ly_do: 'Mua văn phòng phẩm' },
        mockRegularUser
      );
      expect(res.valid).toBe(true);
      expect(Object.keys(res.errors)).toHaveLength(0);
    });
  });

  describe('6. Hardened Authorization & Next Draft Version Lifecycle', () => {
    it('Chặn ADMIN công ty Alpha sửa hoặc phát hành biểu mẫu dùng chung toàn hệ thống (organizationId: null)', async () => {
      mockPrisma.formTemplate.findUnique.mockResolvedValue({
        id: 'tmpl-system',
        organizationId: null, // Mẫu toàn hệ thống
        status: TemplateStatus.DRAFT,
      });

      await expect(
        service.updateTemplate('tmpl-system', { title: 'Sửa trái phép' }, mockAdminUser)
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.publishTemplate('tmpl-system', {}, mockAdminUser)
      ).rejects.toThrow(ForbiddenException);
    });

    it('SUPER_ADMIN được phép sửa và phát hành biểu mẫu dùng chung toàn hệ thống', async () => {
      mockPrisma.formTemplate.findUnique.mockResolvedValue({
        id: 'tmpl-system',
        organizationId: null,
        code: 'SYS_FORM',
        title: 'Mẫu toàn hệ thống',
        status: TemplateStatus.DRAFT,
        fields: sampleValidFields,
        layoutBlocks: [],
        defaultWorkflowSteps: [],
      });
      mockPrisma.formTemplate.update.mockResolvedValue({
        id: 'tmpl-system',
        title: 'Mẫu toàn hệ thống đã sửa',
        status: TemplateStatus.DRAFT,
        currentVersion: 1,
      });

      const res = await service.updateTemplate(
        'tmpl-system',
        { title: 'Mẫu toàn hệ thống đã sửa' },
        mockSuperAdmin
      );
      expect(res.success).toBe(true);
    });

    it('Tạo bản nháp phiên bản tiếp theo (v2) từ template đã PUBLISHED', async () => {
      mockPrisma.formTemplate.findUnique.mockResolvedValue({
        id: 'tmpl-pub',
        organizationId: 'org-alpha',
        code: 'TPL_PUB',
        title: 'Mẫu công văn',
        status: TemplateStatus.PUBLISHED,
        currentVersion: 1,
        fields: sampleValidFields,
        layoutBlocks: [],
        defaultWorkflowSteps: [],
        versions: [], // chưa có draft dở dang
      });

      mockPrisma.formTemplateVersion.create.mockResolvedValue({
        id: 'ver-draft-2',
        templateId: 'tmpl-pub',
        versionNumber: 2,
        title: 'Mẫu công văn',
        fields: sampleValidFields,
        layoutBlocks: [],
        status: TemplateStatus.DRAFT,
        createdAt: new Date(),
      });

      const res = await service.createDraftVersion('tmpl-pub', mockAdminUser);
      expect(res.success).toBe(true);
      expect(res.data.versionNumber).toBe(2);
      expect(res.data.status).toBe(TemplateStatus.DRAFT);
    });

    it('Xung đột tương tranh khi phát hành phiên bản đồng thời ném ConflictException (409)', async () => {
      mockPrisma.formTemplate.findUnique.mockResolvedValue({
        id: 'tmpl-race',
        organizationId: 'org-alpha',
        code: 'TPL_RACE',
        title: 'Mẫu tranh chấp',
        status: TemplateStatus.PUBLISHED,
        currentVersion: 1,
        fields: sampleValidFields,
        versions: [],
      });

      mockPrisma.formTemplateVersion.findFirst.mockResolvedValue(null);
      // Giả lập lỗi P2002 do PostgreSQL Unique Constraint vi phạm
      const p2002Err: any = new Error('Unique constraint failed');
      p2002Err.code = 'P2002';
      mockPrisma.formTemplateVersion.create.mockRejectedValue(p2002Err);

      await expect(
        service.publishTemplate('tmpl-race', {}, mockAdminUser)
      ).rejects.toThrow(ConflictException);
    });
  });
});
