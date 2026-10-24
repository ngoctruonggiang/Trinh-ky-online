import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { NotificationService } from '../notification/notification.service.js';
import {
  AuditAction,
  NotificationType,
  UserRole,
  CreateDelegationPolicyDto,
  UpdateDelegationPolicyDto,
  DelegationPolicyView,
  AssigneeRole,
  AssigneeDecision,
} from '@trinh-ky/shared';

export interface ResolveDelegationParams {
  document: {
    id: string;
    organizationId?: string | null;
    departmentId?: string | null;
    templateId?: string | null;
    title?: string;
  };
  step: {
    id: string;
    stepName: string;
    assignees: Array<{
      id: string;
      userId: string;
      role: AssigneeRole;
      decision: AssigneeDecision;
      user?: {
        id: string;
        fullName: string;
        email: string;
        isActive: boolean;
      };
    }>;
  };
  actorId: string;
  now?: Date;
}

export interface ResolvedDelegationResult {
  policy: {
    id: string;
    delegatorId: string;
    delegateeId: string;
    organizationId: string;
  };
  assignee: {
    id: string;
    userId: string;
    role: AssigneeRole;
    decision: AssigneeDecision;
    user?: any;
  };
  delegatorName: string;
}

@Injectable()
export class DelegationService {
  private readonly logger = new Logger(DelegationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService
  ) {}

  /**
   * Tạo chính sách ủy quyền mới với thuật toán phát hiện chu trình (Loop Detection)
   */
  async createPolicy(
    actorId: string,
    actorRole: string,
    actorOrgId: string | null,
    dto: CreateDelegationPolicyDto
  ): Promise<DelegationPolicyView> {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new BadRequestException('Thời gian bắt đầu hoặc kết thúc không hợp lệ.');
    }

    if (startDate >= endDate) {
      throw new BadRequestException('Thời gian bắt đầu (startDate) phải trước thời gian kết thúc (endDate).');
    }

    // Xác định delegatorId
    let delegatorId = actorId;
    if (dto.delegatorId && dto.delegatorId !== actorId) {
      if (actorRole !== 'SUPER_ADMIN' && actorRole !== 'ADMIN') {
        throw new ForbiddenException('Chỉ quản trị viên mới có quyền thiết lập ủy quyền thay mặt cho người khác.');
      }
      delegatorId = dto.delegatorId;
    }

    const delegateeId = dto.delegateeId;

    // 1. Chặn tự ủy quyền cho chính mình (Self-delegation)
    if (delegatorId === delegateeId) {
      throw new BadRequestException('Không được phép tự ủy quyền cho chính mình.');
    }

