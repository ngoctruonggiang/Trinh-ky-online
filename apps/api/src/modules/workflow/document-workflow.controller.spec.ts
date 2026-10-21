import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  HttpStatus,
  ExecutionContext,
} from '@nestjs/common';
import {
  AssigneeDecision,
  DocumentStatus,
  UserRole,
  WorkflowStatus,
} from '@trinh-ky/shared';
import { DocumentWorkflowController } from './document-workflow.controller.js';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { JwtUtil } from '../../common/utils/jwt.util.js';
import { WorkflowExceptionFilter } from '../../common/filters/workflow-exception.filter.js';
import { UserPrincipal } from '../../common/interfaces/user-principal.interface.js';

describe('DocumentWorkflowController & Security Review (API Layer)', () => {
  let controller: DocumentWorkflowController;
  let mockOrchestrator: any;
  let mockPrisma: any;

  // Người dùng thuộc Công ty HQ
  const mockUserHq: UserPrincipal = {
    id: 'user-hq-id',
    email: 'user-hq@company.com',
    fullName: 'Nguyễn Văn Tác Giả (HQ)',
    role: UserRole.USER,
    organizationId: 'org-hq',
    departmentId: 'dept-it',
  };

  const mockAdminHq: UserPrincipal = {
    id: 'admin-hq-id',
    email: 'admin-hq@company.com',
    fullName: 'Quản Trị Viên (HQ)',
    role: UserRole.ADMIN,
    organizationId: 'org-hq',
  };

  // Người dùng thuộc Công ty Chi nhánh (Branch)
  const mockUserBranch: UserPrincipal = {
    id: 'user-branch-id',
    email: 'user-branch@company.com',
    fullName: 'Nhân Viên Chi Nhánh',
    role: UserRole.USER,
    organizationId: 'org-branch',
    departmentId: 'dept-sales',
  };

  const mockAdminBranch: UserPrincipal = {
    id: 'admin-branch-id',
    email: 'admin-branch@company.com',
    fullName: 'Quản Trị Viên Chi Nhánh',
    role: UserRole.ADMIN,
    organizationId: 'org-branch',
  };

  // Super Admin tập đoàn (Global)
  const mockSuperAdmin: UserPrincipal = {
    id: 'super-admin-id',
    email: 'superadmin@group.com',
    fullName: 'Tổng Giám Đốc Tập Đoàn',
    role: UserRole.SUPER_ADMIN,
    organizationId: null,
  };

  const mockReq = {
    ip: '127.0.0.1',
    headers: {
      'user-agent': 'Mozilla/5.0 TestBrowser',
    },
  };

  beforeEach(() => {
    mockOrchestrator = {
      submitDocument: vi.fn(),
      processAssigneeDecision: vi.fn(),
      resubmitDocument: vi.fn(),
      cancelDocument: vi.fn(),
    };

    mockPrisma = {
      document: {
        findUnique: vi.fn(),
      },
    };

    controller = new DocumentWorkflowController(mockOrchestrator, mockPrisma);
  });

  describe('1. submitDocument (POST /api/documents/:id/submit)', () => {
    it('1.1. Submit thành công khi người gọi là tác giả tài liệu trong cùng tổ chức', async () => {
      mockPrisma.document.findUnique.mockResolvedValue({
        id: 'doc-1',
        createdById: mockUserHq.id,
        organizationId: 'org-hq',
        status: DocumentStatus.DRAFT,
      });

      mockOrchestrator.submitDocument.mockResolvedValue({
        success: true,
        documentStatus: DocumentStatus.IN_REVIEW,
        workflowStatus: WorkflowStatus.RUNNING,
        shouldNotifyUserIds: ['approver-1'],
      });

      const res = await controller.submitDocument('doc-1', mockUserHq, mockReq as any);

      expect(res.success).toBe(true);
      expect(res.data.documentStatus).toBe(DocumentStatus.IN_REVIEW);
      expect(mockOrchestrator.submitDocument).toHaveBeenCalledWith({
        documentId: 'doc-1',
        userId: mockUserHq.id,
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0 TestBrowser',
      });
    });

    it('1.2. Chặn submit khi người dùng thuộc công ty khác (Cross-Organization Forbidden)', async () => {
      mockPrisma.document.findUnique.mockResolvedValue({
        id: 'doc-1',
        createdById: mockUserHq.id,
        organizationId: 'org-hq',
        status: DocumentStatus.DRAFT,
      });

      // Admin công ty chi nhánh cố submit tài liệu của công ty HQ
      await expect(
        controller.submitDocument('doc-1', mockAdminBranch, mockReq as any)
      ).rejects.toThrow('Bạn không có quyền thao tác trên hồ sơ thuộc công ty/tổ chức khác.');
    });

    it('1.3. Chặn submit khi người dùng cùng công ty nhưng không phải tác giả và không phải Admin', async () => {
      mockPrisma.document.findUnique.mockResolvedValue({
        id: 'doc-1',
        createdById: mockUserHq.id,
        organizationId: 'org-hq',
        status: DocumentStatus.DRAFT,
      });

      const anotherUserHq = { ...mockUserHq, id: 'user-colleague-id' };

      await expect(
        controller.submitDocument('doc-1', anotherUserHq, mockReq as any)
      ).rejects.toThrow(ForbiddenException);
    });

    it('1.4. Trả về NotFoundException nếu tài liệu không tồn tại', async () => {
      mockPrisma.document.findUnique.mockResolvedValue(null);

      await expect(
        controller.submitDocument('non-existing-doc', mockUserHq, mockReq as any)
      ).rejects.toThrow(NotFoundException);
    });

    it('1.5. Chặn submit khi tài liệu sai trạng thái (gọi từ Orchestrator ném lỗi FSM)', async () => {
      mockPrisma.document.findUnique.mockResolvedValue({
        id: 'doc-1',
        createdById: mockUserHq.id,
        organizationId: 'org-hq',
        status: DocumentStatus.APPROVED,
      });

      mockOrchestrator.submitDocument.mockRejectedValue(
        new Error('Chỉ có thể gửi duyệt tài liệu ở trạng thái bản nháp (DRAFT).')
      );

      await expect(
        controller.submitDocument('doc-1', mockUserHq, mockReq as any)
      ).rejects.toThrow('Chỉ có thể gửi duyệt tài liệu ở trạng thái bản nháp');
    });
  });

  describe('2. processDecision (POST /api/documents/:id/decision)', () => {
    it('2.1. Quyết định hợp lệ: Danh tính actor lấy từ authenticated principal, không từ payload', async () => {
      mockPrisma.document.findUnique.mockResolvedValue({
        id: 'doc-1',
        createdById: mockUserHq.id,
        organizationId: 'org-hq',
        status: DocumentStatus.IN_REVIEW,
      });

      mockOrchestrator.processAssigneeDecision.mockResolvedValue({
        success: true,
        documentStatus: DocumentStatus.IN_REVIEW,
        workflowStatus: WorkflowStatus.RUNNING,
      });

      const dto = {
        decision: AssigneeDecision.APPROVED,
        decisionComment: 'Đồng ý duyệt bước 1',
        signatureImageUrl: '/signatures/user.png',
      };

      const res = await controller.processDecision('doc-1', dto, mockUserHq, mockReq as any);

      expect(res.success).toBe(true);
      // Kiểm tra: userId truyền vào Orchestrator PHẢI LÀ mockUserHq.id từ Principal
      expect(mockOrchestrator.processAssigneeDecision).toHaveBeenCalledWith({
        documentId: 'doc-1',
        userId: mockUserHq.id,
        decision: AssigneeDecision.APPROVED,
        decisionComment: 'Đồng ý duyệt bước 1',
        signatureImageUrl: '/signatures/user.png',
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0 TestBrowser',
      });
    });

    it('2.2. Chặn quyết định khi người duyệt thuộc công ty khác (Cross-Organization Decision)', async () => {
      mockPrisma.document.findUnique.mockResolvedValue({
        id: 'doc-1',
        createdById: mockUserHq.id,
        organizationId: 'org-hq',
        status: DocumentStatus.IN_REVIEW,
      });

      await expect(
        controller.processDecision(
          'doc-1',
          { decision: AssigneeDecision.APPROVED },
          mockUserBranch,
          mockReq as any
        )
      ).rejects.toThrow('Bạn không có quyền thao tác trên hồ sơ thuộc công ty/tổ chức khác.');
    });

    it('2.3. Chặn quyết định trùng hoặc xung đột tương tranh (Orchestrator ném lỗi OCC)', async () => {
      mockPrisma.document.findUnique.mockResolvedValue({
        id: 'doc-1',
        createdById: mockUserHq.id,
        organizationId: 'org-hq',
        status: DocumentStatus.IN_REVIEW,
      });

      mockOrchestrator.processAssigneeDecision.mockRejectedValue(
        new Error('Xung đột tương tranh: Quyết định của người duyệt đã được xử lý bởi một yêu cầu đồng thời hoặc trước đó.')
      );

      await expect(
        controller.processDecision(
          'doc-1',
          { decision: AssigneeDecision.APPROVED },
          mockUserHq,
          mockReq as any
        )
      ).rejects.toThrow('Xung đột tương tranh');
    });

    it('2.4. REVIEWER không được phép phê duyệt (Orchestrator ném lỗi thẩm quyền)', async () => {
      mockPrisma.document.findUnique.mockResolvedValue({
        id: 'doc-1',
        createdById: mockUserHq.id,
        organizationId: 'org-hq',
        status: DocumentStatus.IN_REVIEW,
      });

      mockOrchestrator.processAssigneeDecision.mockRejectedValue(
        new Error('Người giám sát (REVIEWER) chỉ có quyền xem và bình luận, không có thẩm quyền ra quyết định.')
      );

      await expect(
        controller.processDecision(
          'doc-1',
          { decision: AssigneeDecision.APPROVED },
          mockUserHq,
          mockReq as any
        )
      ).rejects.toThrow('REVIEWER');
    });
  });

  describe('3. resubmitDocument (POST /api/documents/:id/resubmit)', () => {
    it('3.1. Resubmit thành công khi gọi bởi tác giả', async () => {
      mockPrisma.document.findUnique.mockResolvedValue({
        id: 'doc-1',
        createdById: mockUserHq.id,
        organizationId: 'org-hq',
        status: DocumentStatus.REVISION_REQUESTED,
      });

      mockOrchestrator.resubmitDocument.mockResolvedValue({
        success: true,
        newVersionNumber: 2,
        documentStatus: DocumentStatus.IN_REVIEW,
        workflowStatus: WorkflowStatus.RUNNING,
      });

      const res = await controller.resubmitDocument(
        'doc-1',
        { formData: { title: 'Bản sửa đổi' }, changeSummary: 'Sửa chi phí' },
        mockUserHq,
        mockReq as any
      );

      expect(res.success).toBe(true);
      expect(res.data.newVersionNumber).toBe(2);
      expect(mockOrchestrator.resubmitDocument).toHaveBeenCalledWith({
        documentId: 'doc-1',
        userId: mockUserHq.id,
        newFormData: { title: 'Bản sửa đổi' },
        changeSummary: 'Sửa chi phí',
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0 TestBrowser',
      });
    });

    it('3.2. Chặn admin công ty khác resubmit hồ sơ của công ty này (Cross-Org Blocked)', async () => {
      mockPrisma.document.findUnique.mockResolvedValue({
        id: 'doc-1',
        createdById: mockUserHq.id,
        organizationId: 'org-hq',
        status: DocumentStatus.REVISION_REQUESTED,
      });

      await expect(
        controller.resubmitDocument(
          'doc-1',
          { formData: { title: 'Hack' } },
          mockAdminBranch,
          mockReq as any
        )
      ).rejects.toThrow('Bạn không có quyền thao tác trên hồ sơ thuộc công ty/tổ chức khác.');
    });

    it('3.3. Chặn resubmit khi hồ sơ sai trạng thái (ví dụ đang IN_REVIEW)', async () => {
      mockPrisma.document.findUnique.mockResolvedValue({
        id: 'doc-1',
        createdById: mockUserHq.id,
        organizationId: 'org-hq',
        status: DocumentStatus.IN_REVIEW,
      });

      mockOrchestrator.resubmitDocument.mockRejectedValue(
        new Error('Chỉ có thể nộp lại hồ sơ đang ở trạng thái Yêu cầu chỉnh sửa (REVISION_REQUESTED).')
      );

      await expect(
        controller.resubmitDocument(
          'doc-1',
          { formData: { title: 'Data' } },
          mockUserHq,
          mockReq as any
        )
      ).rejects.toThrow('Chỉ có thể nộp lại hồ sơ đang ở trạng thái Yêu cầu chỉnh sửa');
    });
  });

  describe('4. cancelDocument (POST /api/documents/:id/cancel)', () => {
    it('4.1. Hủy thành công bởi tác giả khi hồ sơ đang IN_REVIEW', async () => {
      mockPrisma.document.findUnique.mockResolvedValue({
        id: 'doc-1',
        createdById: mockUserHq.id,
        organizationId: 'org-hq',
        status: DocumentStatus.IN_REVIEW,
      });

      mockOrchestrator.cancelDocument.mockResolvedValue({
        success: true,
        documentStatus: DocumentStatus.CANCELLED,
        workflowStatus: WorkflowStatus.CANCELLED,
      });

      const res = await controller.cancelDocument(
        'doc-1',
        { cancelReason: 'Không còn nhu cầu' },
        mockUserHq,
        mockReq as any
      );

      expect(res.success).toBe(true);
      expect(res.data.documentStatus).toBe(DocumentStatus.CANCELLED);
    });

    it('4.2. Admin công ty có quyền hủy hồ sơ của nhân viên thuộc công ty mình', async () => {
      mockPrisma.document.findUnique.mockResolvedValue({
        id: 'doc-1',
        createdById: mockUserHq.id,
        organizationId: 'org-hq',
        status: DocumentStatus.IN_REVIEW,
      });

      mockOrchestrator.cancelDocument.mockResolvedValue({
        success: true,
        documentStatus: DocumentStatus.CANCELLED,
      });

      const res = await controller.cancelDocument(
        'doc-1',
        { cancelReason: 'Admin hủy theo lệnh ban giám đốc' },
        mockAdminHq,
        mockReq as any
      );

      expect(res.success).toBe(true);
    });

    it('4.3. Admin công ty B BỊ CHẶN khi cố hủy hồ sơ công ty A', async () => {
      mockPrisma.document.findUnique.mockResolvedValue({
        id: 'doc-1',
        createdById: mockUserHq.id,
        organizationId: 'org-hq',
        status: DocumentStatus.IN_REVIEW,
      });

      await expect(
        controller.cancelDocument(
          'doc-1',
          { cancelReason: 'Cố tình can thiệp' },
          mockAdminBranch,
          mockReq as any
        )
      ).rejects.toThrow('Bạn không có quyền thao tác trên hồ sơ thuộc công ty/tổ chức khác.');
    });

    it('4.4. Super Admin tập đoàn có quyền hủy hồ sơ ở bất kỳ công ty nào', async () => {
      mockPrisma.document.findUnique.mockResolvedValue({
        id: 'doc-1',
        createdById: mockUserHq.id,
        organizationId: 'org-hq',
        status: DocumentStatus.IN_REVIEW,
      });

      mockOrchestrator.cancelDocument.mockResolvedValue({
        success: true,
        documentStatus: DocumentStatus.CANCELLED,
      });

      const res = await controller.cancelDocument(
        'doc-1',
        { cancelReason: 'Hủy toàn tập đoàn' },
        mockSuperAdmin,
        mockReq as any
      );

      expect(res.success).toBe(true);
    });

    it('4.5. Chặn hủy hồ sơ đã APPROVED hoặc REJECTED (FSM Error)', async () => {
      mockPrisma.document.findUnique.mockResolvedValue({
        id: 'doc-1',
        createdById: mockUserHq.id,
        organizationId: 'org-hq',
        status: DocumentStatus.APPROVED,
      });

      mockOrchestrator.cancelDocument.mockRejectedValue(
        new Error('Không thể hủy hồ sơ đã được phê duyệt hoàn tất (APPROVED).')
      );

      await expect(
        controller.cancelDocument('doc-1', {}, mockUserHq, mockReq as any)
      ).rejects.toThrow('Không thể hủy hồ sơ đã được phê duyệt hoàn tất');
    });
  });

  describe('5. AuthGuard & Cryptographic Token Verification (Security Hardening)', () => {
    const authGuard = new AuthGuard();
    const testSecret = 'test-secret-key-1234567890';

    beforeEach(() => {
      process.env.JWT_SECRET = testSecret;
      process.env.GATEWAY_SHARED_SECRET = 'trusted-internal-gateway-secret';
      delete process.env.ALLOW_DEV_MOCK_AUTH;
    });

    it('5.1. Chặn request không có bất kỳ thông tin xác thực nào (UnauthorizedException)', () => {
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({ headers: {} }),
        }),
      } as ExecutionContext;

      expect(() => authGuard.canActivate(mockContext)).toThrow(UnauthorizedException);
    });

    it('5.2. Chặn giả mạo vai trò bằng raw headers (Chống Privilege Escalation)', () => {
      // Kẻ tấn công tự gửi x-user-role: SUPER_ADMIN trực tiếp
      const req: any = {
        headers: {
          'x-user-id': 'attacker-id',
          'x-user-role': UserRole.SUPER_ADMIN,
        },
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => req,
        }),
      } as ExecutionContext;

      // Mặc định AuthGuard phải từ chối ngay lập tức
      expect(() => authGuard.canActivate(mockContext)).toThrow(UnauthorizedException);
      expect(req.user).toBeUndefined();
    });

    it('5.3. Xác thực thành công với Bearer JWT Token hợp lệ', () => {
      const token = JwtUtil.sign(
        {
          sub: 'user-real-001',
          email: 'real@company.com',
          fullName: 'Người Dùng Thật',
          role: UserRole.ADMIN,
          organizationId: 'org-hq',
        },
        testSecret,
        3600
      );

      const req: any = {
        headers: {
          authorization: `Bearer ${token}`,
        },
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => req,
        }),
      } as ExecutionContext;

      const result = authGuard.canActivate(mockContext);
      expect(result).toBe(true);
      expect(req.user).toBeDefined();
      expect(req.user.id).toBe('user-real-001');
      expect(req.user.role).toBe(UserRole.ADMIN);
      expect(req.user.organizationId).toBe('org-hq');
    });

    it('5.4. Chặn Bearer JWT Token có chữ ký giả mạo hoặc can thiệp payload', () => {
      const token = JwtUtil.sign(
        {
          sub: 'user-attacker',
          email: 'attacker@company.com',
          fullName: 'Kẻ Giả Mạo',
          role: UserRole.USER,
        },
        'wrong-secret-key-attacker',
        3600
      );

      const req: any = {
        headers: {
          authorization: `Bearer ${token}`,
        },
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => req,
        }),
      } as ExecutionContext;

      expect(() => authGuard.canActivate(mockContext)).toThrow(UnauthorizedException);
    });

    it('5.5. Chặn Bearer JWT Token đã hết hạn', () => {
      // Tạo token với expiresInSeconds âm (đã hết hạn)
      const expiredToken = JwtUtil.sign(
        {
          sub: 'user-expired',
          email: 'expired@company.com',
          fullName: 'User Hết Hạn',
          role: UserRole.USER,
        },
        testSecret,
        -100
      );

      const req: any = {
        headers: {
          authorization: `Bearer ${expiredToken}`,
        },
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => req,
        }),
      } as ExecutionContext;

      expect(() => authGuard.canActivate(mockContext)).toThrow(UnauthorizedException);
    });

    it('5.6. Xác thực thành công qua Trusted Gateway khi có x-gateway-secret hợp lệ', () => {
      const req: any = {
        headers: {
          'x-gateway-secret': 'trusted-internal-gateway-secret',
          'x-user-id': 'gateway-user-123',
          'x-user-email': 'gw@company.com',
          'x-user-name': 'Gateway Verified User',
          'x-user-role': UserRole.USER,
          'x-org-id': 'org-hq',
        },
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => req,
        }),
      } as ExecutionContext;

      const result = authGuard.canActivate(mockContext);
      expect(result).toBe(true);
      expect(req.user).toBeDefined();
      expect(req.user.id).toBe('gateway-user-123');
      expect(req.user.organizationId).toBe('org-hq');
    });

    it('5.7. Chặn Trusted Gateway khi x-gateway-secret không khớp', () => {
      const req: any = {
        headers: {
          'x-gateway-secret': 'invalid-secret',
          'x-user-id': 'hacker',
          'x-user-role': UserRole.SUPER_ADMIN,
        },
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => req,
        }),
      } as ExecutionContext;

      expect(() => authGuard.canActivate(mockContext)).toThrow(UnauthorizedException);
    });

    it('5.8. Cho phép Dev Mock Header chỉ khi ALLOW_DEV_MOCK_AUTH=true trong môi trường non-production', () => {
      process.env.ALLOW_DEV_MOCK_AUTH = 'true';
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const req: any = {
        headers: {
          'x-user-id': 'dev-user-001',
          'x-user-email': 'dev@company.com',
          'x-user-name': 'Dev User',
          'x-user-role': UserRole.USER,
        },
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => req,
        }),
      } as ExecutionContext;

      const result = authGuard.canActivate(mockContext);
      expect(result).toBe(true);
      expect(req.user.id).toBe('dev-user-001');

      // Khôi phục NODE_ENV
      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('6. WorkflowExceptionFilter (Contract & Security Sanitization)', () => {
    const filter = new WorkflowExceptionFilter();

    const createMockHost = (statusCapture: { status?: number; json?: any }) => {
      return {
        switchToHttp: () => ({
          getResponse: () => ({
            status: (code: number) => {
              statusCapture.status = code;
              return {
                json: (body: any) => {
                  statusCapture.json = body;
                },
              };
            },
          }),
        }),
      } as any;
    };

    it('6.1. Xung đột tương tranh chuyển đổi thành HTTP 409 CONCURRENCY_CONFLICT', () => {
      const capture: any = {};
      const host = createMockHost(capture);

      filter.catch(
        new Error('Xung đột tương tranh: Quyết định của người duyệt đã được xử lý bởi một yêu cầu đồng thời.'),
        host
      );

      expect(capture.status).toBe(HttpStatus.CONFLICT);
      expect(capture.json.success).toBe(false);
      expect(capture.json.error.code).toBe('CONCURRENCY_CONFLICT');
    });

    it('6.2. Lỗi sai trạng thái chuyển đổi thành HTTP 422 INVALID_STATE_TRANSITION', () => {
      const capture: any = {};
      const host = createMockHost(capture);

      filter.catch(
        new Error('Không thể hủy hồ sơ đã được phê duyệt hoàn tất (APPROVED).'),
        host
      );

      expect(capture.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(capture.json.error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('6.3. Lỗi không tìm thấy tài liệu chuyển đổi thành HTTP 404 DOCUMENT_NOT_FOUND', () => {
      const capture: any = {};
      const host = createMockHost(capture);

      filter.catch(new Error('Không tìm thấy hồ sơ với id: doc-999'), host);

      expect(capture.status).toBe(HttpStatus.NOT_FOUND);
      expect(capture.json.error.code).toBe('DOCUMENT_NOT_FOUND');
    });

    it('6.4. Lỗi hệ thống không để lộ stack trace hay thông tin nhạy cảm', () => {
      const capture: any = {};
      const host = createMockHost(capture);

      filter.catch(new Error('FATAL: PostgreSQL connection refused at localhost:5432'), host);

      expect(capture.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(capture.json.error.code).toBe('INTERNAL_ERROR');
      // Thông báo lỗi nhạy cảm bị che giấu
      expect(capture.json.error.message).toBe('Lỗi hệ thống khi xử lý quy trình duyệt.');
      expect(capture.json.error.stack).toBeUndefined();
    });
  });
});
