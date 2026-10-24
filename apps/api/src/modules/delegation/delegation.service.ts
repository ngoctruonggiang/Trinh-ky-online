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

    // 5. Khởi chạy Transaction với PostgreSQL Advisory Lock theo Organization
    const createdPolicy = await this.prisma.$transaction(async (tx) => {
      // 5.0. Khóa tuần tự hóa mức tổ chức để ngăn chặn Race Condition tạo chu trình đồng thời (A->B và B->A)
      if (typeof (tx as any).$executeRaw === 'function') {
        await (tx as any).$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext('delegation_org_' || ${organizationId})::bigint)
        `;
      }

      // 5.1. Tải toàn bộ các chính sách đang hoạt động có khoảng thời gian giao thoa trong cùng tổ chức
      const overlappingPolicies = await tx.delegationPolicy.findMany({
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
          startDate: true,
          endDate: true,
          scopeDepartmentId: true,
          scopeTemplateId: true,
        },
      });

      // 5.2. Chặn chính sách trùng phạm vi tuyệt đối cho cùng 1 delegator trong thời gian giao thoa
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

      // 5.3. Thuật toán phát hiện chu trình có hướng phụ thuộc thời gian (Temporal Directed Cycle Detection)
      const hasCycle = this.checkTemporalCycle(overlappingPolicies, {
        delegatorId,
        delegateeId,
        startDate,
        endDate,
      });

      if (hasCycle) {
        throw new BadRequestException(
          `Phát hiện chu trình ủy quyền khép kín (Delegation Cycle): Người nhận ủy quyền "${delegatee.fullName}" đã ủy quyền trực tiếp hoặc gián tiếp ngược lại cho "${delegator.fullName}" trong cùng khoảng thời gian hiệu lực. Không thể tạo chính sách.`
        );
      }

      // 6. Lưu vào Cơ sở dữ liệu trong cùng transaction
      const policy = await tx.delegationPolicy.create({
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
      await tx.auditLog.create({
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

      return policy;
    });

    // 8. Gửi In-App Notification cho người nhận ủy quyền (ngoài transaction để đảm bảo reliability)
    await this.notificationService.createNotification({
      userId: delegateeId,
      type: NotificationType.DELEGATION_ASSIGNED,
      title: 'Bạn nhận được quyền ủy quyền phê duyệt',
      content: `Cán bộ ${delegator.fullName} đã ủy quyền phê duyệt cho bạn từ ngày ${startDate.toLocaleDateString('vi-VN')} đến ngày ${endDate.toLocaleDateString('vi-VN')}.`,
      idempotencyKey: `DELEGATION_ASSIGNED:${createdPolicy.id}:${delegateeId}`,
      metadata: {
        policyId: createdPolicy.id,
        delegatorId,
        delegatorName: delegator.fullName,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
    });

    return this.mapToView(createdPolicy);
  }

  /**
   * Thuật toán DFS phát hiện chu trình có hướng phụ thuộc thời gian (Temporal Directed Cycle Detection):
   * Một chu trình e_1 -> e_2 -> ... -> e_k chỉ thực sự hình thành nếu khoảng thời gian giao nhau
   * của TOÀN BỘ các cạnh trên chu trình là khác rỗng: ∩ [start_i, end_i] ≠ ∅.
   */
  public checkTemporalCycle(
    existingPolicies: Array<{
      id?: string;
      delegatorId: string;
      delegateeId: string;
      startDate: Date;
      endDate: Date;
    }>,
    newEdge: {
      delegatorId: string;
      delegateeId: string;
      startDate: Date;
      endDate: Date;
    }
  ): boolean {
    const adj = new Map<string, Array<{ target: string; start: number; end: number }>>();
    for (const p of existingPolicies) {
      if (!adj.has(p.delegatorId)) {
        adj.set(p.delegatorId, []);
      }
      adj.get(p.delegatorId)!.push({
        target: p.delegateeId,
        start: new Date(p.startDate).getTime(),
        end: new Date(p.endDate).getTime(),
      });
    }

    const target = newEdge.delegatorId;
    const startNode = newEdge.delegateeId;
    const initStart = new Date(newEdge.startDate).getTime();
    const initEnd = new Date(newEdge.endDate).getTime();

    if (startNode === target) return true;

    const visitedInPath = new Set<string>();

    const dfs = (current: string, curStart: number, curEnd: number): boolean => {
      visitedInPath.add(current);
      const edges = adj.get(current) || [];

      for (const edge of edges) {
        const nextStart = Math.max(curStart, edge.start);
        const nextEnd = Math.min(curEnd, edge.end);

        // Nếu không có khoảng thời gian giao nhau hợp lệ, không thể tạo chu trình đồng thời
        if (nextStart > nextEnd) {
          continue;
        }

        // Tìm thấy đường đi khép kín về target với thời gian giao thoa thực sự
        if (edge.target === target) {
          return true;
        }

        if (!visitedInPath.has(edge.target)) {
          if (dfs(edge.target, nextStart, nextEnd)) {
            return true;
          }
        }
      }

      visitedInPath.delete(current);
      return false;
    };

    return dfs(startNode, initStart, initEnd);
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
      organizationId?: string;
      page?: number;
      limit?: number;
    }
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = {};

    // Phân quyền theo vai trò (RBAC) & Tenant Isolation tuyệt đối
    if (actorRole === 'USER') {
      if (!actorOrgId) {
        throw new ForbiddenException('Người dùng không thuộc tổ chức nào.');
      }
      // USER chỉ thấy policy trong tổ chức của mình
      where.organizationId = actorOrgId;
      if (query.role === 'delegator') {
        where.delegatorId = actorId;
      } else if (query.role === 'delegatee') {
        where.delegateeId = actorId;
      } else {
        // Dù truyền role=all hay không truyền, USER chỉ được xem policy mà mình là delegator hoặc delegatee
        where.OR = [{ delegatorId: actorId }, { delegateeId: actorId }];
      }
    } else if (actorRole === 'ADMIN') {
      if (!actorOrgId) {
        throw new ForbiddenException('Quản trị viên không thuộc tổ chức nào.');
      }
      // ADMIN bị khóa chặt vào organizationId của mình, không thể xem chéo tổ chức dù client gửi organizationId khác
      where.organizationId = actorOrgId;
      if (query.role === 'delegator') {
        where.delegatorId = actorId;
      } else if (query.role === 'delegatee') {
        where.delegateeId = actorId;
      }
    } else if (actorRole === 'SUPER_ADMIN') {
      // SUPER_ADMIN có quyền truy cập toàn cầu, có thể lọc theo organizationId nếu được chỉ định
      if (query.organizationId) {
        where.organizationId = query.organizationId;
      } else if (actorOrgId) {
        where.organizationId = actorOrgId;
      }
      if (query.role === 'delegator') {
        where.delegatorId = actorId;
      } else if (query.role === 'delegatee') {
        where.delegateeId = actorId;
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
   * Cập nhật chính sách ủy quyền với kiểm soát tương tranh và chu trình có hướng
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

    const newEndDate = dto.endDate ? new Date(dto.endDate) : policy.endDate;
    if (dto.endDate) {
      if (isNaN(newEndDate.getTime()) || newEndDate <= policy.startDate) {
        throw new BadRequestException('Thời gian kết thúc mới phải sau thời gian bắt đầu.');
      }
    }

    // Kiểm tra phạm vi (Scope validation)
    if (dto.scopeDepartmentId) {
      const dept = await this.prisma.department.findUnique({
        where: { id: dto.scopeDepartmentId },
      });
      if (!dept || dept.organizationId !== policy.organizationId) {
        throw new BadRequestException('Phòng ban trong phạm vi ủy quyền không tồn tại hoặc không thuộc tổ chức này.');
      }
    }

    if (dto.scopeTemplateId) {
      const template = await this.prisma.formTemplate.findUnique({
        where: { id: dto.scopeTemplateId },
      });
      if (
        !template ||
        (template.organizationId && template.organizationId !== policy.organizationId)
      ) {
        throw new BadRequestException(
          'Biểu mẫu trong phạm vi ủy quyền không tồn tại hoặc không thuộc quyền quản lý của tổ chức.'
        );
      }
    }

    const data: any = {};
    if (dto.endDate) data.endDate = newEndDate;
    if (dto.reason !== undefined) data.reason = dto.reason ? dto.reason.trim() : null;
    if (dto.scopeDepartmentId !== undefined) data.scopeDepartmentId = dto.scopeDepartmentId || null;
    if (dto.scopeTemplateId !== undefined) data.scopeTemplateId = dto.scopeTemplateId || null;

    return await this.prisma.$transaction(async (tx) => {
      // Khóa tuần tự hóa theo organization để tránh race condition khi cập nhật policy đồng thời
      if (typeof (tx as any).$executeRaw === 'function') {
        await (tx as any).$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext('delegation_org_' || ${policy.organizationId})::bigint)
        `;
      }

      // Khóa bi quan hàng policy để đảm bảo nhất quán với revokePolicy
      if (typeof (tx as any).$queryRaw === 'function') {
        await (tx as any).$queryRaw`
          SELECT id FROM delegation_policies WHERE id = ${policyId} FOR UPDATE
        `;
      }

      // Tái xác minh trạng thái trong transaction
      const currentInTx = await tx.delegationPolicy.findUnique({
        where: { id: policyId },
      });

      if (!currentInTx || !currentInTx.isActive) {
        throw new BadRequestException('Không thể chỉnh sửa chính sách đã bị thu hồi trong quá trình xử lý.');
      }

      // Nếu kéo dài thời gian kết thúc hoặc thay đổi phạm vi, chạy lại phát hiện chu trình (Temporal Cycle Detection)
      if (dto.endDate || dto.scopeDepartmentId !== undefined || dto.scopeTemplateId !== undefined) {
        const otherPolicies = await tx.delegationPolicy.findMany({
          where: {
            organizationId: policy.organizationId,
            isActive: true,
            id: { not: policyId },
            startDate: { lte: newEndDate },
            endDate: { gte: policy.startDate },
          },
          select: {
            id: true,
            delegatorId: true,
            delegateeId: true,
            startDate: true,
            endDate: true,
            scopeDepartmentId: true,
            scopeTemplateId: true,
          },
        });

        const hasCycle = this.checkTemporalCycle(otherPolicies, {
          delegatorId: policy.delegatorId,
          delegateeId: policy.delegateeId,
          startDate: policy.startDate,
          endDate: newEndDate,
        });

        if (hasCycle) {
          throw new BadRequestException(
            'Cập nhật chính sách tạo ra chu trình ủy quyền khép kín (Delegation Cycle) trong khoảng thời gian mới. Không thể thực hiện cập nhật.'
          );
        }
      }

      const updated = await tx.delegationPolicy.update({
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

      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: AuditAction.UPDATE_DELEGATION_POLICY,
          details: { policyId, updatedFields: data },
        },
      });

      return updated;
    }).then((updated) => this.mapToView(updated));
  }

  /**
   * Thu hồi chính sách ủy quyền (Soft Revoke) phối hợp khóa bi quan với luồng phê duyệt
   */
  async revokePolicy(
    policyId: string,
    actorId: string,
    actorRole: string,
    actorOrgId: string | null,
    reason?: string
  ): Promise<DelegationPolicyView> {
    const { revoked, policy, now } = await this.prisma.$transaction(async (tx) => {
      // 1. Khóa bi quan hàng policy (FOR UPDATE) để phối hợp với transaction phê duyệt
      if (typeof (tx as any).$queryRaw === 'function') {
        await (tx as any).$queryRaw`
          SELECT id FROM delegation_policies WHERE id = ${policyId} FOR UPDATE
        `;
      }

      const foundPolicy = await tx.delegationPolicy.findUnique({
        where: { id: policyId },
        include: {
          delegator: { select: { fullName: true, email: true } },
          delegatee: { select: { fullName: true, email: true } },
        },
      });

      if (!foundPolicy) {
        throw new NotFoundException('Không tìm thấy chính sách ủy quyền.');
      }

      // Kiểm tra quyền thu hồi
      const isDelegator = foundPolicy.delegatorId === actorId;
      const isOrgAdmin =
        actorRole === 'ADMIN' && foundPolicy.organizationId === actorOrgId;
      const isSuperAdmin = actorRole === 'SUPER_ADMIN';

      if (!isDelegator && !isOrgAdmin && !isSuperAdmin) {
        throw new ForbiddenException('Bạn không có quyền thu hồi chính sách ủy quyền này.');
      }

      if (!foundPolicy.isActive) {
        throw new BadRequestException('Chính sách ủy quyền này đã được thu hồi trước đó.');
      }

      const revokeTime = new Date();
      const updated = await tx.delegationPolicy.update({
        where: { id: policyId },
        data: {
          isActive: false,
          revokedAt: revokeTime,
          revokedById: actorId,
          reason: reason
            ? `${foundPolicy.reason || ''} [Lý do thu hồi: ${reason.trim()}]`.trim()
            : foundPolicy.reason,
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
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: AuditAction.REVOKE_DELEGATION_POLICY,
          details: {
            policyId,
            revokedById: actorId,
            delegatorId: foundPolicy.delegatorId,
            delegateeId: foundPolicy.delegateeId,
            revokedAt: revokeTime.toISOString(),
            reason,
          },
        },
      });

      return { revoked: updated, policy: foundPolicy, now: revokeTime };
    });

    // Gửi thông báo cho delegatee ngoài transaction
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

    // Sắp xếp theo score giảm dần. Nếu trùng điểm:
    // 1. So sánh createdAt mới nhất.
    // 2. Nếu cả createdAt cũng trùng nhau, tie-break bằng id (alphabetical desc) để đảm bảo 100% deterministic
    scoredCandidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const timeDiff = b.policy.createdAt.getTime() - a.policy.createdAt.getTime();
      if (timeDiff !== 0) return timeDiff;
      return b.policy.id.localeCompare(a.policy.id);
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
