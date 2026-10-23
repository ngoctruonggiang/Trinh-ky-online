import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  AssigneeDecision,
  AssigneeRole,
  DocumentStatus,
  StepCompletionRule,
  StepStatus,
  StepType,
  UrgencyLevel,
  UserRole,
  WorkflowStatus,
} from '@trinh-ky/shared';
import { DocumentReadService } from './document-read.service.js';
import { UserPrincipal } from '../../common/interfaces/user-principal.interface.js';

describe('DocumentReadService (Secure Read Queries & Multi-Company Boundary)', () => {
  let service: DocumentReadService;
  let mockPrisma: any;

  const userHq: UserPrincipal = {
    id: 'user-hq-1',
    email: 'user1@hq.com',
    fullName: 'Nhân viên HQ',
    role: UserRole.USER,
    organizationId: 'org-hq',
    departmentId: 'dept-it',
  };

  const adminHq: UserPrincipal = {
    id: 'admin-hq-1',
    email: 'admin@hq.com',
    fullName: 'Admin HQ',
    role: UserRole.ADMIN,
    organizationId: 'org-hq',
  };

  const userBranch: UserPrincipal = {
    id: 'user-branch-1',
    email: 'user@branch.com',
    fullName: 'Nhân viên Chi nhánh',
    role: UserRole.USER,
    organizationId: 'org-branch',
  };

  const superAdmin: UserPrincipal = {
    id: 'super-admin-1',
    email: 'superadmin@group.com',
    fullName: 'Super Admin Tập Đoàn',
    role: UserRole.SUPER_ADMIN,
    organizationId: null,
  };

  beforeEach(() => {
    mockPrisma = {
      document: {
        findMany: vi.fn(),
        count: vi.fn(),
        findUnique: vi.fn(),
      },
      stepDecisionHistory: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      stepReassignmentHistory: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    service = new DocumentReadService(mockPrisma);
  });

  describe('1. getDocuments (Phân trang, Lọc & Bảo vệ ranh giới tổ chức)', () => {
    it('1.1. Bắt buộc giới hạn organizationId ở cấp truy vấn database đối với USER và ADMIN', async () => {
      mockPrisma.document.count.mockResolvedValue(1);
      mockPrisma.document.findMany.mockResolvedValue([
        {
          id: 'doc-1',
          documentNumber: 'TK-001',
          title: 'Đề nghị tạm ứng',
          templateId: 'tmpl-1',
          status: DocumentStatus.IN_REVIEW,
          urgency: UrgencyLevel.NORMAL,
          createdById: userHq.id,
          organizationId: 'org-hq',
          createdAt: new Date('2026-10-20T08:00:00Z'),
          updatedAt: new Date('2026-10-20T08:00:00Z'),
          currentStepOrder: 1,
          createdBy: { id: userHq.id, fullName: 'Nhân viên HQ', email: userHq.email },
          template: { code: 'TAM_UNG', title: 'Giấy đề nghị tạm ứng' },
          organization: { id: 'org-hq', name: 'Công ty HQ' },
          workflow: {
            id: 'wf-1',
            status: WorkflowStatus.RUNNING,
            currentStepOrder: 1,
            steps: [{ id: 's-1', stepOrder: 1, stepName: 'Trưởng phòng duyệt', status: StepStatus.IN_PROGRESS }],
          },
        },
      ]);

      const result = await service.getDocuments(userHq, { page: 1, limit: 10, tab: 'all' });

      expect(mockPrisma.document.findMany).toHaveBeenCalledTimes(1);
      const callArgs = mockPrisma.document.findMany.mock.calls[0][0];

      // Ranh giới bắt buộc: organizationId phải gắn chặt với org của user gọi
      expect(callArgs.where.organizationId).toBe('org-hq');
      expect(result.items).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.totalPages).toBe(1);
    });

    it('1.2. SUPER_ADMIN không bị ràng buộc organizationId cụ thể', async () => {
      mockPrisma.document.count.mockResolvedValue(0);
      mockPrisma.document.findMany.mockResolvedValue([]);

      await service.getDocuments(superAdmin, { page: 1, limit: 10, tab: 'all' });

      const callArgs = mockPrisma.document.findMany.mock.calls[0][0];
      expect(callArgs.where.organizationId).toBeUndefined();
    });

    it('1.3. Tab "pending_my_approval" thiết lập đúng điều kiện lọc người duyệt và bước duyệt IN_PROGRESS', async () => {
      mockPrisma.document.count.mockResolvedValue(0);
      mockPrisma.document.findMany.mockResolvedValue([]);

      await service.getDocuments(userHq, { page: 1, limit: 10, tab: 'pending_my_approval' });

      const callArgs = mockPrisma.document.findMany.mock.calls[0][0];
      expect(callArgs.where.status).toBe(DocumentStatus.IN_REVIEW);
      expect(callArgs.where.workflow.status).toBe(WorkflowStatus.RUNNING);
      expect(callArgs.where.workflow.steps.some.status).toBe(StepStatus.IN_PROGRESS);
      expect(callArgs.where.workflow.steps.some.assignees.some).toEqual({
        userId: userHq.id,
        role: AssigneeRole.APPROVER,
        decision: AssigneeDecision.PENDING,
      });
    });

    it('1.4. Tab "my_documents" lọc chính xác createdById của user', async () => {
      mockPrisma.document.count.mockResolvedValue(0);
      mockPrisma.document.findMany.mockResolvedValue([]);

      await service.getDocuments(userHq, { page: 1, limit: 10, tab: 'my_documents' });

      const callArgs = mockPrisma.document.findMany.mock.calls[0][0];
      expect(callArgs.where.createdById).toBe(userHq.id);
    });

    it('1.5. Tìm kiếm theo từ khóa thực hiện tìm kiếm OR trên title và documentNumber không phân biệt hoa thường', async () => {
      mockPrisma.document.count.mockResolvedValue(0);
      mockPrisma.document.findMany.mockResolvedValue([]);

      await service.getDocuments(userHq, { page: 1, limit: 10, tab: 'all', search: 'TK-2026' });

      const callArgs = mockPrisma.document.findMany.mock.calls[0][0];
      expect(callArgs.where.AND).toEqual([
        {
          OR: [
            { title: { contains: 'TK-2026', mode: 'insensitive' } },
            { documentNumber: { contains: 'TK-2026', mode: 'insensitive' } },
          ],
        },
      ]);
    });

    it('1.6. Tính toán phân trang chính xác', async () => {
      mockPrisma.document.count.mockResolvedValue(25);
      mockPrisma.document.findMany.mockResolvedValue([]);

      const result = await service.getDocuments(userHq, { page: 2, limit: 10, tab: 'all' });

      const callArgs = mockPrisma.document.findMany.mock.calls[0][0];
      expect(callArgs.skip).toBe(10);
      expect(callArgs.take).toBe(10);
      expect(result.pagination.page).toBe(2);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.total).toBe(25);
      expect(result.pagination.totalPages).toBe(3);
    });
  });

  describe('2. getDocumentDetail (Chi tiết hồ sơ, Phiên bản, Quyền hạn & Chữ ký số)', () => {
    const rawDocHq = {
      id: 'doc-hq-1',
      documentNumber: 'TK-2026-0001',
      title: 'Giấy đề nghị mua thiết bị',
      templateId: 'tmpl-1',
      status: DocumentStatus.IN_REVIEW,
      urgency: UrgencyLevel.URGENT,
      createdById: userHq.id,
      organizationId: 'org-hq',
      currentStepOrder: 1,
      currentVersion: 1,
      createdAt: new Date('2026-10-20T08:00:00Z'),
      updatedAt: new Date('2026-10-20T08:00:00Z'),
      template: { code: 'MUA_SAM', title: 'Đề nghị mua sắm' },
      createdBy: { id: userHq.id, fullName: 'Nhân viên HQ', email: userHq.email },
      organization: { id: 'org-hq', name: 'Công ty HQ' },
      department: { id: 'dept-it', name: 'Phòng IT' },
      versions: [
        {
          id: 'v1',
          versionNumber: 1,
          formData: { itemName: 'Màn hình Dell', amount: 5000000 },
          sha256Hash: 'hash-v1',
          changeSummary: 'Bản khởi tạo',
          createdAt: new Date('2026-10-20T08:00:00Z'),
        },
      ],
      workflow: {
        id: 'wf-1',
        status: WorkflowStatus.RUNNING,
        currentStepOrder: 1,
        steps: [
          {
            id: 'step-1',
            stepOrder: 1,
            stepName: 'Trưởng phòng thẩm tra',
            stepType: StepType.SEQUENTIAL,
            completionRule: StepCompletionRule.ALL_MUST_APPROVE,
            status: StepStatus.IN_PROGRESS,
            assignees: [
              {
                id: 'asg-1',
                userId: 'approver-1-id',
                role: AssigneeRole.APPROVER,
                decision: AssigneeDecision.PENDING,
                user: { id: 'approver-1-id', fullName: 'Trưởng Phòng A', email: 'tp@hq.com' },
              },
            ],
          },
        ],
      },
      signatureEvents: [],
    };

    it('2.1. Ném lỗi 404 khi không tìm thấy hồ sơ', async () => {
      mockPrisma.document.findUnique.mockResolvedValue(null);

      await expect(service.getDocumentDetail('doc-none', userHq)).rejects.toThrow(NotFoundException);
    });

    it('2.2. Chặn truy cập 403 Forbidden khi người dùng thuộc công ty khác xem tài liệu', async () => {
      mockPrisma.document.findUnique.mockResolvedValue(rawDocHq);

      await expect(service.getDocumentDetail('doc-hq-1', userBranch)).rejects.toThrow(ForbiddenException);
    });

    it('2.3. Cho phép SUPER_ADMIN xem chi tiết tài liệu thuộc bất kỳ công ty nào', async () => {
      mockPrisma.document.findUnique.mockResolvedValue(rawDocHq);

      const result = await service.getDocumentDetail('doc-hq-1', superAdmin);
      expect(result.id).toBe('doc-hq-1');
      expect(result.permissions.isAdmin).toBe(true);
    });

    it('2.4. Tính toán quyền canApprove: true chính xác khi user là APPROVER đang có lượt duyệt PENDING', async () => {
      mockPrisma.document.findUnique.mockResolvedValue(rawDocHq);

      const approverUser: UserPrincipal = {
        id: 'approver-1-id',
        email: 'tp@hq.com',
        fullName: 'Trưởng Phòng A',
        role: UserRole.USER,
        organizationId: 'org-hq',
      };

      const result = await service.getDocumentDetail('doc-hq-1', approverUser);
      expect(result.permissions.canApprove).toBe(true);
      expect(result.permissions.canResubmit).toBe(false);
      expect(result.permissions.isCreator).toBe(false);
    });

    it('2.5. REVIEWER trong bước hiện tại không có quyền canApprove', async () => {
      const docWithReviewer = {
        ...rawDocHq,
        workflow: {
          ...rawDocHq.workflow,
          steps: [
            {
              ...rawDocHq.workflow.steps[0],
              assignees: [
                {
                  id: 'asg-rev',
                  userId: 'reviewer-id',
                  role: AssigneeRole.REVIEWER,
                  decision: AssigneeDecision.PENDING,
                  user: { id: 'reviewer-id', fullName: 'Người xem', email: 'rev@hq.com' },
                },
              ],
            },
          ],
        },
      };

      mockPrisma.document.findUnique.mockResolvedValue(docWithReviewer);

      const reviewerUser: UserPrincipal = {
        id: 'reviewer-id',
        email: 'rev@hq.com',
        fullName: 'Người xem',
        role: UserRole.USER,
        organizationId: 'org-hq',
      };

      const result = await service.getDocumentDetail('doc-hq-1', reviewerUser);
      expect(result.permissions.canApprove).toBe(false);
    });

    it('2.6. Trả về đúng con dấu chữ ký số thực tế có trong database, không sinh dữ liệu giả', async () => {
      const docWithSig = {
        ...rawDocHq,
        signatureEvents: [
          {
            id: 'sig-1',
            userId: 'approver-1-id',
            signatureImageUrl: 'https://cdn.company.com/sig1.png',
            signedAt: new Date('2026-10-20T09:00:00Z'),
            isValid: true,
            contentHash: 'hash-v1',
            user: { id: 'approver-1-id', fullName: 'Trưởng Phòng A', email: 'tp@hq.com' },
          },
        ],
      };

      mockPrisma.document.findUnique.mockResolvedValue(docWithSig);

      const result = await service.getDocumentDetail('doc-hq-1', userHq);
      expect(result.signatures).toHaveLength(1);
      expect(result.signatures[0].signatureImageUrl).toBe('https://cdn.company.com/sig1.png');
      expect(result.signatures[0].isValid).toBe(true);
      expect(result.signatures[0].contentHash).toBe('hash-v1');
    });
  });
});
