import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  AssigneeDecision,
  AssigneeRole,
  DocumentStatus,
  StepCompletionRule,
  StepStatus,
  StepType,
  TemplateStatus,
  UrgencyLevel,
  UserRole,
  WorkflowStatus,
} from '@trinh-ky/shared';
import { DocumentReadService } from '../src/modules/workflow/document-read.service.js';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import { UserPrincipal } from '../src/common/interfaces/user-principal.interface.js';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('Read API & Multi-Company Security Real PostgreSQL Integration Tests', () => {
  let prisma: PrismaClient;
  let readService: DocumentReadService;
  let authController: AuthController;
  let isPostgresAvailable = false;

  const testDbUrl =
    process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://postgres:devpassword123@localhost:5432/trinh_ky_online_dev?schema=public';

  // Biến lưu trữ IDs kiểm thử
  let orgAlpha: any;
  let orgBeta: any;
  let deptItAlpha: any;
  let userA: any;
  let approverA: any;
  let adminA: any;
  let userB: any;
  let superAdminUser: any;
  let template: any;
  let doc1Alpha: any;
  let doc2Alpha: any;
  let docBeta: any;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: testDbUrl } },
    });

    try {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      isPostgresAvailable = true;
      readService = new DocumentReadService(prisma as any);
      authController = new AuthController(prisma as any);
      console.log('✅ Đã kết nối PostgreSQL vật lý cho bộ Read API Integration Test.');

      // Seed 2 Organizations
      orgAlpha = await prisma.organization.upsert({
        where: { code: 'ORG-ALPHA' },
        update: {},
        create: { code: 'ORG-ALPHA', name: 'Tập đoàn VinaGroup (HQ)' },
      });

      orgBeta = await prisma.organization.upsert({
        where: { code: 'ORG-BETA' },
        update: {},
        create: { code: 'ORG-BETA', name: 'Chi nhánh Miền Nam' },
      });

      deptItAlpha = await prisma.department.upsert({
        where: { organizationId_code: { organizationId: orgAlpha.id, code: 'IT' } },
        update: {},
        create: {
          organizationId: orgAlpha.id,
          code: 'IT',
          name: 'Phòng Công nghệ Thông tin',
        },
      });

      // Seed Users
      userA = await prisma.user.upsert({
        where: { email: 'author-alpha@vinagroup.vn' },
        update: {},
        create: {
          email: 'author-alpha@vinagroup.vn',
          fullName: 'Nguyễn Văn Tác Giả (HQ)',
          passwordHash: '$2b$10$secretHashDoNotLeakInResponses123',
          role: UserRole.USER,
          organizationId: orgAlpha.id,
          departmentId: deptItAlpha.id,
        },
      });

      approverA = await prisma.user.upsert({
        where: { email: 'approver-alpha@vinagroup.vn' },
        update: {},
        create: {
          email: 'approver-alpha@vinagroup.vn',
          fullName: 'Trần Thị Trưởng Phòng (HQ)',
          passwordHash: '$2b$10$secretHashDoNotLeakInResponses456',
          role: UserRole.USER,
          organizationId: orgAlpha.id,
          departmentId: deptItAlpha.id,
        },
      });

      adminA = await prisma.user.upsert({
        where: { email: 'admin-alpha@vinagroup.vn' },
        update: {},
        create: {
          email: 'admin-alpha@vinagroup.vn',
          fullName: 'Quản Trị Viên (HQ)',
          passwordHash: '$2b$10$secretHashDoNotLeakInResponses789',
          role: UserRole.ADMIN,
          organizationId: orgAlpha.id,
        },
      });

      userB = await prisma.user.upsert({
        where: { email: 'user-beta@vinagroup.vn' },
        update: {},
        create: {
          email: 'user-beta@vinagroup.vn',
          fullName: 'Lê Văn Chi Nhánh (Beta)',
          passwordHash: '$2b$10$secretHashDoNotLeakInResponses000',
          role: UserRole.USER,
          organizationId: orgBeta.id,
        },
      });

      superAdminUser = await prisma.user.upsert({
        where: { email: 'superadmin-global@vinagroup.vn' },
        update: {},
        create: {
          email: 'superadmin-global@vinagroup.vn',
          fullName: 'Tổng Giám Đốc Toàn Tập Đoàn',
          passwordHash: '$2b$10$secretHashDoNotLeakInResponses999',
          role: UserRole.SUPER_ADMIN,
          organizationId: null,
        },
      });

      // Seed FormTemplate
      template = await prisma.formTemplate.upsert({
        where: { code: 'TMPL-REAL-READ-TEST' },
        update: {},
        create: {
          code: 'TMPL-REAL-READ-TEST',
          title: 'Giấy đề nghị cấp thiết bị làm việc',
          fields: [{ id: 'device', label: 'Tên thiết bị', type: 'text', required: true }],
          layoutBlocks: [{ type: 'header', title: 'ĐỀ NGHỊ CẤP THIẾT BỊ' }],
          status: TemplateStatus.PUBLISHED,
          createdById: userA.id,
        },
      });

      // Seed Documents:
      // Doc 1 của Công ty Alpha (IN_REVIEW, Bước 1 có approverA là APPROVER với decision PENDING)
      doc1Alpha = await prisma.document.create({
        data: {
          documentNumber: `TK-ALPHA-01-${Date.now()}`,
          title: 'Đề nghị cấp Laptop Dell XPS cho lập trình viên',
          templateId: template.id,
          createdById: userA.id,
          organizationId: orgAlpha.id,
          departmentId: deptItAlpha.id,
          status: DocumentStatus.IN_REVIEW,
          urgency: UrgencyLevel.URGENT,
          currentVersion: 1,
          versions: {
            create: {
              versionNumber: 1,
              formData: { device: 'Dell XPS 15 9530', price: 45000000 },
              sha256Hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
              changeSummary: 'Bản nộp đầu tiên',
              createdById: userA.id,
            },
          },
          workflow: {
            create: {
              status: WorkflowStatus.RUNNING,
              currentStepOrder: 1,
              steps: {
                create: [
                  {
                    stepOrder: 1,
                    stepName: 'Trưởng phòng CNTT xét duyệt',
                    stepType: StepType.SEQUENTIAL,
                    completionRule: StepCompletionRule.ALL_MUST_APPROVE,
                    status: StepStatus.IN_PROGRESS,
                    assignees: {
                      create: {
                        userId: approverA.id,
                        role: AssigneeRole.APPROVER,
                        decision: AssigneeDecision.PENDING,
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      });

      // Doc 2 của Công ty Alpha (REVISION_REQUESTED do userA tạo)
      doc2Alpha = await prisma.document.create({
        data: {
          documentNumber: `TK-ALPHA-02-${Date.now()}`,
          title: 'Đề nghị mua màn hình phụ (cần điều chỉnh cấu hình)',
          templateId: template.id,
          createdById: userA.id,
          organizationId: orgAlpha.id,
          departmentId: deptItAlpha.id,
          status: DocumentStatus.REVISION_REQUESTED,
          urgency: UrgencyLevel.NORMAL,
          currentVersion: 1,
          versions: {
            create: {
              versionNumber: 1,
              formData: { device: 'Màn hình LG 27 inch', price: 7000000 },
              sha256Hash: 'hash-screen-v1',
              changeSummary: 'Khởi tạo',
              createdById: userA.id,
            },
          },
          workflow: {
            create: {
              status: WorkflowStatus.RUNNING,
              currentStepOrder: 1,
              steps: {
                create: [
                  {
                    stepOrder: 1,
                    stepName: 'Thẩm tra ban đầu',
                    stepType: StepType.SEQUENTIAL,
                    completionRule: StepCompletionRule.ALL_MUST_APPROVE,
                    status: StepStatus.REVISION_REQUESTED,
                    assignees: {
                      create: {
                        userId: approverA.id,
                        role: AssigneeRole.APPROVER,
                        decision: AssigneeDecision.REVISION_REQUESTED,
                        decisionComment: 'Yêu cầu đổi sang model tiết kiệm điện',
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      });

      // Doc Beta của Công ty Beta
      docBeta = await prisma.document.create({
        data: {
          documentNumber: `TK-BETA-01-${Date.now()}`,
          title: 'Đề xuất chi phí tiếp khách Chi nhánh Miền Nam',
          templateId: template.id,
          createdById: userB.id,
          organizationId: orgBeta.id,
          status: DocumentStatus.IN_REVIEW,
          urgency: UrgencyLevel.NORMAL,
          currentVersion: 1,
          versions: {
            create: {
              versionNumber: 1,
              formData: { device: 'Chi phí đối tác', cost: 12000000 },
              sha256Hash: 'hash-beta-v1',
              createdById: userB.id,
            },
          },
          workflow: {
            create: {
              status: WorkflowStatus.RUNNING,
              currentStepOrder: 1,
              steps: {
                create: [
                  {
                    stepOrder: 1,
                    stepName: 'Giám đốc chi nhánh duyệt',
                    stepType: StepType.SEQUENTIAL,
                    completionRule: StepCompletionRule.ALL_MUST_APPROVE,
                    status: StepStatus.IN_PROGRESS,
                    assignees: {
                      create: {
                        userId: userB.id,
                        role: AssigneeRole.APPROVER,
                        decision: AssigneeDecision.PENDING,
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      });
    } catch (err: any) {
      isPostgresAvailable = false;
      console.warn('Lỗi kết nối PostgreSQL Test:', err.message);
    }
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  const testIfDb = (name: string, fn: () => Promise<void>) => {
    it(name, async () => {
      if (!isPostgresAvailable) {
        throw new Error('PostgreSQL không khả dụng. Test này bắt buộc chạy trên PostgreSQL thật.');
      }
      await fn();
    });
  };

  describe('1. GET /api/documents trên PostgreSQL thật (Phân trang, Lọc & Ranh giới đa công ty)', () => {
    testIfDb('1.1. Chặn rò rỉ đa công ty: Người dùng Công ty A chỉ thấy hồ sơ Công ty A ở cấp Database Query', async () => {
      const principalUserA: UserPrincipal = {
        id: userA.id,
        email: userA.email,
        fullName: userA.fullName,
        role: UserRole.USER,
        organizationId: orgAlpha.id,
      };

      const result = await readService.getDocuments(principalUserA, { tab: 'all' as const, page: 1, limit: 50 });

      expect(result.items.length).toBeGreaterThanOrEqual(2);
      // Toàn bộ tài liệu trả về BẮT BUỘC phải thuộc orgAlpha
      for (const item of result.items) {
        expect(item.organizationId).toBe(orgAlpha.id);
        expect(item.id).not.toBe(docBeta.id);
      }
    });

    testIfDb('1.2. Người dùng Công ty B chỉ thấy hồ sơ Công ty B', async () => {
      const principalUserB: UserPrincipal = {
        id: userB.id,
        email: userB.email,
        fullName: userB.fullName,
        role: UserRole.USER,
        organizationId: orgBeta.id,
      };

      const result = await readService.getDocuments(principalUserB, { tab: 'all' as const, page: 1, limit: 50 });

      expect(result.items.length).toBeGreaterThanOrEqual(1);
      for (const item of result.items) {
        expect(item.organizationId).toBe(orgBeta.id);
        expect(item.id).not.toBe(doc1Alpha.id);
        expect(item.id).not.toBe(doc2Alpha.id);
      }
    });

    testIfDb('1.3. SUPER_ADMIN có quyền truy vấn xuyên suốt các công ty', async () => {
      const principalSuper: UserPrincipal = {
        id: superAdminUser.id,
        email: superAdminUser.email,
        fullName: superAdminUser.fullName,
        role: UserRole.SUPER_ADMIN,
        organizationId: null,
      };

      const result = await readService.getDocuments(principalSuper, { tab: 'all' as const, page: 1, limit: 50 });

      const foundAlpha = result.items.some((d) => d.id === doc1Alpha.id);
      const foundBeta = result.items.some((d) => d.id === docBeta.id);

      expect(foundAlpha).toBe(true);
      expect(foundBeta).toBe(true);
    });

    testIfDb('1.4. Tab "pending_my_approval" lọc chính xác người duyệt có quyết định PENDING', async () => {
      const principalApproverA: UserPrincipal = {
        id: approverA.id,
        email: approverA.email,
        fullName: approverA.fullName,
        role: UserRole.USER,
        organizationId: orgAlpha.id,
      };

      const result = await readService.getDocuments(principalApproverA, {
        tab: 'pending_my_approval' as const,
        page: 1,
        limit: 10,
      });

      const ids = result.items.map((d) => d.id);
      expect(ids).toContain(doc1Alpha.id);
      expect(ids).not.toContain(doc2Alpha.id); // doc2Alpha là REVISION_REQUESTED, không phải IN_PROGRESS PENDING
    });

    testIfDb('1.5. Tab "my_documents" lọc chính xác tài liệu do chính user tạo', async () => {
      const principalUserA: UserPrincipal = {
        id: userA.id,
        email: userA.email,
        fullName: userA.fullName,
        role: UserRole.USER,
        organizationId: orgAlpha.id,
      };

      const result = await readService.getDocuments(principalUserA, {
        tab: 'my_documents' as const,
        page: 1,
        limit: 10,
      });

      const ids = result.items.map((d) => d.id);
      expect(ids).toContain(doc1Alpha.id);
      expect(ids).toContain(doc2Alpha.id);
      expect(ids).not.toContain(docBeta.id);
    });

    testIfDb('1.6. Phân trang trên database thực tế tính toán totalPages chuẩn xác', async () => {
      const principalUserA: UserPrincipal = {
        id: userA.id,
        email: userA.email,
        fullName: userA.fullName,
        role: UserRole.USER,
        organizationId: orgAlpha.id,
      };

      const result = await readService.getDocuments(principalUserA, {
        tab: 'all' as const,
        page: 1,
        limit: 1, // mỗi trang 1 item
      });

      expect(result.items).toHaveLength(1);
      expect(result.pagination.limit).toBe(1);
      expect(result.pagination.total).toBeGreaterThanOrEqual(2);
      expect(result.pagination.totalPages).toBeGreaterThanOrEqual(2);
    });

    testIfDb('1.7. Tìm kiếm theo tiêu đề hoạt động chính xác không phân biệt hoa thường', async () => {
      const principalUserA: UserPrincipal = {
        id: userA.id,
        email: userA.email,
        fullName: userA.fullName,
        role: UserRole.USER,
        organizationId: orgAlpha.id,
      };

      const result = await readService.getDocuments(principalUserA, {
        tab: 'all' as const,
        search: 'dell xps', // viết thường tìm kiếm trong tiêu đề
      });

      expect(result.items.some((d) => d.id === doc1Alpha.id)).toBe(true);
      expect(result.items.some((d) => d.id === doc2Alpha.id)).toBe(false);
    });

    testIfDb('1.8. Tuyệt đối không trả về passwordHash, secrets hay token trong items danh sách', async () => {
      const principalUserA: UserPrincipal = {
        id: userA.id,
        email: userA.email,
        fullName: userA.fullName,
        role: UserRole.USER,
        organizationId: orgAlpha.id,
      };

      const result = await readService.getDocuments(principalUserA, { tab: 'all' as const });

      for (const item of result.items) {
        expect((item as any).passwordHash).toBeUndefined();
        expect((item as any).secret).toBeUndefined();
        expect((item as any).token).toBeUndefined();
      }
    });
  });

  describe('2. GET /api/documents/:id trên PostgreSQL thật (Chi tiết, Phiên bản & Quyền)', () => {
    testIfDb('2.1. Chặn 403 Forbidden khi người dùng Công ty B cố tình truy cập ID hồ sơ Công ty A', async () => {
      const principalUserB: UserPrincipal = {
        id: userB.id,
        email: userB.email,
        fullName: userB.fullName,
        role: UserRole.USER,
        organizationId: orgBeta.id,
      };

      await expect(readService.getDocumentDetail(doc1Alpha.id, principalUserB)).rejects.toThrow(
        ForbiddenException
      );
    });

    testIfDb('2.2. Trả về 404 NotFoundException khi hồ sơ không tồn tại trong database', async () => {
      const principalUserA: UserPrincipal = {
        id: userA.id,
        email: userA.email,
        fullName: userA.fullName,
        role: UserRole.USER,
        organizationId: orgAlpha.id,
      };

      await expect(readService.getDocumentDetail('non-existent-uuid-1234', principalUserA)).rejects.toThrow(
        NotFoundException
      );
    });

    testIfDb('2.3. Lấy chi tiết hồ sơ thành công với dữ liệu quan hệ thật (activeVersion, workflow, assignees)', async () => {
      const principalUserA: UserPrincipal = {
        id: userA.id,
        email: userA.email,
        fullName: userA.fullName,
        role: UserRole.USER,
        organizationId: orgAlpha.id,
      };

      const detail = await readService.getDocumentDetail(doc1Alpha.id, principalUserA);

      expect(detail.id).toBe(doc1Alpha.id);
      expect(detail.title).toBe('Đề nghị cấp Laptop Dell XPS cho lập trình viên');
      expect(detail.activeVersion.formData).toEqual({ device: 'Dell XPS 15 9530', price: 45000000 });
      expect(detail.activeVersion.sha256Hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
      expect(detail.workflow.steps).toHaveLength(1);
      expect(detail.workflow.steps[0].stepName).toBe('Trưởng phòng CNTT xét duyệt');
      expect(detail.workflow.steps[0].assignees[0].userName).toBe('Trần Thị Trưởng Phòng (HQ)');
    });

    testIfDb('2.4. Tính toán quyền permissions chuẩn xác: Approver trong lượt duyệt có canApprove = true', async () => {
      const principalApproverA: UserPrincipal = {
        id: approverA.id,
        email: approverA.email,
        fullName: approverA.fullName,
        role: UserRole.USER,
        organizationId: orgAlpha.id,
      };

      const detail = await readService.getDocumentDetail(doc1Alpha.id, principalApproverA);

      expect(detail.permissions.canApprove).toBe(true);
      expect(detail.permissions.canResubmit).toBe(false);
      expect(detail.permissions.isCreator).toBe(false);
      expect(detail.permissions.currentStepAssigneeRole).toBe(AssigneeRole.APPROVER);
    });

    testIfDb('2.5. Quyền canResubmit = true trên hồ sơ REVISION_REQUESTED dành cho tác giả', async () => {
      const principalUserA: UserPrincipal = {
        id: userA.id,
        email: userA.email,
        fullName: userA.fullName,
        role: UserRole.USER,
        organizationId: orgAlpha.id,
      };

      const detail = await readService.getDocumentDetail(doc2Alpha.id, principalUserA);

      expect(detail.status).toBe(DocumentStatus.REVISION_REQUESTED);
      expect(detail.permissions.canApprove).toBe(false);
      expect(detail.permissions.canResubmit).toBe(true);
      expect(detail.permissions.isCreator).toBe(true);
    });
  });

  describe('3. GET /api/auth/me với PostgreSQL thật', () => {
    testIfDb('3.1. Trả về đúng thông tin tổ chức, phòng ban và không để lộ mật khẩu', async () => {
      const principalUserA: UserPrincipal = {
        id: userA.id,
        email: userA.email,
        fullName: userA.fullName,
        role: UserRole.USER,
        organizationId: orgAlpha.id,
        departmentId: deptItAlpha.id,
      };

      const res = await authController.getMe(principalUserA);

      expect(res.success).toBe(true);
      expect(res.data.id).toBe(userA.id);
      expect(res.data.email).toBe('author-alpha@vinagroup.vn');
      expect(res.data.organizationName).toBe('Tập đoàn VinaGroup (HQ)');
      expect(res.data.departmentName).toBe('Phòng Công nghệ Thông tin');
      expect((res.data as any).passwordHash).toBeUndefined();
    });
  });
});
