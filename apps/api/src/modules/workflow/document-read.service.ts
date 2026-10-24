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
      const now = new Date();
      // Tìm các delegatorId mà user.id đang được ủy quyền hợp lệ
      const activeDelegations =
        typeof (this.prisma as any).delegationPolicy?.findMany === 'function'
          ? await (this.prisma as any).delegationPolicy.findMany({
              where: {
                delegateeId: user.id,
                isActive: true,
                startDate: { lte: now },
                endDate: { gte: now },
                ...(user.organizationId ? { organizationId: user.organizationId } : {}),
              },
              select: { delegatorId: true },
            })
          : [];
      const validDelegatorIds = activeDelegations.map((d: any) => d.delegatorId);
      const eligibleAssigneeFilter =
        validDelegatorIds.length > 0
          ? { in: [user.id, ...validDelegatorIds] }
          : user.id;

      where.status = DocumentStatus.IN_REVIEW;
      where.workflow = {
        status: WorkflowStatus.RUNNING,
        steps: {
          some: {
            status: StepStatus.IN_PROGRESS,
            assignees: {
              some: {
                userId: eligibleAssigneeFilter,
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

      const docDueDate = doc.dueDate instanceof Date ? doc.dueDate.toISOString() : doc.dueDate ?? null;
      const isDocOverdue =
        (doc.status === DocumentStatus.IN_REVIEW || doc.status === DocumentStatus.SUBMITTED) &&
        doc.dueDate
          ? new Date() > new Date(doc.dueDate)
          : false;

      let slaStatus: 'ON_TRACK' | 'NEAR_DUE' | 'OVERDUE' | null = null;
      if (doc.dueDate && (doc.status === DocumentStatus.IN_REVIEW || doc.status === DocumentStatus.SUBMITTED)) {
        const diffHours = (new Date(doc.dueDate).getTime() - Date.now()) / (1000 * 3600);
        if (diffHours < 0) {
          slaStatus = 'OVERDUE';
        } else if (diffHours <= 24) {
          slaStatus = 'NEAR_DUE';
        } else {
          slaStatus = 'ON_TRACK';
        }
      }

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
        dueDate: docDueDate,
        isOverdue: isDocOverdue,
        slaStatus,
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
    const [decisionHistories, reassignmentHistories] = await Promise.all([
      this.prisma.stepDecisionHistory.findMany({
        where: {
          documentVersion: { documentId: id },
        },
        include: {
          step: { select: { stepOrder: true, stepName: true } },
          user: { select: { id: true, fullName: true } },
          delegatedFromUser: { select: { id: true, fullName: true } },
        },
        orderBy: { decidedAt: 'asc' },
      }),
      typeof (this.prisma as any).stepReassignmentHistory?.findMany === 'function'
        ? this.prisma.stepReassignmentHistory.findMany({
            where: {
              step: { workflow: { documentId: id } },
            },
            include: {
              step: { select: { stepOrder: true, stepName: true } },
              oldUser: { select: { id: true, fullName: true, email: true } },
              newUser: { select: { id: true, fullName: true, email: true } },
              reassignedByUser: { select: { id: true, fullName: true, email: true } },
            },
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve([]),
    ]);

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

    // Kiểm tra quyền duyệt ủy quyền (Delegation Policy Resolution)
    let isDelegateeCanApprove = false;
    let delegatedFromUserName: string | undefined = undefined;

    if (
      !canApprove &&
      (doc.status as unknown as DocumentStatus) === DocumentStatus.IN_REVIEW &&
      currentStep?.status === StepStatus.IN_PROGRESS
    ) {
      const pendingApproverIds = (currentStep.assignees || [])
        .filter(
          (a: any) =>
            (a.role as unknown as AssigneeRole) === AssigneeRole.APPROVER &&
            (a.decision as unknown as AssigneeDecision) === AssigneeDecision.PENDING
        )
        .map((a: any) => a.userId);

      if (pendingApproverIds.length > 0) {
        const now = new Date();
        const activePolicy =
          typeof (this.prisma as any).delegationPolicy?.findFirst === 'function'
            ? await (this.prisma as any).delegationPolicy.findFirst({
                where: {
                  delegatorId: { in: pendingApproverIds },
                  delegateeId: user.id,
                  isActive: true,
                  startDate: { lte: now },
                  endDate: { gte: now },
                  ...(doc.organizationId ? { organizationId: doc.organizationId } : {}),
                  delegatee: { isActive: true },
                  delegator: { isActive: true },
                  AND: [
                    {
                      OR: [
                        { scopeTemplateId: null },
                        { scopeTemplateId: doc.templateId },
                      ],
                    },
                    {
                      OR: [
                        { scopeDepartmentId: null },
                        { scopeDepartmentId: doc.departmentId },
                      ],
                    },
                  ],
                },
                include: {
                  delegator: { select: { fullName: true } },
                },
              })
            : null;

        if (activePolicy) {
          isDelegateeCanApprove = true;
          delegatedFromUserName = activePolicy.delegator.fullName;
        }
      }
    }

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

    const canReassign =
      [
        DocumentStatus.SUBMITTED,
        DocumentStatus.IN_REVIEW,
      ].includes(doc.status as unknown as DocumentStatus) &&
      currentStep?.status === StepStatus.IN_PROGRESS &&
      (isAdmin ||
        (currentAssignee?.role === AssigneeRole.APPROVER &&
          currentAssignee?.decision === AssigneeDecision.PENDING));

    // 3. Map steps & assignees
    const steps = (doc.workflow?.steps || []).map((step: any) => {
      const isStepOverdue =
        step.status === StepStatus.IN_PROGRESS &&
        step.dueDate &&
        new Date() > new Date(step.dueDate);

      return {
        id: step.id,
        stepOrder: step.stepOrder,
        stepName: step.stepName,
        stepType: step.stepType,
        completionRule: step.completionRule,
        status: step.status,
        dueDate:
          step.dueDate instanceof Date
            ? step.dueDate.toISOString()
            : step.dueDate ?? null,
        dueDays: step.dueDays ?? null,
        isOverdue: Boolean(isStepOverdue),
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
      };
    });

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
      isDelegated: Boolean(h.isDelegated),
      delegatedFromUserId: h.delegatedFromUserId ?? undefined,
      delegatedFromUserName: h.delegatedFromUser?.fullName ?? undefined,
      delegationPolicyId: h.delegationPolicyId ?? undefined,
    }));

    // 5. Map reassignment histories
    const mappedReassignments = (reassignmentHistories || []).map((r: any) => ({
      id: r.id,
      stepId: r.stepId,
      stepOrder: r.step?.stepOrder,
      stepName: r.step?.stepName,
      oldUserId: r.oldUserId,
      oldUserName: r.oldUser?.fullName ?? '',
      newUserId: r.newUserId,
      newUserName: r.newUser?.fullName ?? '',
      reassignedById: r.reassignedById,
      reassignedByName: r.reassignedByUser?.fullName ?? '',
      reason: r.reason,
      createdAt:
        r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    }));

    // 6. Map signature events (chữ ký số thực tế từ DB)
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

    const docDueDate = doc.dueDate instanceof Date ? doc.dueDate.toISOString() : doc.dueDate ?? null;
    const isDocOverdue =
      (doc.status === DocumentStatus.IN_REVIEW || doc.status === DocumentStatus.SUBMITTED) &&
      doc.dueDate
        ? new Date() > new Date(doc.dueDate)
        : false;

    let slaStatus: 'ON_TRACK' | 'NEAR_DUE' | 'OVERDUE' | null = null;
    if (doc.dueDate && (doc.status === DocumentStatus.IN_REVIEW || doc.status === DocumentStatus.SUBMITTED)) {
      const diffHours = (new Date(doc.dueDate).getTime() - Date.now()) / (1000 * 3600);
      if (diffHours < 0) {
        slaStatus = 'OVERDUE';
      } else if (diffHours <= 24) {
        slaStatus = 'NEAR_DUE';
      } else {
        slaStatus = 'ON_TRACK';
      }
    }

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
      dueDate: docDueDate,
      isOverdue: isDocOverdue,
      slaStatus,
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
      reassignmentHistories: mappedReassignments,
      signatures,
      permissions: {
        canApprove: Boolean(canApprove || isDelegateeCanApprove),
        canResubmit: Boolean(canResubmit),
        canCancel: Boolean(canCancel),
        canReassign: Boolean(canReassign),
        isCreator,
        isAdmin,
        currentStepAssigneeRole: currentAssignee?.role as unknown as AssigneeRole | undefined,
        isDelegatedApproval: Boolean(isDelegateeCanApprove),
        delegatedFromUserName,
      },
    };
  }
}
