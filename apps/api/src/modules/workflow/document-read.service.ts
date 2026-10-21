import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssigneeDecision,
  AssigneeRole,
  DocumentStatus,
  StepStatus,
  UrgencyLevel,
  UserRole,
  WorkflowStatus,
} from '@trinh-ky/shared';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { UserPrincipal } from '../../common/interfaces/user-principal.interface.js';
import { GetDocumentsQueryDto } from './dto/get-documents-query.dto.js';
import {
  DocumentDetailDto,
  DocumentListItemDto,
  PaginatedDocumentsDto,
} from './dto/document-response.dto.js';

@Injectable()
export class DocumentReadService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lấy danh sách hồ sơ trình ký có phân trang, lọc và bảo vệ ranh giới tổ chức
   */
  async getDocuments(
    user: UserPrincipal,
    query: GetDocumentsQueryDto
  ): Promise<PaginatedDocumentsDto> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));
    const skip = (page - 1) * limit;

    const where: any = {};

    // 1. Phân quyền ranh giới tổ chức tại cấp database (Multi-Company Boundary):
    // SUPER_ADMIN có quyền toàn hệ thống (mọi công ty con).
    // USER và ADMIN bắt buộc bị giới hạn trong organizationId của mình.
    if (user.role !== UserRole.SUPER_ADMIN) {
      where.organizationId = user.organizationId;
    }

    // 2. Chế độ danh sách (Tab Mode)
    if (query.tab === 'pending_my_approval') {
      where.status = DocumentStatus.IN_REVIEW;
      where.workflow = {
        status: WorkflowStatus.RUNNING,
        steps: {
          some: {
            status: StepStatus.IN_PROGRESS,
            assignees: {
              some: {
                userId: user.id,
                role: AssigneeRole.APPROVER,
                decision: AssigneeDecision.PENDING,
              },
            },
          },
        },
      };
    } else if (query.tab === 'my_documents') {
      where.createdById = user.id;
    }

    // 3. Lọc theo trạng thái cụ thể (nếu có)
    if (query.status) {
      where.status = query.status;
    }

    // 4. Tìm kiếm theo tiêu đề hoặc mã hồ sơ (nếu có)
    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        {
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { documentNumber: { contains: term, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const [total, documents] = await Promise.all([
      this.prisma.document.count({ where }),
      this.prisma.document.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          template: { select: { code: true, title: true } },
          createdBy: { select: { id: true, fullName: true, email: true } },
          organization: { select: { id: true, name: true, code: true } },
          department: { select: { id: true, name: true, code: true } },
          workflow: {
            select: {
              id: true,
              status: true,
              currentStepOrder: true,
              steps: {
                select: {
                  id: true,
                  stepOrder: true,
                  stepName: true,
                  status: true,
                },
                orderBy: { stepOrder: 'asc' },
              },
            },
          },
        },
      }),
    ]);

    const items: DocumentListItemDto[] = documents.map((doc: any) => {
      const currentStep = doc.workflow?.steps?.find(
        (s: any) => s.stepOrder === doc.currentStepOrder
      );
      return {
        id: doc.id,
        documentNumber: doc.documentNumber,
        title: doc.title,
        templateCode: doc.template?.code ?? '',
        templateTitle: doc.template?.title ?? '',
        status: doc.status as unknown as DocumentStatus,
        urgency: doc.urgency as unknown as UrgencyLevel,
        createdById: doc.createdById,
        createdByName: doc.createdBy?.fullName ?? '',
        organizationId: doc.organizationId,
        organizationName: doc.organization?.name ?? undefined,
        departmentName: doc.department?.name ?? undefined,
        currentStepOrder: doc.currentStepOrder,
        totalSteps: doc.workflow?.steps?.length ?? 0,
        currentStepName: currentStep?.stepName ?? '',
        createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
        updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt,
      };
    });

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Lấy chi tiết hồ sơ trình ký kèm theo phiên bản, quy trình, lịch sử và chữ ký số
   */
  async getDocumentDetail(
    id: string,
    user: UserPrincipal
  ): Promise<DocumentDetailDto> {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      include: {
        template: { select: { code: true, title: true } },
        createdBy: { select: { id: true, fullName: true, email: true } },
        organization: { select: { id: true, name: true, code: true } },
        department: { select: { id: true, name: true, code: true } },
        versions: {
          orderBy: { versionNumber: 'desc' },
        },
        workflow: {
          include: {
            steps: {
              orderBy: { stepOrder: 'asc' },
              include: {
                assignees: {
                  include: {
                    user: { select: { id: true, fullName: true, email: true } },
                  },
                },
              },
            },
          },
        },
        signatureEvents: {
          include: {
            user: { select: { id: true, fullName: true, email: true } },
          },
          orderBy: { signedAt: 'asc' },
        },
      },
    });

    if (!doc) {
      throw new NotFoundException(`Không tìm thấy hồ sơ với id: ${id}`);
    }

    // Kiểm tra ranh giới tổ chức (Multi-Company Boundary)
    if (
      user.role !== UserRole.SUPER_ADMIN &&
      user.organizationId &&
      doc.organizationId &&
      user.organizationId !== doc.organizationId
    ) {
      throw new ForbiddenException(
        'Bạn không có quyền truy cập hồ sơ thuộc công ty/tổ chức khác.'
      );
    }

    // Truy vấn lịch sử quyết định liên quan đến các version của document này
    const decisionHistories = await this.prisma.stepDecisionHistory.findMany({
      where: {
        documentVersion: { documentId: id },
      },
      include: {
        step: { select: { stepOrder: true, stepName: true } },
        user: { select: { id: true, fullName: true } },
      },
      orderBy: { decidedAt: 'asc' },
    });

    // 1. Xác định phiên bản active
    const activeVersionRaw =
      doc.versions.find((v: any) => v.versionNumber === doc.currentVersion) ||
      doc.versions[0];

    const activeVersion = activeVersionRaw
      ? {
          id: activeVersionRaw.id,
          versionNumber: activeVersionRaw.versionNumber,
          formData:
            typeof activeVersionRaw.formData === 'string'
              ? JSON.parse(activeVersionRaw.formData)
              : activeVersionRaw.formData ?? {},
          sha256Hash: activeVersionRaw.sha256Hash,
          changeSummary: activeVersionRaw.changeSummary,
          createdAt:
            activeVersionRaw.createdAt instanceof Date
              ? activeVersionRaw.createdAt.toISOString()
              : activeVersionRaw.createdAt,
        }
      : {
          id: 'v1',
          versionNumber: 1,
          formData: {},
          sha256Hash: '',
          changeSummary: null,
          createdAt: new Date().toISOString(),
        };

    const versions = (doc.versions || []).map((v: any) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      formData:
        typeof v.formData === 'string' ? JSON.parse(v.formData) : v.formData ?? {},
      sha256Hash: v.sha256Hash,
      changeSummary: v.changeSummary,
      createdAt: v.createdAt instanceof Date ? v.createdAt.toISOString() : v.createdAt,
    }));

    // 2. Tính toán quyền hạn (Permissions calculation)
    const isCreator = doc.createdById === user.id;
    const isSuperAdmin = user.role === UserRole.SUPER_ADMIN;
    const isCompanyAdmin =
      user.role === UserRole.ADMIN &&
      (!doc.organizationId || user.organizationId === doc.organizationId);
    const isAdmin = isSuperAdmin || isCompanyAdmin;

    const currentStep = doc.workflow?.steps?.find(
      (s: any) => s.stepOrder === doc.currentStepOrder
    );
    const currentAssignee = currentStep?.assignees?.find(
      (a: any) => a.userId === user.id
    );

    const canApprove =
      (doc.status as unknown as DocumentStatus) === DocumentStatus.IN_REVIEW &&
      currentStep?.status === StepStatus.IN_PROGRESS &&
      (currentAssignee?.role as unknown as AssigneeRole) === AssigneeRole.APPROVER &&
      (currentAssignee?.decision as unknown as AssigneeDecision) === AssigneeDecision.PENDING;

    const canResubmit =
      (doc.status as unknown as DocumentStatus) === DocumentStatus.REVISION_REQUESTED &&
      (isCreator || isAdmin);

    const canCancel =
      [
        DocumentStatus.DRAFT,
        DocumentStatus.SUBMITTED,
        DocumentStatus.IN_REVIEW,
        DocumentStatus.REVISION_REQUESTED,
      ].includes(doc.status as unknown as DocumentStatus) &&
      (isCreator || isAdmin);

    // 3. Map steps & assignees
    const steps = (doc.workflow?.steps || []).map((step: any) => ({
      id: step.id,
      stepOrder: step.stepOrder,
      stepName: step.stepName,
      stepType: step.stepType,
      completionRule: step.completionRule,
      status: step.status,
      assignees: (step.assignees || []).map((asg: any) => ({
        id: asg.id,
        userId: asg.userId,
        userName: asg.user?.fullName ?? '',
        userEmail: asg.user?.email ?? '',
        role: asg.role as unknown as AssigneeRole,
        decision: asg.decision as unknown as AssigneeDecision,
        decisionComment: asg.decisionComment ?? undefined,
        decidedAt:
          asg.decidedAt instanceof Date
            ? asg.decidedAt.toISOString()
            : asg.decidedAt ?? undefined,
      })),
    }));

    // 4. Map decision histories
    const mappedDecisionHistories = (decisionHistories || []).map((h: any) => ({
      id: h.id,
      stepOrder: h.step?.stepOrder ?? 1,
      stepName: h.step?.stepName ?? '',
      userId: h.userId,
      userName: h.user?.fullName ?? '',
      role: h.role as unknown as AssigneeRole,
      decision: h.decision as unknown as AssigneeDecision,
      decisionComment: h.decisionComment ?? undefined,
      decidedAt:
        h.decidedAt instanceof Date ? h.decidedAt.toISOString() : h.decidedAt,
    }));

    // 5. Map signature events (chữ ký số thực tế từ DB)
    const signatures = (doc.signatureEvents || []).map((sig: any) => ({
      id: sig.id,
      userId: sig.userId,
      userName: sig.user?.fullName ?? '',
      signatureImageUrl: sig.signatureImageUrl,
      signedAt:
        sig.signedAt instanceof Date ? sig.signedAt.toISOString() : sig.signedAt,
      isValid: Boolean(sig.isValid),
      contentHash: sig.contentHash,
    }));

    return {
      id: doc.id,
      documentNumber: doc.documentNumber,
      title: doc.title,
      templateCode: doc.template?.code ?? '',
      templateTitle: doc.template?.title ?? '',
      status: doc.status as unknown as DocumentStatus,
      urgency: doc.urgency as unknown as UrgencyLevel,
      createdById: doc.createdById,
      createdByName: doc.createdBy?.fullName ?? '',
      organizationId: doc.organizationId,
      organizationName: doc.organization?.name ?? undefined,
      departmentName: doc.department?.name ?? undefined,
      currentStepOrder: doc.currentStepOrder,
      totalSteps: steps.length,
      currentStepName: currentStep?.stepName ?? '',
      createdAt:
        doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
      updatedAt:
        doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt,
      currentVersion: doc.currentVersion,
      activeVersion,
      versions,
      workflow: {
        id: doc.workflow?.id ?? '',
        status: (doc.workflow?.status as unknown as WorkflowStatus) ?? WorkflowStatus.PENDING,
        currentStepOrder: doc.workflow?.currentStepOrder ?? 1,
        steps,
      },
      decisionHistories: mappedDecisionHistories,
      signatures,
      permissions: {
        canApprove: Boolean(canApprove),
        canResubmit: Boolean(canResubmit),
        canCancel: Boolean(canCancel),
        isCreator,
        isAdmin,
        currentStepAssigneeRole: currentAssignee?.role as unknown as AssigneeRole | undefined,
      },
    };
  }
}