    // 2. Tải thông tin người ủy quyền và người nhận ủy quyền
    const [delegator, delegatee] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: delegatorId },
        include: { organization: true },
      }),
      this.prisma.user.findUnique({
        where: { id: delegateeId },
        include: { organization: true },
      }),
    ]);

    if (!delegator) {
      throw new NotFoundException(`Không tìm thấy người ủy quyền với id: ${delegatorId}`);
    }

    if (!delegatee) {
      throw new NotFoundException(`Không tìm thấy người nhận ủy quyền với id: ${delegateeId}`);
    }

    if (!delegator.isActive) {
      throw new BadRequestException(`Tài khoản người ủy quyền "${delegator.fullName}" đang bị vô hiệu hóa.`);
    }

    if (!delegatee.isActive) {
      throw new BadRequestException(`Tài khoản người nhận ủy quyền "${delegatee.fullName}" đang bị vô hiệu hóa.`);
    }

    // 3. Kiểm tra ranh giới tổ chức (Tenant Isolation)
    if (!delegator.organizationId || !delegatee.organizationId) {
      throw new BadRequestException('Cả người ủy quyền và người nhận ủy quyền phải thuộc một tổ chức xác định.');
    }

    if (delegator.organizationId !== delegatee.organizationId) {
      throw new BadRequestException(
        'Không được phép ủy quyền vượt qua ranh giới tổ chức (Tenant Isolation violation).'
      );
    }

    const organizationId = delegator.organizationId;

    // Kiểm tra quyền của Admin đối với organizationId
    if (actorRole === 'ADMIN' && actorOrgId && actorOrgId !== organizationId) {
      throw new ForbiddenException('Quản trị viên chỉ được quản lý chính sách trong tổ chức của mình.');
    }

    // 4. Kiểm tra phạm vi (Scope validation)
    if (dto.scopeDepartmentId) {
      const dept = await this.prisma.department.findUnique({
        where: { id: dto.scopeDepartmentId },
      });
      if (!dept || dept.organizationId !== organizationId) {
        throw new BadRequestException('Phòng ban trong phạm vi ủy quyền không tồn tại hoặc không thuộc tổ chức này.');
      }
    }

    if (dto.scopeTemplateId) {
      const template = await this.prisma.formTemplate.findUnique({
        where: { id: dto.scopeTemplateId },
      });
      if (
        !template ||
        (template.organizationId && template.organizationId !== organizationId)
      ) {
        throw new BadRequestException(
          'Biểu mẫu trong phạm vi ủy quyền không tồn tại hoặc không thuộc quyền quản lý của tổ chức.'
        );
      }
    }

    // 5. Thuật toán phát hiện chu trình ủy quyền (Cycle & Loop Detection)
    // Tải toàn bộ các chính sách đang hoạt động có khoảng thời gian giao thoa
    const overlappingPolicies = await this.prisma.delegationPolicy.findMany({
      where: {
        organizationId,
        isActive: true,
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
      select: {
        id: true,
        delegatorId: true,
        delegateeId: true,
        scopeDepartmentId: true,
        scopeTemplateId: true,
      },
    });

    // 5.1. Chặn chính sách trùng phạm vi tuyệt đối cho cùng 1 delegator trong thời gian giao thoa
    const exactDuplicate = overlappingPolicies.find(
      (p) =>
        p.delegatorId === delegatorId &&
        (p.scopeDepartmentId ?? null) === (dto.scopeDepartmentId ?? null) &&
        (p.scopeTemplateId ?? null) === (dto.scopeTemplateId ?? null)
    );

    if (exactDuplicate) {
      throw new BadRequestException(
        'Đã tồn tại chính sách ủy quyền có phạm vi trùng lặp trong khoảng thời gian này.'
      );
    }

    // 5.2. Kiểm tra chu trình có hướng (Directed Cycle Detection using DFS)
    // Xây dựng đồ thị có hướng: X -> Y có nghĩa là X ủy quyền cho Y
    const adjList = new Map<string, string[]>();
    for (const p of overlappingPolicies) {
      if (!adjList.has(p.delegatorId)) {
        adjList.set(p.delegatorId, []);
      }
      adjList.get(p.delegatorId)!.push(p.delegateeId);
    }

    // Thêm cạnh đề xuất mới: delegatorId -> delegateeId
    if (!adjList.has(delegatorId)) {
      adjList.set(delegatorId, []);
    }
    adjList.get(delegatorId)!.push(delegateeId);

    // Chạy DFS từ delegateeId xem có thể đi ngược về delegatorId không
    const hasPath = (current: string, target: string, visited: Set<string>): boolean => {
      if (current === target) return true;
      visited.add(current);
      const neighbors = adjList.get(current) || [];
      for (const next of neighbors) {
        if (!visited.has(next)) {
          if (hasPath(next, target, visited)) return true;
        }
      }
      return false;
    };

    if (hasPath(delegateeId, delegatorId, new Set<string>())) {
      throw new BadRequestException(
        `Phát hiện chu trình ủy quyền khép kín (Delegation Cycle): Người nhận ủy quyền "${delegatee.fullName}" đã ủy quyền trực tiếp hoặc gián tiếp ngược lại cho "${delegator.fullName}". Không thể tạo chính sách.`
      );
    }

    // 6. Lưu vào Cơ sở dữ liệu
    const policy = await this.prisma.delegationPolicy.create({
      data: {
        organizationId,
        delegatorId,
        delegateeId,
        startDate,
        endDate,
        scopeDepartmentId: dto.scopeDepartmentId || null,
        scopeTemplateId: dto.scopeTemplateId || null,
        reason: dto.reason?.trim() || null,
        createdById: actorId,
        isActive: true,
      },
      include: {
        delegator: { select: { fullName: true, email: true } },
        delegatee: { select: { fullName: true, email: true } },
        createdBy: { select: { fullName: true } },
        scopeDepartment: { select: { name: true } },
        scopeTemplate: { select: { title: true } },
      },
    });

    // 7. Ghi AuditLog
    await this.prisma.auditLog.create({
      data: {
        userId: actorId,
        action: AuditAction.CREATE_DELEGATION_POLICY,
        details: {
          policyId: policy.id,
          delegatorId,
          delegatorName: delegator.fullName,
          delegateeId,
          delegateeName: delegatee.fullName,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          scopeDepartmentId: dto.scopeDepartmentId,
          scopeTemplateId: dto.scopeTemplateId,
          reason: dto.reason,
        },
      },
    });

    // 8. Gửi In-App Notification cho người nhận ủy quyền
    await this.notificationService.createNotification({
      userId: delegateeId,
      type: NotificationType.DELEGATION_ASSIGNED,
      title: 'Bạn nhận được quyền ủy quyền phê duyệt',
      content: `Cán bộ ${delegator.fullName} đã ủy quyền phê duyệt cho bạn từ ngày ${startDate.toLocaleDateString('vi-VN')} đến ngày ${endDate.toLocaleDateString('vi-VN')}.`,
      idempotencyKey: `DELEGATION_ASSIGNED:${policy.id}:${delegateeId}`,
      metadata: {
        policyId: policy.id,
        delegatorId,
        delegatorName: delegator.fullName,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
    });

    return this.mapToView(policy);
  }

  /**
   * Lấy danh sách chính sách ủy quyền theo phân quyền
   */
  async getPolicies(
    actorId: string,
    actorRole: string,
    actorOrgId: string | null,
    query: {
      isActive?: boolean;
      role?: 'delegator' | 'delegatee' | 'all';
      page?: number;
      limit?: number;
    }
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = {};

    // Phân quyền theo vai trò (RBAC)
    if (actorRole === 'USER') {
      if (query.role === 'delegator') {
        where.delegatorId = actorId;
      } else if (query.role === 'delegatee') {
        where.delegateeId = actorId;
      } else {
        where.OR = [{ delegatorId: actorId }, { delegateeId: actorId }];
      }
    } else if (actorRole === 'ADMIN') {
      where.organizationId = actorOrgId;
      if (query.role === 'delegator') {
        where.delegatorId = actorId;
      } else if (query.role === 'delegatee') {
        where.delegateeId = actorId;
      }
    } else if (actorRole === 'SUPER_ADMIN') {
      if (actorOrgId) {
        where.organizationId = actorOrgId;
      }
    }

    if (typeof query.isActive === 'boolean') {
      where.isActive = query.isActive;
    }

    const [total, policies] = await Promise.all([
      this.prisma.delegationPolicy.count({ where }),
      this.prisma.delegationPolicy.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          delegator: { select: { fullName: true, email: true } },
          delegatee: { select: { fullName: true, email: true } },
          createdBy: { select: { fullName: true } },
          scopeDepartment: { select: { name: true } },
          scopeTemplate: { select: { title: true } },
        },
      }),
    ]);

    return {
      items: policies.map((p) => this.mapToView(p)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Lấy chi tiết một chính sách ủy quyền
   */
  async getPolicyById(
    policyId: string,
    actorId: string,
    actorRole: string,
    actorOrgId: string | null
  ): Promise<DelegationPolicyView> {
    const policy = await this.prisma.delegationPolicy.findUnique({
      where: { id: policyId },
      include: {
        delegator: { select: { fullName: true, email: true } },
        delegatee: { select: { fullName: true, email: true } },
        createdBy: { select: { fullName: true } },
        scopeDepartment: { select: { name: true } },
        scopeTemplate: { select: { title: true } },
      },
    });

    if (!policy) {
      throw new NotFoundException('Không tìm thấy chính sách ủy quyền.');
    }

    // Kiểm tra quyền đọc
    const isDelegator = policy.delegatorId === actorId;
    const isDelegatee = policy.delegateeId === actorId;
    const isOrgAdmin =
      actorRole === 'ADMIN' && policy.organizationId === actorOrgId;
    const isSuperAdmin = actorRole === 'SUPER_ADMIN';

    if (!isDelegator && !isDelegatee && !isOrgAdmin && !isSuperAdmin) {
      throw new ForbiddenException('Bạn không có quyền xem chính sách ủy quyền này.');
    }

    return this.mapToView(policy);
  }

  /**
   * Cập nhật chính sách ủy quyền
   */
  async updatePolicy(
    policyId: string,
    actorId: string,
    actorRole: string,
    actorOrgId: string | null,
    dto: UpdateDelegationPolicyDto
  ): Promise<DelegationPolicyView> {
    const policy = await this.prisma.delegationPolicy.findUnique({
      where: { id: policyId },
    });

    if (!policy) {
      throw new NotFoundException('Không tìm thấy chính sách ủy quyền.');
    }

    // Kiểm tra quyền sửa
    const isDelegator = policy.delegatorId === actorId;
    const isOrgAdmin =
      actorRole === 'ADMIN' && policy.organizationId === actorOrgId;
    const isSuperAdmin = actorRole === 'SUPER_ADMIN';

    if (!isDelegator && !isOrgAdmin && !isSuperAdmin) {
      throw new ForbiddenException('Bạn không có quyền chỉnh sửa chính sách ủy quyền này.');
    }

    if (!policy.isActive) {
      throw new BadRequestException('Không thể chỉnh sửa chính sách đã bị thu hồi hoặc đã kết thúc.');
    }

    const now = new Date();
    if (policy.endDate <= now) {
      throw new BadRequestException('Không thể chỉnh sửa chính sách đã hết thời hạn hiệu lực.');
    }

    const data: any = {};
    if (dto.endDate) {
      const newEndDate = new Date(dto.endDate);
      if (isNaN(newEndDate.getTime()) || newEndDate <= policy.startDate) {
        throw new BadRequestException('Thời gian kết thúc mới phải sau thời gian bắt đầu.');
      }
      data.endDate = newEndDate;
    }

    if (dto.reason !== undefined) {
      data.reason = dto.reason ? dto.reason.trim() : null;
    }

    if (dto.scopeDepartmentId !== undefined) {
      data.scopeDepartmentId = dto.scopeDepartmentId || null;
    }

    if (dto.scopeTemplateId !== undefined) {
      data.scopeTemplateId = dto.scopeTemplateId || null;
    }

    const updated = await this.prisma.delegationPolicy.update({
      where: { id: policyId },
      data,
      include: {
        delegator: { select: { fullName: true, email: true } },
        delegatee: { select: { fullName: true, email: true } },
        createdBy: { select: { fullName: true } },
        scopeDepartment: { select: { name: true } },
        scopeTemplate: { select: { title: true } },
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: actorId,
        action: AuditAction.UPDATE_DELEGATION_POLICY,
        details: { policyId, updatedFields: data },
      },
    });

    return this.mapToView(updated);
  }

  /**
   * Thu hồi chính sách ủy quyền (Soft Revoke)
   */
  async revokePolicy(
    policyId: string,
    actorId: string,
    actorRole: string,
    actorOrgId: string | null,
    reason?: string
  ): Promise<DelegationPolicyView> {
    const policy = await this.prisma.delegationPolicy.findUnique({
      where: { id: policyId },
      include: {
        delegator: { select: { fullName: true, email: true } },
        delegatee: { select: { fullName: true, email: true } },
      },
    });

    if (!policy) {
      throw new NotFoundException('Không tìm thấy chính sách ủy quyền.');
    }

    // Kiểm tra quyền thu hồi
    const isDelegator = policy.delegatorId === actorId;
    const isOrgAdmin =
      actorRole === 'ADMIN' && policy.organizationId === actorOrgId;
    const isSuperAdmin = actorRole === 'SUPER_ADMIN';

    if (!isDelegator && !isOrgAdmin && !isSuperAdmin) {
      throw new ForbiddenException('Bạn không có quyền thu hồi chính sách ủy quyền này.');
    }

    if (!policy.isActive) {
      throw new BadRequestException('Chính sách ủy quyền này đã được thu hồi trước đó.');
    }

    const now = new Date();
    const revoked = await this.prisma.delegationPolicy.update({
      where: { id: policyId },
      data: {
        isActive: false,
        revokedAt: now,
        revokedById: actorId,
        reason: reason
          ? `${policy.reason || ''} [Lý do thu hồi: ${reason.trim()}]`.trim()
          : policy.reason,
      },
      include: {
        delegator: { select: { fullName: true, email: true } },
        delegatee: { select: { fullName: true, email: true } },
        createdBy: { select: { fullName: true } },
        scopeDepartment: { select: { name: true } },
        scopeTemplate: { select: { title: true } },
      },
    });

    // Ghi AuditLog
    await this.prisma.auditLog.create({
      data: {
        userId: actorId,
        action: AuditAction.REVOKE_DELEGATION_POLICY,
        details: {
          policyId,
          revokedById: actorId,
          delegatorId: policy.delegatorId,
          delegateeId: policy.delegateeId,
          revokedAt: now.toISOString(),
          reason,
        },
      },
    });

    // Gửi thông báo cho delegatee
    await this.notificationService.createNotification({
      userId: policy.delegateeId,
      type: NotificationType.DELEGATION_REVOKED,
      title: 'Chính sách ủy quyền đã chấm dứt',
      content: `Quyền phê duyệt ủy quyền từ cán bộ ${policy.delegator.fullName} đã được thu hồi vào ${now.toLocaleDateString('vi-VN')}.`,
      idempotencyKey: `DELEGATION_REVOKED:${policy.id}:${policy.delegateeId}`,
      metadata: {
        policyId: policy.id,
        delegatorId: policy.delegatorId,
        revokedAt: now.toISOString(),
      },
    });

    return this.mapToView(revoked);
  }

  /**
   * Deterministic Policy Resolution Engine:
   * Tìm chính sách ủy quyền đang hiệu lực và khớp nhất cho actorId thay mặt cho một pending approver trong bước duyệt
   */
  async resolveActiveDelegation(
    params: ResolveDelegationParams
  ): Promise<ResolvedDelegationResult | null> {
    const { document, step, actorId, now = new Date() } = params;

    // Lọc các assignees của bước đang có vai trò APPROVER và chưa đưa ra quyết định (PENDING)
    const pendingApprovers = step.assignees.filter(
      (a) => a.role === AssigneeRole.APPROVER && a.decision === AssigneeDecision.PENDING
    );

    if (pendingApprovers.length === 0) {
      return null;
    }

    const pendingUserIds = pendingApprovers.map((a) => a.userId);

    // Tìm các chính sách ủy quyền còn hiệu lực từ pendingUserIds tới actorId
    const matchingPolicies = await this.prisma.delegationPolicy.findMany({
      where: {
        delegatorId: { in: pendingUserIds },
        delegateeId: actorId,
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
        organizationId: document.organizationId || undefined,
        delegatee: { isActive: true },
        delegator: { isActive: true },
      },
      include: {
        delegator: { select: { id: true, fullName: true, email: true } },
        delegatee: { select: { id: true, fullName: true, email: true } },
      },
    });

    if (matchingPolicies.length === 0) {
      return null;
    }

    // Quy tắc ưu tiên cụ thể (Specificity Score):
    // 3 điểm: Khớp cả templateId và departmentId
    // 2 điểm: Khớp templateId
    // 1 điểm: Khớp departmentId
    // 0 điểm: Toàn tổ chức (cả 2 scope đều null)
    const scoredCandidates: Array<{
      policy: (typeof matchingPolicies)[0];
      score: number;
    }> = [];

    for (const policy of matchingPolicies) {
      let isScopeMatch = true;
      let score = 0;

      if (policy.scopeTemplateId) {
        if (policy.scopeTemplateId === document.templateId) {
          score += 2;
        } else {
          isScopeMatch = false;
        }
      }

      if (policy.scopeDepartmentId) {
        if (policy.scopeDepartmentId === document.departmentId) {
          score += 1;
        } else {
          isScopeMatch = false;
        }
      }

      if (isScopeMatch) {
        scoredCandidates.push({ policy, score });
      }
    }

    if (scoredCandidates.length === 0) {
      return null;
    }

    // Sắp xếp theo score giảm dần, nếu bằng điểm lấy policy có createdAt mới nhất (Deterministic)
    scoredCandidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.policy.createdAt.getTime() - a.policy.createdAt.getTime();
    });

    const chosen = scoredCandidates[0].policy;
    const targetAssignee = pendingApprovers.find(
      (a) => a.userId === chosen.delegatorId
    );

    if (!targetAssignee) {
      return null;
    }

    return {
      policy: {
        id: chosen.id,
        delegatorId: chosen.delegatorId,
        delegateeId: chosen.delegateeId,
        organizationId: chosen.organizationId,
      },
      assignee: targetAssignee,
      delegatorName: chosen.delegator.fullName,
    };
  }

  private mapToView(policy: any): DelegationPolicyView {
    return {
      id: policy.id,
      organizationId: policy.organizationId,
      delegatorId: policy.delegatorId,
      delegatorName: policy.delegator?.fullName,
      delegatorEmail: policy.delegator?.email,
      delegateeId: policy.delegateeId,
      delegateeName: policy.delegatee?.fullName,
      delegateeEmail: policy.delegatee?.email,
      startDate: policy.startDate.toISOString(),
      endDate: policy.endDate.toISOString(),
      scopeDepartmentId: policy.scopeDepartmentId,
      scopeDepartmentName: policy.scopeDepartment?.name,
      scopeTemplateId: policy.scopeTemplateId,
      scopeTemplateTitle: policy.scopeTemplate?.title,
      reason: policy.reason,
      isActive: policy.isActive,
      createdById: policy.createdById,
      createdByName: policy.createdBy?.fullName,
      revokedAt: policy.revokedAt ? policy.revokedAt.toISOString() : null,
      revokedById: policy.revokedById,
      createdAt: policy.createdAt.toISOString(),
      updatedAt: policy.updatedAt.toISOString(),
    };
  }
}
