import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  PrismaClient,
  TemplateStatus,
  UserRole,
  DocumentStatus,
  StepStatus,
  WorkflowStatus,
  AssigneeDecision,
  AssigneeRole,
} from '@prisma/client';
import { WorkflowOrchestratorService } from '../src/modules/workflow/workflow-orchestrator.service.js';
import { DocumentReadService } from '../src/modules/workflow/document-read.service.js';
import { NotificationService } from '../src/modules/notification/notification.service.js';
import { DelegationService } from '../src/modules/delegation/delegation.service.js';
import { UserPrincipal } from '../src/common/interfaces/user-principal.interface.js';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

describe('Phase 12.1: Delegation Policy Engine & Auditable Workflow Integration (Real PostgreSQL)', () => {
  let prisma: PrismaClient;
  let orchestrator: WorkflowOrchestratorService;
  let readService: DocumentReadService;
  let notifService: NotificationService;
  let delegationService: DelegationService;

  let orgAlphaId: string;
  let orgBetaId: string;
  let deptFinanceId: string;

  let directorA: any;
  let deputyB: any;
  let assistantC: any;
  let directorBeta: any;
  let inactiveUser: any;
  let userCreator: any;

  let testTemplateId: string;
  let otherTemplateId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5432/trinh_ky_online_dev?schema=public';

    prisma = new PrismaClient();
    await prisma.$connect();
    console.log('✅ Đã kết nối PostgreSQL vật lý cho Phase 12.1 Delegation Integration Suite.');

    notifService = new NotificationService(prisma as any);
    delegationService = new DelegationService(prisma as any, notifService);
    orchestrator = new WorkflowOrchestratorService(prisma, delegationService);
    readService = new DocumentReadService(prisma as any);

    // 1. Tạo tổ chức thử nghiệm
    const orgAlpha = await prisma.organization.create({
      data: {
        code: `ALPHA_DEL_${Date.now()}`,
        name: 'Tập đoàn Alpha Delegation',
      },
    });
    orgAlphaId = orgAlpha.id;

    const orgBeta = await prisma.organization.create({
      data: {
        code: `BETA_DEL_${Date.now()}`,
        name: 'Công ty Beta Delegation (Tenant riêng biệt)',
      },
    });
    orgBetaId = orgBeta.id;

    // 2. Tạo phòng ban
    const dept = await prisma.department.create({
      data: {
        name: 'Phòng Tài Chính Kế Toán',
        code: `TC_${Date.now()}`,
        organizationId: orgAlphaId,
      },
    });
    deptFinanceId = dept.id;

    // 3. Tạo người dùng kiểm thử
    const stamp = Date.now();
    directorA = await prisma.user.create({
      data: {
        email: `director.a.${stamp}@alpha.com`,
        fullName: 'Nguyễn Văn Giám Đốc A',
        passwordHash: 'dummy',
        role: UserRole.USER,
        organizationId: orgAlphaId,
        departmentId: deptFinanceId,
        isActive: true,
      },
    });

    deputyB = await prisma.user.create({
      data: {
        email: `deputy.b.${stamp}@alpha.com`,
        fullName: 'Trần Thị Phó Giám Đốc B',
        passwordHash: 'dummy',
        role: UserRole.USER,
        organizationId: orgAlphaId,
        departmentId: deptFinanceId,
        isActive: true,
      },
    });

    assistantC = await prisma.user.create({
      data: {
        email: `assistant.c.${stamp}@alpha.com`,
        fullName: 'Lê Văn Trợ Lý C',
        passwordHash: 'dummy',
        role: UserRole.USER,
        organizationId: orgAlphaId,
        departmentId: deptFinanceId,
        isActive: true,
      },
    });

    directorBeta = await prisma.user.create({
      data: {
        email: `director.beta.${stamp}@beta.com`,
        fullName: 'Hoàng Giám Đốc Beta',
        passwordHash: 'dummy',
        role: UserRole.USER,
        organizationId: orgBetaId,
        isActive: true,
      },
    });

    inactiveUser = await prisma.user.create({
      data: {
        email: `inactive.${stamp}@alpha.com`,
        fullName: 'Phạm Người Cũ Đã Nghỉ Việc',
        passwordHash: 'dummy',
        role: UserRole.USER,
        organizationId: orgAlphaId,
        isActive: false,
      },
    });

    userCreator = await prisma.user.create({
      data: {
        email: `creator.${stamp}@alpha.com`,
        fullName: 'Vũ Chuyên Viên Soạn Thảo',
        passwordHash: 'dummy',
        role: UserRole.USER,
        organizationId: orgAlphaId,
        isActive: true,
      },
    });

    // 4. Tạo templates
    const tpl1 = await prisma.formTemplate.create({
      data: {
        code: `TPL_PAYMENT_${stamp}`,
        title: 'Giấy đề nghị thanh toán',
        status: TemplateStatus.PUBLISHED,
        organizationId: orgAlphaId,
        createdById: directorA.id,
        currentVersion: 1,
        fields: [{ id: 'f1', key: 'amount', label: 'Số tiền', type: 'number', required: true, order: 1 }],
        layoutBlocks: [{ id: 'b1', type: 'header', config: { title: 'Đơn' }, order: 1 }],
      },
    });
    testTemplateId = tpl1.id;

    await prisma.formTemplateVersion.create({
      data: {
        templateId: tpl1.id,
        versionNumber: 1,
        title: tpl1.title,
        status: TemplateStatus.PUBLISHED,
        createdById: directorA.id,
        fields: tpl1.fields as any,
        layoutBlocks: tpl1.layoutBlocks as any,
      },
    });

    const tpl2 = await prisma.formTemplate.create({
      data: {
        code: `TPL_LEAVE_${stamp}`,
        title: 'Đơn xin nghỉ phép',
        status: TemplateStatus.PUBLISHED,
        organizationId: orgAlphaId,
        createdById: directorA.id,
        currentVersion: 1,
        fields: [{ id: 'f1', key: 'days', label: 'Số ngày nghỉ', type: 'number', required: true, order: 1 }],
        layoutBlocks: [{ id: 'b1', type: 'header', config: { title: 'Đơn' }, order: 1 }],
      },
    });
    otherTemplateId = tpl2.id;

    await prisma.formTemplateVersion.create({
      data: {
        templateId: tpl2.id,
        versionNumber: 1,
        title: tpl2.title,
        status: TemplateStatus.PUBLISHED,
        createdById: directorA.id,
        fields: tpl2.fields as any,
        layoutBlocks: tpl2.layoutBlocks as any,
      },
    });
  });

  afterAll(async () => {
    // Dọn dẹp dữ liệu test an toàn
    try {
      await prisma.delegationPolicy.deleteMany({
        where: { organizationId: { in: [orgAlphaId, orgBetaId] } },
      });
      await prisma.notification.deleteMany({
        where: { userId: { in: [directorA.id, deputyB.id, assistantC.id, directorBeta.id, userCreator.id] } },
      });
      await prisma.stepDecisionHistory.deleteMany({
        where: { user: { organizationId: { in: [orgAlphaId, orgBetaId] } } },
      });
      await prisma.stepAssignee.deleteMany({
        where: { user: { organizationId: { in: [orgAlphaId, orgBetaId] } } },
      });
      await prisma.approvalStep.deleteMany({
        where: { workflow: { document: { organizationId: { in: [orgAlphaId, orgBetaId] } } } },
      });
      await prisma.approvalWorkflow.deleteMany({
        where: { document: { organizationId: { in: [orgAlphaId, orgBetaId] } } },
      });
      await prisma.documentVersion.deleteMany({
        where: { document: { organizationId: { in: [orgAlphaId, orgBetaId] } } },
      });
      await prisma.signatureEvent.deleteMany({
        where: { document: { organizationId: { in: [orgAlphaId, orgBetaId] } } },
      });
      await prisma.auditLog.deleteMany({
        where: { userId: { in: [directorA.id, deputyB.id, assistantC.id, directorBeta.id, userCreator.id] } },
      });
      await prisma.document.deleteMany({
        where: { organizationId: { in: [orgAlphaId, orgBetaId] } },
      });
      await prisma.formTemplateVersion.deleteMany({
        where: { templateId: { in: [testTemplateId, otherTemplateId] } },
      });
      await prisma.formTemplate.deleteMany({
        where: { id: { in: [testTemplateId, otherTemplateId] } },
      });
      await prisma.department.deleteMany({
        where: { id: deptFinanceId },
      });
      await prisma.user.deleteMany({
        where: { organizationId: { in: [orgAlphaId, orgBetaId] } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: [orgAlphaId, orgBetaId] } },
      });
    } catch (e) {
      console.warn('Lỗi dọn dẹp integration tests:', e);
    } finally {
      await prisma.$disconnect();
    }
  });

  describe('1. Kiểm soát hợp lệ và Ranh giới bảo mật (Policy Validation & Security Gates)', () => {
    it('1.1. Chặn ủy quyền xuyên tổ chức (Cross-Tenant Delegation Blocked)', async () => {
      await expect(
        delegationService.createPolicy(directorA.id, 'USER', orgAlphaId, {
          delegateeId: directorBeta.id, // Thuộc Org Beta!
          startDate: new Date(Date.now() - 3600000).toISOString(),
          endDate: new Date(Date.now() + 86400000).toISOString(),
          reason: 'Ủy quyền sang công ty khác',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('1.2. Chặn tự ủy quyền cho chính bản thân (Self-Delegation Blocked)', async () => {
      await expect(
        delegationService.createPolicy(directorA.id, 'USER', orgAlphaId, {
          delegateeId: directorA.id, // Tự ủy quyền cho mình!
          startDate: new Date(Date.now() - 3600000).toISOString(),
          endDate: new Date(Date.now() + 86400000).toISOString(),
          reason: 'Tự ủy quyền',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('1.3. Chặn ủy quyền khi người được ủy quyền đang bị vô hiệu hóa (Inactive Account)', async () => {
      await expect(
        delegationService.createPolicy(directorA.id, 'USER', orgAlphaId, {
          delegateeId: inactiveUser.id, // Đã nghỉ việc!
          startDate: new Date(Date.now() - 3600000).toISOString(),
          endDate: new Date(Date.now() + 86400000).toISOString(),
          reason: 'Ủy quyền cho người đã nghỉ việc',
        })
      ).rejects.toThrow('vô hiệu hóa');
    });

    it('1.4. Chặn khoảng thời gian không hợp lệ (startDate >= endDate)', async () => {
      await expect(
        delegationService.createPolicy(directorA.id, 'USER', orgAlphaId, {
          delegateeId: deputyB.id,
          startDate: new Date(Date.now() + 86400000).toISOString(),
          endDate: new Date(Date.now() - 86400000).toISOString(),
        })
      ).rejects.toThrow('startDate');
    });
  });

  describe('2. Thuật toán phát hiện chu trình ủy quyền & Kiểm soát tương tranh (Temporal Cycle & Concurrency on PostgreSQL)', () => {
    let p1Id: string;
    let p2Id: string;

    it('2.1. Tạo policy hợp lệ: Giám Đốc A -> Phó Giám Đốc B', async () => {
      const now = Date.now();
      const p1 = await delegationService.createPolicy(directorA.id, 'USER', orgAlphaId, {
        delegateeId: deputyB.id,
        startDate: new Date(now - 10000).toISOString(),
        endDate: new Date(now + 7 * 86400000).toISOString(),
        reason: 'Đi công tác tuần này',
      });

      expect(p1.id).toBeDefined();
      expect(p1.isActive).toBe(true);
      expect(p1.delegatorName).toBe(directorA.fullName);
      p1Id = p1.id;
    });

    it('2.2. Chặn chu trình trực tiếp 2 đỉnh (Direct Cycle: B -> A)', async () => {
      const now = Date.now();
      // B cố tạo ủy quyền ngược lại cho A trong khoảng thời gian đang có hiệu lực
      await expect(
        delegationService.createPolicy(deputyB.id, 'USER', orgAlphaId, {
          delegateeId: directorA.id,
          startDate: new Date(now).toISOString(),
          endDate: new Date(now + 3 * 86400000).toISOString(),
          reason: 'B ủy quyền ngược cho A',
        })
      ).rejects.toThrow('chu trình ủy quyền khép kín');
    });

    it('2.3. Cho phép B -> C, nhưng chặn chu trình gián tiếp 3 đỉnh (Indirect Cycle: C -> A)', async () => {
      const now = Date.now();
      // B -> C (hợp lệ)
      const p2 = await delegationService.createPolicy(deputyB.id, 'USER', orgAlphaId, {
        delegateeId: assistantC.id,
        startDate: new Date(now).toISOString(),
        endDate: new Date(now + 4 * 86400000).toISOString(),
        reason: 'B giao việc cho Trợ lý C',
      });
      p2Id = p2.id;
      expect(p2.id).toBeDefined();

      // Giờ C cố ủy quyền ngược lại cho A (tạo chu trình A -> B -> C -> A)
      await expect(
        delegationService.createPolicy(assistantC.id, 'USER', orgAlphaId, {
          delegateeId: directorA.id,
          startDate: new Date(now).toISOString(),
          endDate: new Date(now + 2 * 86400000).toISOString(),
          reason: 'C ủy quyền ngược lại cho A',
        })
      ).rejects.toThrow('chu trình ủy quyền khép kín');
    });

    it('2.4. Kiểm soát tương tranh: Hai request đồng thời tạo cạnh ngược chiều (A->B và B->A)', async () => {
      // Dọn dẹp p1, p2 trước để test concurrency thuần túy giữa B và C
      await prisma.delegationPolicy.deleteMany({
        where: { id: { in: [p1Id, p2Id] } },
      });

      const now = Date.now();
      // Bắn đồng thời 2 transaction tạo B -> C và C -> B
      const [resBC, resCB] = await Promise.allSettled([
        delegationService.createPolicy(deputyB.id, 'USER', orgAlphaId, {
          delegateeId: assistantC.id,
          startDate: new Date(now).toISOString(),
          endDate: new Date(now + 5 * 86400000).toISOString(),
          reason: 'Concurrent create B -> C',
        }),
        delegationService.createPolicy(assistantC.id, 'USER', orgAlphaId, {
          delegateeId: deputyB.id,
          startDate: new Date(now).toISOString(),
          endDate: new Date(now + 5 * 86400000).toISOString(),
          reason: 'Concurrent create C -> B',
        }),
      ]);

      // Phải có đúng 1 request thành công và 1 request thất bại vì chu trình ủy quyền
      const fulfilled = [resBC, resCB].filter((r) => r.status === 'fulfilled');
      const rejected = [resBC, resCB].filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      const rejectedReason = (rejected[0] as PromiseRejectedResult).reason;
      expect(rejectedReason.message).toContain('chu trình ủy quyền khép kín');

      // Xác minh DB chỉ lưu duy nhất 1 cạnh, hoàn toàn không bị race condition
      const activeEdges = await prisma.delegationPolicy.findMany({
        where: {
          organizationId: orgAlphaId,
          isActive: true,
          OR: [
            { delegatorId: deputyB.id, delegateeId: assistantC.id },
            { delegatorId: assistantC.id, delegateeId: deputyB.id },
          ],
        },
      });
      expect(activeEdges.length).toBe(1);

      // Dọn dẹp cạnh vừa tạo
      await prisma.delegationPolicy.deleteMany({
        where: { id: activeEdges[0].id },
      });
    });

    it('2.5. Temporal Cycle: Đường đi khép kín nhưng không có thời điểm chung (Disjoint windows) ĐƯỢC PHÉP tạo', async () => {
      // Scenario mẫu:
      // A -> B: ngày 1 -> ngày 10
      // B -> C: ngày 20 -> ngày 30
      // C -> A: ngày 12 -> ngày 18
      const base = Date.now() + 10 * 86400000;
      const t_A_B_start = new Date(base + 1 * 86400000);
      const t_A_B_end = new Date(base + 10 * 86400000);

      const t_B_C_start = new Date(base + 20 * 86400000);
      const t_B_C_end = new Date(base + 30 * 86400000);

      const t_C_A_start = new Date(base + 12 * 86400000);
      const t_C_A_end = new Date(base + 18 * 86400000);

      // Cạnh 1: A -> B
      const pol1 = await delegationService.createPolicy(directorA.id, 'USER', orgAlphaId, {
        delegateeId: deputyB.id,
        startDate: t_A_B_start.toISOString(),
        endDate: t_A_B_end.toISOString(),
        reason: 'A sang B giai đoạn 1',
      });

      // Cạnh 2: B -> C
      const pol2 = await delegationService.createPolicy(deputyB.id, 'USER', orgAlphaId, {
        delegateeId: assistantC.id,
        startDate: t_B_C_start.toISOString(),
        endDate: t_B_C_end.toISOString(),
        reason: 'B sang C giai đoạn 2',
      });

      // Cạnh 3: C -> A (không có thời điểm nào giao nhau chung giữa 3 cạnh)
      const pol3 = await delegationService.createPolicy(assistantC.id, 'USER', orgAlphaId, {
        delegateeId: directorA.id,
        startDate: t_C_A_start.toISOString(),
        endDate: t_C_A_end.toISOString(),
        reason: 'C sang A giai đoạn giữa',
      });

      expect(pol1.id).toBeDefined();
      expect(pol2.id).toBeDefined();
      expect(pol3.id).toBeDefined();

      // Dọn dẹp cả 3
      await prisma.delegationPolicy.deleteMany({
        where: { id: { in: [pol1.id, pol2.id, pol3.id] } },
      });
    });

    it('2.6. Temporal Cycle: Chặn khi có khoảng thời gian giao nhau thực sự', async () => {
      // A -> B: ngày 1 -> ngày 20
      // B -> C: ngày 10 -> ngày 30
      // C -> A: ngày 15 -> ngày 25
      // Giao nhau tại ngày 15 -> 20 -> Chu trình thực sự!
      const base = Date.now() + 50 * 86400000;
      const pol1 = await delegationService.createPolicy(directorA.id, 'USER', orgAlphaId, {
        delegateeId: deputyB.id,
        startDate: new Date(base + 1 * 86400000).toISOString(),
        endDate: new Date(base + 20 * 86400000).toISOString(),
        reason: 'A sang B có giao thoa',
      });

      const pol2 = await delegationService.createPolicy(deputyB.id, 'USER', orgAlphaId, {
        delegateeId: assistantC.id,
        startDate: new Date(base + 10 * 86400000).toISOString(),
        endDate: new Date(base + 30 * 86400000).toISOString(),
        reason: 'B sang C có giao thoa',
      });

      await expect(
        delegationService.createPolicy(assistantC.id, 'USER', orgAlphaId, {
          delegateeId: directorA.id,
          startDate: new Date(base + 15 * 86400000).toISOString(),
          endDate: new Date(base + 25 * 86400000).toISOString(),
          reason: 'C sang A trùng thời điểm',
        })
      ).rejects.toThrow('chu trình ủy quyền khép kín');

      await prisma.delegationPolicy.deleteMany({
        where: { id: { in: [pol1.id, pol2.id] } },
      });
    });

    it('2.7. Cập nhật policy (updatePolicy) kéo dài endDate tạo chu trình sẽ bị chặn', async () => {
      const base = Date.now() + 100 * 86400000;
      // A -> B: ngày 1 -> ngày 20
      const pol1 = await delegationService.createPolicy(directorA.id, 'USER', orgAlphaId, {
        delegateeId: deputyB.id,
        startDate: new Date(base + 1 * 86400000).toISOString(),
        endDate: new Date(base + 20 * 86400000).toISOString(),
      });

      // B -> A ban đầu ở ngày 25 -> ngày 30 (không giao thoa)
      const pol2 = await delegationService.createPolicy(deputyB.id, 'USER', orgAlphaId, {
        delegateeId: directorA.id,
        startDate: new Date(base + 25 * 86400000).toISOString(),
        endDate: new Date(base + 30 * 86400000).toISOString(),
      });

      // Bây giờ cố tình update pol1 kéo dài endDate từ ngày 20 sang ngày 28 (giao thoa với pol2 ngày 25-28)
      await expect(
        delegationService.updatePolicy(pol1.id, directorA.id, 'USER', orgAlphaId, {
          endDate: new Date(base + 28 * 86400000).toISOString(),
        })
      ).rejects.toThrow('chu trình ủy quyền khép kín');

      await prisma.delegationPolicy.deleteMany({
        where: { id: { in: [pol1.id, pol2.id] } },
      });
    });

    it('2.8. Policy đã bị thu hồi (isActive = false) không cản trở ủy quyền ngược chiều', async () => {
      const now = Date.now();
      // Tạo A -> B
      const pol1 = await delegationService.createPolicy(directorA.id, 'USER', orgAlphaId, {
        delegateeId: deputyB.id,
        startDate: new Date(now).toISOString(),
        endDate: new Date(now + 86400000).toISOString(),
      });

      // Thu hồi pol1
      await delegationService.revokePolicy(pol1.id, directorA.id, 'USER', orgAlphaId, 'Hủy ủy quyền');

      // Giờ B -> A trong cùng khoảng thời gian -> Phải THÀNH CÔNG vì pol1 đã inactive
      const pol2 = await delegationService.createPolicy(deputyB.id, 'USER', orgAlphaId, {
        delegateeId: directorA.id,
        startDate: new Date(now).toISOString(),
        endDate: new Date(now + 86400000).toISOString(),
      });

      expect(pol2.id).toBeDefined();
      expect(pol2.isActive).toBe(true);

      await prisma.delegationPolicy.deleteMany({
        where: { id: { in: [pol1.id, pol2.id] } },
      });
    });
  });

  describe('3. Tích hợp Workflow & Quyết định ủy quyền (Auditable Workflow Integration)', () => {
    let documentId: string;
    let stepId: string;
    let policyId: string;

    beforeAll(async () => {
      // 1. Tạo hồ sơ trình ký với Bước 1 là Giám đốc A
      const doc = await orchestrator.createDocument({
        templateId: testTemplateId,
        title: 'Hồ sơ tạm ứng kinh phí công tác',
        formData: { amount: 50000000 },
        userId: userCreator.id,
        userOrganizationId: orgAlphaId,
        userDepartmentId: deptFinanceId,
      });
      documentId = doc.id;

      // Cập nhật bước 1 gán cho directorA
      const workflow = await prisma.approvalWorkflow.findUnique({
        where: { documentId },
        include: { steps: true },
      });
      const step1 = workflow!.steps[0];
      stepId = step1.id;

      await prisma.stepAssignee.create({
        data: {
          stepId: step1.id,
          userId: directorA.id,
          role: AssigneeRole.APPROVER,
          decision: AssigneeDecision.PENDING,
        },
      });

      // Submit hồ sơ
      await orchestrator.submitDocument({
        documentId,
        userId: userCreator.id,
      });

      // 2. Tạo Delegation Policy từ Director A cho Deputy B với scope testTemplateId
      const now = Date.now();
      const p = await delegationService.createPolicy(directorA.id, 'USER', orgAlphaId, {
        delegateeId: deputyB.id,
        startDate: new Date(now - 60000).toISOString(),
        endDate: new Date(now + 86400000).toISOString(),
        scopeTemplateId: testTemplateId,
        reason: 'Ủy quyền ký hồ sơ thanh toán',
      });
      policyId = p.id;
    });

    it('3.1. Người ngoài (Assistant C) không có quyền duyệt khi chưa được ủy quyền', async () => {
      await expect(
        orchestrator.processAssigneeDecision({
          documentId,
          userId: assistantC.id,
          decision: AssigneeDecision.APPROVED,
          decisionComment: 'Cố tình duyệt khi không có quyền',
        })
      ).rejects.toThrow(ForbiddenException);
    });

    it('3.2. Delegatee hợp lệ (Deputy B) kiểm tra quyền đọc thấy canApprove = true và isDelegatedApproval = true', async () => {
      const userPrincipalB: UserPrincipal = {
        id: deputyB.id,
        email: deputyB.email,
        fullName: deputyB.fullName,
        role: UserRole.USER,
        organizationId: orgAlphaId,
      };

      const docDetail = await readService.getDocumentDetail(documentId, userPrincipalB);

      expect(docDetail.permissions.canApprove).toBe(true);
      expect(docDetail.permissions.isDelegatedApproval).toBe(true);
      expect(docDetail.permissions.delegatedFromUserName).toBe(directorA.fullName);
    });

    it('3.3. Delegatee hợp lệ (Deputy B) thực hiện phê duyệt thay mặt Director A thành công', async () => {
      const result = await orchestrator.processAssigneeDecision({
        documentId,
        userId: deputyB.id, // Deputy B thực sự thực hiện quyết định
        decision: AssigneeDecision.APPROVED,
        decisionComment: 'Phê duyệt thay mặt Giám đốc theo ủy quyền',
        signatureImageUrl: 'data:image/png;base64,signatureB',
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0 IntegrationTest',
      });

      expect(result.success).toBe(true);

      // Kiểm tra StepAssignee: Assignee gốc của Director A được cập nhật sang APPROVED
      const assigneeRecord = await prisma.stepAssignee.findFirst({
        where: { stepId, userId: directorA.id },
      });
      expect(assigneeRecord?.decision).toBe(AssigneeDecision.APPROVED);

      // Kiểm tra StepDecisionHistory: Lưu đầy đủ vết kiểm toán
      const decisionHistory = await prisma.stepDecisionHistory.findFirst({
        where: { stepId },
        orderBy: { decidedAt: 'desc' },
      });

      expect(decisionHistory).toBeDefined();
      expect(decisionHistory?.userId).toBe(deputyB.id); // Actual Actor là Deputy B
      expect(decisionHistory?.isDelegated).toBe(true); // Cờ ủy quyền bật true
      expect(decisionHistory?.delegatedFromUserId).toBe(directorA.id); // Ghi nhận ủy quyền từ ai
      expect(decisionHistory?.delegationPolicyId).toBe(policyId); // Ghi nhận căn cứ policy nào

      // Kiểm tra SignatureEvent: Chữ ký được gắn đúng cho Deputy B
      const sig = await prisma.signatureEvent.findFirst({
        where: { documentId, stepId },
      });
      expect(sig).toBeDefined();
      expect(sig?.userId).toBe(deputyB.id);
      expect(sig?.signatureImageUrl).toBe('data:image/png;base64,signatureB');

      // Kiểm tra AuditLog
      const audit = await prisma.auditLog.findFirst({
        where: { documentId, userId: deputyB.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit).toBeDefined();
      const details = audit?.details as any;
      expect(details.isDelegated).toBe(true);
      expect(details.delegatorId).toBe(directorA.id);
      expect(details.delegationPolicyId).toBe(policyId);

      // Kiểm tra In-App Notification: Director A nhận được thông báo hồ sơ đã được xử lý thay mặt mình
      const notif = await prisma.notification.findFirst({
        where: { userId: directorA.id, documentId },
        orderBy: { createdAt: 'desc' },
      });
      expect(notif).toBeDefined();
      expect(notif?.title).toContain('ủy quyền');
    });

    it('3.4. Race condition: Thu hồi policy thì quyền duyệt proxy bị thu hồi ngay lập tức trên tài liệu mới', async () => {
      // Thu hồi policy
      await delegationService.revokePolicy(policyId, directorA.id, 'USER', orgAlphaId, 'Thu hồi quyền');

      // Tạo một tài liệu mới khác gán cho Director A
      const doc2 = await orchestrator.createDocument({
        templateId: testTemplateId,
        title: 'Hồ sơ mới sau khi thu hồi ủy quyền',
        formData: { amount: 10000000 },
        userId: userCreator.id,
        userOrganizationId: orgAlphaId,
      });

      const workflow2 = await prisma.approvalWorkflow.findUnique({
        where: { documentId: doc2.id },
        include: { steps: true },
      });
      await prisma.stepAssignee.create({
        data: {
          stepId: workflow2!.steps[0].id,
          userId: directorA.id,
          role: AssigneeRole.APPROVER,
          decision: AssigneeDecision.PENDING,
        },
      });

      await orchestrator.submitDocument({
        documentId: doc2.id,
        userId: userCreator.id,
      });

      // Deputy B cố thực hiện phê duyệt hồ sơ mới
      await expect(
        orchestrator.processAssigneeDecision({
          documentId: doc2.id,
          userId: deputyB.id,
          decision: AssigneeDecision.APPROVED,
          decisionComment: 'Cố duyệt khi policy đã bị thu hồi',
        })
      ).rejects.toThrow(ForbiddenException);

      // Kiểm tra quyền xem của Deputy B trên hồ sơ mới
      const userPrincipalB: UserPrincipal = {
        id: deputyB.id,
        email: deputyB.email,
        fullName: deputyB.fullName,
        role: UserRole.USER,
        organizationId: orgAlphaId,
      };
      const detail2 = await readService.getDocumentDetail(doc2.id, userPrincipalB);
      expect(detail2.permissions.canApprove).toBe(false);
      expect(detail2.permissions.isDelegatedApproval).toBe(false);
    });

    it('3.5. Race condition thực tế: Thu hồi policy (revokePolicy) đồng thời với ủy quyền phê duyệt (processAssigneeDecision)', async () => {
      // 1. Tạo hồ sơ mới gán cho Director A
      const docRace = await orchestrator.createDocument({
        templateId: testTemplateId,
        title: 'Hồ sơ kiểm thử race condition revoke/approve',
        formData: { amount: 25000000 },
        userId: userCreator.id,
        userOrganizationId: orgAlphaId,
        userDepartmentId: deptFinanceId,
      });

      const workflowRace = await prisma.approvalWorkflow.findUnique({
        where: { documentId: docRace.id },
        include: { steps: true },
      });
      const stepRace = workflowRace!.steps[0];
      await prisma.stepAssignee.create({
        data: {
          stepId: stepRace.id,
          userId: directorA.id,
          role: AssigneeRole.APPROVER,
          decision: AssigneeDecision.PENDING,
        },
      });

      await orchestrator.submitDocument({
        documentId: docRace.id,
        userId: userCreator.id,
      });

      // 2. Tạo policy ủy quyền Director A -> Deputy B
      const now = Date.now();
      const pRace = await delegationService.createPolicy(directorA.id, 'USER', orgAlphaId, {
        delegateeId: deputyB.id,
        startDate: new Date(now - 10000).toISOString(),
        endDate: new Date(now + 86400000).toISOString(),
        scopeTemplateId: testTemplateId,
        reason: 'Ủy quyền cho test race revoke/approve',
      });

      // 3. Bắn đồng thời revokePolicy và processAssigneeDecision
      const [revokeRes, approveRes] = await Promise.allSettled([
        delegationService.revokePolicy(pRace.id, directorA.id, 'USER', orgAlphaId, 'Thu hồi đồng thời'),
        orchestrator.processAssigneeDecision({
          documentId: docRace.id,
          userId: deputyB.id,
          decision: AssigneeDecision.APPROVED,
          decisionComment: 'Phê duyệt đồng thời lúc thu hồi',
        }),
      ]);

      // Thứ tự tuần tự hóa đã xác định bởi khóa FOR UPDATE trên delegation_policies:
      // Trường hợp 1: Nếu revoke thắng trước:
      // - revokeRes fulfilled (isActive: false)
      // - approveRes rejected với ForbiddenException ('Chính sách ủy quyền đã bị thu hồi hoặc hết thời hạn hiệu lực trong quá trình xử lý.')
      // Trường hợp 2: Nếu approve thắng trước:
      // - approveRes fulfilled (step APPROVED)
      // - revokeRes fulfilled (sau khi approve cam kết xong, revoke khóa row và đánh dấu isActive: false)
      if (revokeRes.status === 'fulfilled' && approveRes.status === 'rejected') {
        const err = (approveRes as PromiseRejectedResult).reason;
        expect(err).toBeInstanceOf(ForbiddenException);
        expect(
          err.message.includes('bị thu hồi') ||
          err.message.includes('không có ủy quyền hợp lệ')
        ).toBe(true);
      } else if (approveRes.status === 'fulfilled' && revokeRes.status === 'fulfilled') {
        const history = await prisma.stepDecisionHistory.findFirst({
          where: { stepId: stepRace.id },
        });
        expect(history?.isDelegated).toBe(true);
        expect(history?.delegatedFromUserId).toBe(directorA.id);
      } else {
        throw new Error(`Trạng thái không mong muốn trong race condition: revoke=${revokeRes.status}, approve=${approveRes.status}`);
      }

      // Cuối cùng policy PHẢI luôn ở trạng thái inactive
      const finalPolicy = await prisma.delegationPolicy.findUnique({
        where: { id: pRace.id },
      });
      expect(finalPolicy?.isActive).toBe(false);
    });
  });

  describe('4. Phân quyền danh sách policy & Tenant Isolation (getPolicies on PostgreSQL)', () => {
    let polAlphaId: string;
    let polBetaId: string;

    beforeAll(async () => {
      const now = Date.now();
      // Policy 1 trong Alpha: Director A -> Deputy B
      const pAlpha = await delegationService.createPolicy(directorA.id, 'USER', orgAlphaId, {
        delegateeId: deputyB.id,
        startDate: new Date(now - 1000).toISOString(),
        endDate: new Date(now + 86400000).toISOString(),
        reason: 'Policy nội bộ Alpha',
      });
      polAlphaId = pAlpha.id;

      // Policy 2 trong Beta: Director Beta -> User khác trong Beta
      const userBeta2 = await prisma.user.create({
        data: {
          email: `subordinate.beta.${now}@beta.com`,
          fullName: 'Nhân viên Beta 2',
          passwordHash: 'dummy',
          role: UserRole.USER,
          organizationId: orgBetaId,
          isActive: true,
        },
      });

      const pBeta = await delegationService.createPolicy(directorBeta.id, 'USER', orgBetaId, {
        delegateeId: userBeta2.id,
        startDate: new Date(now - 1000).toISOString(),
        endDate: new Date(now + 86400000).toISOString(),
        reason: 'Policy nội bộ Beta',
      });
      polBetaId = pBeta.id;
    });

    afterAll(async () => {
      await prisma.delegationPolicy.deleteMany({
        where: { id: { in: [polAlphaId, polBetaId] } },
      });
    });

    it('4.1. USER query role=all chỉ thấy policy của chính mình, không thấy của đồng nghiệp khác', async () => {
      const resC = await delegationService.getPolicies(assistantC.id, 'USER', orgAlphaId, {
        role: 'all',
      });

      const foundInC = resC.items.find((p) => p.id === polAlphaId);
      expect(foundInC).toBeUndefined();

      const resB = await delegationService.getPolicies(deputyB.id, 'USER', orgAlphaId, {
        role: 'all',
      });
      const foundInB = resB.items.find((p) => p.id === polAlphaId);
      expect(foundInB).toBeDefined();
    });

    it('4.2. USER từ Org Beta không thể thấy policy của Org Alpha kể cả truyền organizationId của Alpha', async () => {
      const resBetaUser = await delegationService.getPolicies(directorBeta.id, 'USER', orgBetaId, {
        role: 'all',
        organizationId: orgAlphaId,
      });

      const leakAlpha = resBetaUser.items.find((p) => p.organizationId === orgAlphaId);
      expect(leakAlpha).toBeUndefined();
    });

    it('4.3. ADMIN từ Org Beta bị giới hạn trong Org Beta, không xem được Org Alpha', async () => {
      const resBetaAdmin = await delegationService.getPolicies(directorBeta.id, 'ADMIN', orgBetaId, {
        organizationId: orgAlphaId,
      });

      const leakAlpha = resBetaAdmin.items.find((p) => p.organizationId === orgAlphaId);
      expect(leakAlpha).toBeUndefined();
    });

    it('4.4. ADMIN Org Alpha xem được toàn bộ policy trong Org Alpha', async () => {
      const resAlphaAdmin = await delegationService.getPolicies(directorA.id, 'ADMIN', orgAlphaId, {});
      const found = resAlphaAdmin.items.find((p) => p.id === polAlphaId);
      expect(found).toBeDefined();
    });
  });
});
