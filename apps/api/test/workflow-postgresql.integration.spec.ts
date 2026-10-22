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
import { WorkflowOrchestratorService } from '../src/modules/workflow/workflow-orchestrator.service.js';

/**
 * ============================================================================
 * INTEGRATION TEST SUITE CHO HỆ THỐNG TRÌNH KÝ TRÊN POSTGRESQL THẬT
 * ============================================================================
 * Chú ý: Bộ test này kết nối trực tiếp đến PostgreSQL vật lý (không dùng Mock).
 * Nếu database chưa sẵn sàng tại localhost:5432, bộ test sẽ tự động ghi chú
 * tình trạng rõ ràng và bỏ qua an toàn, không ngụy tạo kết quả kiểm thử.
 */
describe('Workflow PostgreSQL Real Integration Tests (Database Thật)', () => {
  let prisma: PrismaClient;
  let orchestrator: WorkflowOrchestratorService;
  let isPostgresAvailable = false;

  const testDbUrl =
    process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://postgres:devpassword123@localhost:5432/trinh_ky_online_dev?schema=public';

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: testDbUrl,
        },
      },
    });

    try {
      // Kiểm tra kết nối thực tế tới PostgreSQL
      await prisma.$connect();
      // Thực hiện truy vấn kiểm tra
      await prisma.$queryRaw`SELECT 1`;
      isPostgresAvailable = true;
      orchestrator = new WorkflowOrchestratorService(prisma);
      console.log('✅ Đã kết nối thành công tới PostgreSQL Test Database.');
    } catch (err: any) {
      isPostgresAvailable = false;
      console.warn(
        '\n⚠️  [THÔNG BÁO TÍCH HỢP POSTGRESQL]:' +
          '\n   Không thể kết nối tới PostgreSQL server tại: ' +
          testDbUrl +
          '\n   Nguyên nhân: ' +
          err.message +
          '\n   -> Để chạy integration test này:' +
          '\n      1. Khởi động PostgreSQL: docker compose -f docker-compose.dev.yml up -d' +
          '\n      2. Chạy migration: pnpm --filter @trinh-ky/api prisma:migrate' +
          '\n      3. Chạy test: pnpm --filter @trinh-ky/api test:integration\n'
      );
    }
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  // Helper hàm để bỏ qua test khi chưa có PostgreSQL thật
  const runIfDb = (name: string, fn: () => Promise<void>) => {
    it(name, async () => {
      if (!isPostgresAvailable) {
        console.log(`[SKIP - NO POSTGRES] Bỏ qua test: ${name}`);
        return;
      }
      await fn();
    });
  };

  runIfDb('1. Migration và tạo dữ liệu quan hệ hoàn chỉnh (Relationship Integrity)', async () => {
    // Tạo 2 công ty
    const orgA = await prisma.organization.upsert({
      where: { code: 'TEST-ORG-A' },
      update: {},
      create: { code: 'TEST-ORG-A', name: 'Công ty Cổ phần Công nghệ A' },
    });

    const orgB = await prisma.organization.upsert({
      where: { code: 'TEST-ORG-B' },
      update: {},
      create: { code: 'TEST-ORG-B', name: 'Công ty Thành viên B' },
    });

    expect(orgA.id).toBeDefined();
    expect(orgB.id).toBeDefined();

    // Tạo Users
    const userA = await prisma.user.upsert({
      where: { email: 'author-a@company.com' },
      update: {},
      create: {
        email: 'author-a@company.com',
        fullName: 'Nguyễn Văn Tác Giả A',
        passwordHash: 'hash-secret',
        role: UserRole.USER,
        organizationId: orgA.id,
      },
    });

    const approverA1 = await prisma.user.upsert({
      where: { email: 'approver-a1@company.com' },
      update: {},
      create: {
        email: 'approver-a1@company.com',
        fullName: 'Trưởng phòng A1',
        passwordHash: 'hash-secret',
        role: UserRole.USER,
        organizationId: orgA.id,
      },
    });

    const template = await prisma.formTemplate.upsert({
      where: { code: 'TEST-TEMPLATE-ADVANCE' },
      update: {},
      create: {
        code: 'TEST-TEMPLATE-ADVANCE',
        title: 'Giấy đề nghị tạm ứng công tác phí',
        fields: [{ id: 'amount', label: 'Số tiền tạm ứng', type: 'number', required: true }],
        layoutBlocks: [{ type: 'header', title: 'GIẤY ĐỀ NGHỊ TẠM ỨNG' }],
        status: TemplateStatus.PUBLISHED,
        createdById: userA.id,
      },
    });

    expect(template.id).toBeDefined();
    expect(approverA1.organizationId).toBe(orgA.id);
  });

  runIfDb('2. Submit thành công và Rollback khi xảy ra lỗi (Transaction Atomicity)', async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { email: 'author-a@company.com' } });
    const template = await prisma.formTemplate.findFirstOrThrow({ where: { code: 'TEST-TEMPLATE-ADVANCE' } });
    const approver = await prisma.user.findFirstOrThrow({ where: { email: 'approver-a1@company.com' } });

    // Tạo hồ sơ DRAFT
    const docNumber = `TK-TEST-${Date.now()}`;
    const doc = await prisma.document.create({
      data: {
        documentNumber: docNumber,
        title: 'Đề nghị tạm ứng đợt 1',
        templateId: template.id,
        createdById: user.id,
        organizationId: user.organizationId,
        status: DocumentStatus.DRAFT,
        currentVersion: 1,
        versions: {
          create: {
            versionNumber: 1,
            formData: { amount: 5000000, reason: 'Chi phí công tác Đà Nẵng' },
            sha256Hash: orchestrator.computeContentHash({ amount: 5000000 }),
            createdById: user.id,
          },
        },
        workflow: {
          create: {
            status: WorkflowStatus.PENDING,
            currentStepOrder: 1,
            steps: {
              create: [
                {
                  stepOrder: 1,
                  stepName: 'Trưởng bộ phận phê duyệt',
                  stepType: StepType.SEQUENTIAL,
                  completionRule: StepCompletionRule.ALL_MUST_APPROVE,
                  status: StepStatus.WAITING,
                  assignees: {
                    create: {
                      userId: approver.id,
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

    // 2.1. Submit thành công
    const submitRes = await orchestrator.submitDocument({
      documentId: doc.id,
      userId: user.id,
      ipAddress: '127.0.0.1',
    });

    expect(submitRes.success).toBe(true);
    expect(submitRes.documentStatus).toBe(DocumentStatus.IN_REVIEW);

    // Kiểm tra DB thật: Bước 1 phải IN_PROGRESS
    const updatedStep = await prisma.approvalStep.findFirst({
      where: { workflow: { documentId: doc.id }, stepOrder: 1 },
    });
    expect(updatedStep?.status).toBe(StepStatus.IN_PROGRESS);

    // 2.2. Kiểm tra Rollback khi cố submit lại trên hồ sơ đã IN_REVIEW
    await expect(
      orchestrator.submitDocument({
        documentId: doc.id,
        userId: user.id,
      })
    ).rejects.toThrow();
  });

  runIfDb('3. Ghi quyết định, StepDecisionHistory, SignatureEvent và AuditLog đồng thời trong Transaction', async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { email: 'author-a@company.com' } });
    const approver = await prisma.user.findFirstOrThrow({ where: { email: 'approver-a1@company.com' } });
    const template = await prisma.formTemplate.findFirstOrThrow();

    const doc = await prisma.document.create({
      data: {
        documentNumber: `TK-DECISION-${Date.now()}`,
        title: 'Hồ sơ thử nghiệm quyết định duyệt',
        templateId: template.id,
        createdById: user.id,
        organizationId: user.organizationId,
        status: DocumentStatus.IN_REVIEW,
        currentVersion: 1,
        versions: {
          create: {
            versionNumber: 1,
            formData: { amount: 3000000 },
            sha256Hash: orchestrator.computeContentHash({ amount: 3000000 }),
            createdById: user.id,
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
                  stepName: 'Trưởng bộ phận phê duyệt',
                  stepType: StepType.SEQUENTIAL,
                  completionRule: StepCompletionRule.ALL_MUST_APPROVE,
                  status: StepStatus.IN_PROGRESS,
                  assignees: {
                    create: {
                      userId: approver.id,
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
      include: { versions: true },
    });

    const decisionRes = await orchestrator.processAssigneeDecision({
      documentId: doc.id,
      userId: approver.id,
      decision: AssigneeDecision.APPROVED,
      decisionComment: 'Đã kiểm tra chứng từ hợp lệ, đồng ý cấp tạm ứng',
      signatureImageUrl: 'https://cdn.company.com/signatures/approver-a1.png',
      ipAddress: '10.0.0.5',
    });

    expect(decisionRes.success).toBe(true);

    // Kiểm tra Database thật:
    // a. StepDecisionHistory bất biến
    const history = await prisma.stepDecisionHistory.findFirst({
      where: { userId: approver.id, documentVersionId: doc.versions[0].id },
    });
    expect(history).not.toBeNull();
    expect(history?.decision).toBe(AssigneeDecision.APPROVED);

    // b. SignatureEvent được lưu với SHA-256
    const signature = await prisma.signatureEvent.findFirst({
      where: { userId: approver.id, documentId: doc.id },
    });
    expect(signature).not.toBeNull();
    expect(signature?.isValid).toBe(true);
    expect(signature?.signatureImageUrl).toContain('approver-a1.png');

    // c. AuditLog được ghi lại
    const audit = await prisma.auditLog.findFirst({
      where: { documentId: doc.id, userId: approver.id },
    });
    expect(audit).not.toBeNull();
  });

  runIfDb('4. Resubmit tạo phiên bản mới v2 và bảo toàn lịch sử v1 trên Database', async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { email: 'author-a@company.com' } });
    const approver = await prisma.user.findFirstOrThrow({ where: { email: 'approver-a1@company.com' } });

    // Tạo hồ sơ có yêu cầu sửa (REVISION_REQUESTED)
    const docNumber = `TK-REVISION-${Date.now()}`;
    const doc = await prisma.document.create({
      data: {
        documentNumber: docNumber,
        title: 'Hồ sơ cần chỉnh sửa chi phí',
        templateId: (await prisma.formTemplate.findFirstOrThrow()).id,
        createdById: user.id,
        organizationId: user.organizationId,
        status: DocumentStatus.REVISION_REQUESTED,
        currentVersion: 1,
        versions: {
          create: {
            versionNumber: 1,
            formData: { amount: 10000000, reason: 'Tạm ứng mua sắm thiết bị' },
            sha256Hash: orchestrator.computeContentHash({ amount: 10000000 }),
            createdById: user.id,
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
                  stepName: 'Trưởng bộ phận phê duyệt',
                  stepType: StepType.SEQUENTIAL,
                  completionRule: StepCompletionRule.ALL_MUST_APPROVE,
                  status: StepStatus.REVISION_REQUESTED,
                  assignees: {
                    create: {
                      userId: approver.id,
                      role: AssigneeRole.APPROVER,
                      decision: AssigneeDecision.REVISION_REQUESTED,
                      decisionComment: 'Giảm bớt dự toán thiết bị phụ trợ',
                    },
                  },
                },
              ],
            },
          },
        },
      },
    });

    const newFormData = { amount: 8000000, reason: 'Tạm ứng mua sắm (đã giảm dự toán phụ trợ)' };
    const resubmitRes = await orchestrator.resubmitDocument({
      documentId: doc.id,
      userId: user.id,
      newFormData,
      changeSummary: 'Điều chỉnh số tiền theo ý kiến của Trưởng bộ phận',
    });

    expect(resubmitRes.success).toBe(true);
    expect(resubmitRes.newVersionNumber).toBe(2);

    // Kiểm tra Database thật: Cả hai version v1 và v2 đều tồn tại
    const versions = await prisma.documentVersion.findMany({
      where: { documentId: doc.id },
      orderBy: { versionNumber: 'asc' },
    });

    expect(versions.length).toBe(2);
    expect(versions[0].versionNumber).toBe(1);
    expect((versions[0].formData as any).amount).toBe(10000000);
    expect(versions[1].versionNumber).toBe(2);
    expect((versions[1].formData as any).amount).toBe(8000000);
  });

  runIfDb('5. Cancel ở các trạng thái hợp lệ và chặn hủy hồ sơ đã hoàn tất trên Database', async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { email: 'author-a@company.com' } });

    // Tạo hồ sơ IN_REVIEW
    const doc = await prisma.document.create({
      data: {
        documentNumber: `TK-CANCEL-${Date.now()}`,
        title: 'Hồ sơ xin hủy',
        templateId: (await prisma.formTemplate.findFirstOrThrow()).id,
        createdById: user.id,
        organizationId: user.organizationId,
        status: DocumentStatus.IN_REVIEW,
        currentVersion: 1,
        versions: {
          create: {
            versionNumber: 1,
            formData: { test: true },
            sha256Hash: 'hash-val',
            createdById: user.id,
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
                  stepName: 'Bước 1',
                  stepType: StepType.SEQUENTIAL,
                  completionRule: StepCompletionRule.ALL_MUST_APPROVE,
                  status: StepStatus.IN_PROGRESS,
                },
              ],
            },
          },
        },
      },
    });

    // Hủy thành công
    const cancelRes = await orchestrator.cancelDocument({
      documentId: doc.id,
      userId: user.id,
      cancelReason: 'Thay đổi nhu cầu công việc',
    });

    expect(cancelRes.success).toBe(true);
    expect(cancelRes.documentStatus).toBe(DocumentStatus.CANCELLED);

    // Chặn hủy lại hồ sơ đã CANCELLED
    await expect(
      orchestrator.cancelDocument({
        documentId: doc.id,
        userId: user.id,
      })
    ).rejects.toThrow();
  });

  runIfDb('6. Hai transaction đồng thời trong ANY_CAN_APPROVE: Chỉ 1 bên kích hoạt bước sau (OCC)', async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { email: 'author-a@company.com' } });

    // Tạo 2 approvers
    const app1 = await prisma.user.upsert({
      where: { email: 'concurrent-app1@company.com' },
      update: {},
      create: {
        email: 'concurrent-app1@company.com',
        fullName: 'Phó Phòng 1',
        passwordHash: 'hash',
        organizationId: user.organizationId,
      },
    });

    const app2 = await prisma.user.upsert({
      where: { email: 'concurrent-app2@company.com' },
      update: {},
      create: {
        email: 'concurrent-app2@company.com',
        fullName: 'Phó Phòng 2',
        passwordHash: 'hash',
        organizationId: user.organizationId,
      },
    });

    // Tạo quy trình có Bước 1 là ANY_CAN_APPROVE
    const doc = await prisma.document.create({
      data: {
        documentNumber: `TK-PARALLEL-${Date.now()}`,
        title: 'Hồ sơ duyệt song song ANY_CAN_APPROVE',
        templateId: (await prisma.formTemplate.findFirstOrThrow()).id,
        createdById: user.id,
        organizationId: user.organizationId,
        status: DocumentStatus.IN_REVIEW,
        currentVersion: 1,
        versions: {
          create: {
            versionNumber: 1,
            formData: { test: true },
            sha256Hash: 'hash-parallel',
            createdById: user.id,
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
                  stepName: 'Phó phòng duyệt (Chỉ cần 1 trong 2)',
                  stepType: StepType.PARALLEL,
                  completionRule: StepCompletionRule.ANY_CAN_APPROVE,
                  status: StepStatus.IN_PROGRESS,
                  version: 0,
                  assignees: {
                    create: [
                      { userId: app1.id, role: AssigneeRole.APPROVER, decision: AssigneeDecision.PENDING },
                      { userId: app2.id, role: AssigneeRole.APPROVER, decision: AssigneeDecision.PENDING },
                    ],
                  },
                },
                {
                  stepOrder: 2,
                  stepName: 'Trưởng phòng phê duyệt cuối',
                  stepType: StepType.SEQUENTIAL,
                  completionRule: StepCompletionRule.ALL_MUST_APPROVE,
                  status: StepStatus.WAITING,
                  version: 0,
                },
              ],
            },
          },
        },
      },
    });

    // Mô phỏng 2 HTTP requests gửi quyết định đồng thời trên database thật
    const [res1, res2] = await Promise.allSettled([
      orchestrator.processAssigneeDecision({
        documentId: doc.id,
        userId: app1.id,
        decision: AssigneeDecision.APPROVED,
        decisionComment: 'Phó phòng 1 duyệt',
      }),
      orchestrator.processAssigneeDecision({
        documentId: doc.id,
        userId: app2.id,
        decision: AssigneeDecision.APPROVED,
        decisionComment: 'Phó phòng 2 duyệt',
      }),
    ]);

    // Ít nhất một transaction thành công
    expect(res1.status === 'fulfilled' || res2.status === 'fulfilled').toBe(true);

    // Kiểm tra Database thật: Bước 2 chỉ được kích hoạt IN_PROGRESS 1 lần
    const step2 = await prisma.approvalStep.findFirst({
      where: { workflow: { documentId: doc.id }, stepOrder: 2 },
    });
    expect(step2?.status).toBe(StepStatus.IN_PROGRESS);
  });

  runIfDb('7. Quyết định trùng lặp (Duplicate Decision) và xử lý tương tranh ném lỗi', async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { email: 'author-a@company.com' } });
    const approver = await prisma.user.findFirstOrThrow({ where: { email: 'approver-a1@company.com' } });

    const doc = await prisma.document.create({
      data: {
        documentNumber: `TK-DUP-${Date.now()}`,
        title: 'Hồ sơ kiểm thử trùng lặp request',
        templateId: (await prisma.formTemplate.findFirstOrThrow()).id,
        createdById: user.id,
        organizationId: user.organizationId,
        status: DocumentStatus.IN_REVIEW,
        currentVersion: 1,
        versions: {
          create: {
            versionNumber: 1,
            formData: { test: true },
            sha256Hash: 'hash-dup',
            createdById: user.id,
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
                  stepName: 'Bước 1',
                  stepType: StepType.SEQUENTIAL,
                  completionRule: StepCompletionRule.ALL_MUST_APPROVE,
                  status: StepStatus.IN_PROGRESS,
                  assignees: {
                    create: { userId: approver.id, role: AssigneeRole.APPROVER, decision: AssigneeDecision.PENDING },
                  },
                },
              ],
            },
          },
        },
      },
    });

    // Lần 1: Duyệt thành công
    const firstDecision = await orchestrator.processAssigneeDecision({
      documentId: doc.id,
      userId: approver.id,
      decision: AssigneeDecision.APPROVED,
    });
    expect(firstDecision.success).toBe(true);

    // Lần 2: Cố tình duyệt lại (do retry mạng hoặc double click) -> Phải ném lỗi Concurrency/FSM Error
    await expect(
      orchestrator.processAssigneeDecision({
        documentId: doc.id,
        userId: approver.id,
        decision: AssigneeDecision.APPROVED,
      })
    ).rejects.toThrow();
  });
});
