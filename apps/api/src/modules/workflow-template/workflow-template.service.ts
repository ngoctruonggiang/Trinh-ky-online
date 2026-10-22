import { createHash } from 'crypto';
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaClient, TemplateStatus, UserRole } from '@prisma/client';
import { UserPrincipal } from '../../common/interfaces/user-principal.interface.js';
import {
  validateWorkflowSchema,
  WorkflowStepConfig,
  WorkflowTemplateDefinition,
  canonicalizeJson,
} from '@trinh-ky/shared';
import { CreateWorkflowTemplateDto } from './dto/create-workflow-template.dto.js';
import { UpdateWorkflowTemplateDto } from './dto/update-workflow-template.dto.js';
import { PublishWorkflowTemplateDto } from './dto/publish-workflow-template.dto.js';
import { GetWorkflowTemplatesQueryDto } from './dto/get-workflow-templates-query.dto.js';

@Injectable()
export class WorkflowTemplateService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Lấy danh sách workflow template theo phân quyền tổ chức và trạng thái
   */
  async getWorkflowTemplates(user: UserPrincipal, query: GetWorkflowTemplatesQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = {};

    // 1. Phân quyền tổ chức (Multi-Company Boundary)
    if (user.role === UserRole.SUPER_ADMIN) {
      // SUPER_ADMIN có thể xem toàn bộ quy trình hệ thống
    } else {
      // ADMIN và USER chỉ xem quy trình của công ty mình hoặc quy trình dùng chung toàn hệ thống
      if (user.organizationId) {
        where.OR = [
          { organizationId: user.organizationId },
          { organizationId: null },
        ];
      } else {
        where.organizationId = null;
      }
    }

    // 2. Phân quyền theo vai trò (Role-based visibility)
    if (user.role === UserRole.USER) {
      // USER thông thường chỉ được xem các quy trình đã PUBLISHED
      where.status = TemplateStatus.PUBLISHED;
    } else if (query.status && query.status !== 'ALL') {
      where.status = query.status as TemplateStatus;
    }

    // 3. Lọc theo danh mục
    if (query.category) {
      where.category = query.category;
    }

    // 4. Tìm kiếm theo từ khóa
    if (query.search && query.search.trim()) {
      const s = query.search.trim();
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { title: { contains: s, mode: 'insensitive' } },
            { code: { contains: s, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.workflowTemplate.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        include: {
          organization: { select: { id: true, name: true, code: true } },
          createdBy: { select: { id: true, fullName: true, email: true } },
        },
      }),
      this.prisma.workflowTemplate.count({ where }),
    ]);

    const mappedItems = items.map((t) => {
      const stepsArr = Array.isArray(t.steps) ? t.steps : [];
      return {
        id: t.id,
        code: t.code,
        title: t.title,
        description: t.description,
        category: t.category,
        status: t.status,
        currentVersion: t.currentVersion,
        stepCount: stepsArr.length,
        organizationId: t.organizationId,
        organizationName: t.organization?.name || 'Toàn tập đoàn (Chung)',
        createdById: t.createdById,
        createdByName: t.createdBy?.fullName || 'Hệ thống',
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      };
    });

    return {
      items: mappedItems,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Lấy chi tiết quy trình phê duyệt kèm lịch sử phiên bản và bản nháp (nếu có)
   */
  async getWorkflowTemplateById(id: string, user: UserPrincipal) {
    const template = await this.prisma.workflowTemplate.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, fullName: true, email: true } },
        versions: {
          orderBy: { versionNumber: 'desc' },
          include: {
            createdByUser: { select: { id: true, fullName: true } },
          },
        },
      },
    });

    if (!template) {
      throw new NotFoundException(`Không tìm thấy quy trình phê duyệt với mã id: ${id}`);
    }

    // Kiểm tra ranh giới tổ chức
    this.assertTenantAccess(template.organizationId, user);

    // USER thông thường không được xem quy trình DRAFT của Admin
    if (user.role === UserRole.USER && template.status === TemplateStatus.DRAFT) {
      throw new ForbiddenException('Bạn không có quyền xem quy trình đang ở trạng thái bản nháp.');
    }

    // Tìm xem có bản nháp dở dang nào đang được chuẩn bị không
    const draftVersion = template.versions.find((v) => v.status === TemplateStatus.DRAFT);
    const publishedVersions = template.versions.filter((v) => v.status === TemplateStatus.PUBLISHED);

    return {
      id: template.id,
      code: template.code,
      title: template.title,
      description: template.description,
      category: template.category,
      status: template.status,
      currentVersion: template.currentVersion,
      steps: template.steps as unknown as WorkflowStepConfig[],
      organizationId: template.organizationId,
      organizationName: template.organization?.name || 'Toàn tập đoàn (Chung)',
      createdById: template.createdById,
      createdByName: template.createdBy?.fullName || 'Hệ thống',
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
      hasDraft: Boolean(draftVersion),
      draftVersion: draftVersion
        ? {
            id: draftVersion.id,
            versionNumber: draftVersion.versionNumber,
            title: draftVersion.title,
            description: draftVersion.description,
            steps: draftVersion.steps as unknown as WorkflowStepConfig[],
            changeSummary: draftVersion.changeSummary,
            createdAt: draftVersion.createdAt.toISOString(),
          }
        : null,
      versions: publishedVersions.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        title: v.title,
        changeSummary: v.changeSummary,
        status: v.status,
        createdByName: v.createdByUser?.fullName || 'Hệ thống',
        createdAt: v.createdAt.toISOString(),
        stepCount: Array.isArray(v.steps) ? v.steps.length : 0,
      })),
    };
  }

  /**
   * Tạo mới quy trình phê duyệt (DRAFT ban đầu)
   */
  async createWorkflowTemplate(dto: CreateWorkflowTemplateDto, user: UserPrincipal) {
    this.assertAdminRole(user);

    // Xác thực tính hợp lệ của schema quy trình
    const validation = validateWorkflowSchema({
      code: dto.code,
      title: dto.title,
      steps: dto.steps,
      category: dto.category,
    });

    if (!validation.valid) {
      throw new BadRequestException({
        message: 'Cấu hình quy trình phê duyệt không hợp lệ.',
        errors: validation.errors,
      });
    }

    // Kiểm tra trùng mã code
    const existingCode = await this.prisma.workflowTemplate.findUnique({
      where: { code: dto.code.trim().toUpperCase() },
    });
    if (existingCode) {
      throw new ConflictException(`Mã quy trình "${dto.code}" đã tồn tại trong hệ thống.`);
    }

    // Gán organizationId theo phân quyền
    let targetOrgId: string | null = null;
    if (user.role === UserRole.SUPER_ADMIN) {
      targetOrgId = dto.organizationId ?? null;
    } else {
      if (dto.organizationId === null) {
        throw new ForbiddenException(
          'Chỉ Quản trị viên cấp cao (SUPER_ADMIN) mới có quyền tạo quy trình dùng chung toàn hệ thống.',
        );
      }
      targetOrgId = user.organizationId;
    }

    const created = await this.prisma.workflowTemplate.create({
      data: {
        code: dto.code.trim().toUpperCase(),
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        category: dto.category?.trim() || 'Chung',
        organizationId: targetOrgId,
        status: TemplateStatus.DRAFT,
        currentVersion: 1,
        steps: dto.steps as any,
        createdById: user.id,
      },
    });

    return {
      success: true,
      data: {
        id: created.id,
        code: created.code,
        title: created.title,
        status: created.status,
      },
    };
  }

  /**
   * Cập nhật quy trình khi còn ở bản nháp ban đầu (DRAFT v1)
   */
  async updateWorkflowTemplate(id: string, dto: UpdateWorkflowTemplateDto, user: UserPrincipal) {
    this.assertAdminRole(user);

    const template = await this.prisma.workflowTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException('Không tìm thấy quy trình phê duyệt để cập nhật.');
    }

    this.assertAdminTenantMutationAccess(template.organizationId, user);

    if (template.status !== TemplateStatus.DRAFT) {
      throw new BadRequestException(
        'Chỉ có thể chỉnh sửa quy trình đang ở trạng thái bản nháp ban đầu. Với quy trình đã phát hành, vui lòng sử dụng chức năng tạo bản nháp phiên bản tiếp theo.'
      );
    }

    const updatedSteps = dto.steps || (template.steps as unknown as WorkflowStepConfig[]);
    const updatedTitle = dto.title || template.title;

    const validation = validateWorkflowSchema({
      code: template.code,
      title: updatedTitle,
      steps: updatedSteps,
    });

    if (!validation.valid) {
      throw new BadRequestException({
        message: 'Cấu hình quy trình phê duyệt không hợp lệ.',
        errors: validation.errors,
      });
    }

    const updated = await this.prisma.workflowTemplate.update({
      where: { id },
      data: {
        title: dto.title ? dto.title.trim() : undefined,
        description: dto.description !== undefined ? dto.description : undefined,
        category: dto.category ? dto.category.trim() : undefined,
        steps: dto.steps ? (dto.steps as any) : undefined,
      },
    });

    return {
      success: true,
      data: {
        id: updated.id,
        title: updated.title,
        status: updated.status,
      },
    };
  }

  /**
   * Tạo bản nháp cho phiên bản tiếp theo từ một workflow đã PUBLISHED
   */
  async createDraftVersion(id: string, user: UserPrincipal) {
    this.assertAdminRole(user);

    const template = await this.prisma.workflowTemplate.findUnique({
      where: { id },
      include: {
        versions: {
          where: { status: TemplateStatus.DRAFT },
          take: 1,
        },
      },
    });

    if (!template) {
      throw new NotFoundException('Không tìm thấy quy trình phê duyệt.');
    }

    this.assertAdminTenantMutationAccess(template.organizationId, user);

    if (template.status === TemplateStatus.ARCHIVED) {
      throw new BadRequestException('Không thể tạo bản nháp cho quy trình đã lưu trữ.');
    }

    // Nếu template chưa từng phát hành (đang ở DRAFT ban đầu)
    if (template.status === TemplateStatus.DRAFT) {
      return {
        success: true,
        data: {
          id: template.id,
          workflowTemplateId: template.id,
          versionNumber: 1,
          title: template.title,
          steps: template.steps,
          status: template.status,
          createdAt: template.createdAt.toISOString(),
        },
      };
    }

    // Nếu đã có bản nháp DRAFT cho phiên bản tiếp theo đang soạn dở
    const existingDraft = template.versions[0];
    if (existingDraft) {
      return {
        success: true,
        data: {
          id: existingDraft.id,
          workflowTemplateId: template.id,
          versionNumber: existingDraft.versionNumber,
          title: existingDraft.title,
          steps: existingDraft.steps,
          status: existingDraft.status,
          createdAt: existingDraft.createdAt.toISOString(),
        },
      };
    }

    // Tạo bản nháp WorkflowTemplateVersion mới với versionNumber = currentVersion + 1
    const nextVersionNumber = template.currentVersion + 1;
    const newDraftVersion = await this.prisma.workflowTemplateVersion.create({
      data: {
        workflowTemplateId: template.id,
        versionNumber: nextVersionNumber,
        title: template.title,
        description: template.description,
        steps: template.steps as any,
        changeSummary: `Bản nháp chuẩn bị cho phiên bản v${nextVersionNumber}`,
        status: TemplateStatus.DRAFT,
        createdById: user.id,
      },
    });

    return {
      success: true,
      data: {
        id: newDraftVersion.id,
        workflowTemplateId: template.id,
        versionNumber: newDraftVersion.versionNumber,
        title: newDraftVersion.title,
        steps: newDraftVersion.steps,
        status: newDraftVersion.status,
        createdAt: newDraftVersion.createdAt.toISOString(),
      },
    };
  }

  /**
   * Lấy thông tin bản nháp của phiên bản tiếp theo
   */
  async getDraftVersion(id: string, user: UserPrincipal) {
    this.assertAdminRole(user);

    const template = await this.prisma.workflowTemplate.findUnique({
      where: { id },
      include: {
        versions: {
          where: { status: TemplateStatus.DRAFT },
          take: 1,
        },
      },
    });

    if (!template) {
      throw new NotFoundException('Không tìm thấy quy trình phê duyệt.');
    }

    this.assertTenantAccess(template.organizationId, user);

    if (template.status === TemplateStatus.DRAFT) {
      return {
        id: template.id,
        versionNumber: 1,
        title: template.title,
        description: template.description,
        steps: template.steps,
        status: TemplateStatus.DRAFT,
      };
    }

    const draft = template.versions[0];
    if (!draft) {
      throw new NotFoundException('Không có bản nháp nào đang được chuẩn bị cho quy trình này.');
    }

    return {
      id: draft.id,
      versionNumber: draft.versionNumber,
      title: draft.title,
      description: draft.description,
      steps: draft.steps,
      status: draft.status,
      changeSummary: draft.changeSummary,
      createdAt: draft.createdAt.toISOString(),
    };
  }

  /**
   * Chỉnh sửa nội dung bản nháp cho phiên bản tiếp theo
   */
  async updateDraftVersion(id: string, dto: UpdateWorkflowTemplateDto, user: UserPrincipal) {
    this.assertAdminRole(user);

    const template = await this.prisma.workflowTemplate.findUnique({
      where: { id },
      include: {
        versions: {
          where: { status: TemplateStatus.DRAFT },
          take: 1,
        },
      },
    });

    if (!template) {
      throw new NotFoundException('Không tìm thấy quy trình phê duyệt để cập nhật.');
    }

    this.assertAdminTenantMutationAccess(template.organizationId, user);

    if (template.status === TemplateStatus.ARCHIVED) {
      throw new BadRequestException('Không thể chỉnh sửa quy trình đã lưu trữ.');
    }

    // Nếu template đang ở DRAFT ban đầu
    if (template.status === TemplateStatus.DRAFT) {
      return this.updateWorkflowTemplate(id, dto, user);
    }

    // Nếu template đã PUBLISHED, sửa trên bản nháp tiếp theo
    const draft = template.versions[0];
    if (!draft) {
      throw new NotFoundException('Chưa có bản nháp cho phiên bản tiếp theo. Vui lòng tạo bản nháp trước.');
    }

    const updatedSteps = dto.steps || (draft.steps as unknown as WorkflowStepConfig[]);
    const updatedTitle = dto.title || draft.title;

    const validation = validateWorkflowSchema({
      code: template.code,
      title: updatedTitle,
      steps: updatedSteps,
    });

    if (!validation.valid) {
      throw new BadRequestException({
        message: 'Cấu hình quy trình phê duyệt không hợp lệ.',
        errors: validation.errors,
      });
    }

    const updatedDraft = await this.prisma.workflowTemplateVersion.update({
      where: { id: draft.id },
      data: {
        title: dto.title ? dto.title.trim() : undefined,
        description: dto.description !== undefined ? dto.description : undefined,
        steps: dto.steps ? (dto.steps as any) : undefined,
      },
    });

    return {
      success: true,
      data: {
        id: updatedDraft.id,
        versionNumber: updatedDraft.versionNumber,
        title: updatedDraft.title,
        status: updatedDraft.status,
      },
    };
  }

  /**
   * Hủy bỏ bản nháp tiếp theo đang soạn thảo
   */
  async discardDraftVersion(id: string, user: UserPrincipal) {
    this.assertAdminRole(user);

    const template = await this.prisma.workflowTemplate.findUnique({
      where: { id },
      include: {
        versions: {
          where: { status: TemplateStatus.DRAFT },
          take: 1,
        },
      },
    });

    if (!template) {
      throw new NotFoundException('Không tìm thấy quy trình phê duyệt.');
    }

    this.assertAdminTenantMutationAccess(template.organizationId, user);

    if (template.status === TemplateStatus.DRAFT) {
      throw new BadRequestException('Không thể hủy bản nháp ban đầu của quy trình chưa xuất bản.');
    }

    const draft = template.versions[0];
    if (!draft) {
      throw new NotFoundException('Không có bản nháp nào để hủy.');
    }

    await this.prisma.workflowTemplateVersion.delete({
      where: { id: draft.id },
    });

    return {
      success: true,
      message: 'Đã hủy bỏ bản nháp quy trình thành công.',
    };
  }

  /**
   * Phát hành workflow template (DRAFT -> PUBLISHED hoặc phát hành bản nháp v2, v3...)
   * Hỗ trợ concurrency lock chống race condition khi nhiều request phát hành đồng thời
   */
  async publishWorkflowTemplate(id: string, dto: PublishWorkflowTemplateDto, user: UserPrincipal) {
    this.assertAdminRole(user);

    const template = await this.prisma.workflowTemplate.findUnique({
      where: { id },
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
    });

    if (!template) {
      throw new NotFoundException('Không tìm thấy quy trình phê duyệt để phát hành.');
    }

    this.assertAdminTenantMutationAccess(template.organizationId, user);

    if (template.status === TemplateStatus.ARCHIVED) {
      throw new BadRequestException('Không thể phát hành quy trình đã lưu trữ.');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Tải lại template với pessimistic/optimistic boundary
        const currentTpl = await tx.workflowTemplate.findUnique({
          where: { id },
          include: {
            versions: {
              where: { status: TemplateStatus.DRAFT },
              take: 1,
            },
          },
        });

        if (!currentTpl) {
          throw new NotFoundException('Không tìm thấy quy trình phê duyệt.');
        }

        // Trường hợp 1: Phát hành lần đầu từ DRAFT ban đầu
        if (currentTpl.status === TemplateStatus.DRAFT) {
          const validation = validateWorkflowSchema({
            code: currentTpl.code,
            title: currentTpl.title,
            steps: currentTpl.steps,
          });

          if (!validation.valid) {
            throw new BadRequestException({
              message: 'Quy trình không hợp lệ để phát hành.',
              errors: validation.errors,
            });
          }

          const version1 = await tx.workflowTemplateVersion.create({
            data: {
              workflowTemplateId: currentTpl.id,
              versionNumber: 1,
              title: currentTpl.title,
              description: currentTpl.description,
              steps: currentTpl.steps as any,
              changeSummary: dto.changeSummary || dto.releaseNotes || 'Phát hành phiên bản v1 chính thức',
              status: TemplateStatus.PUBLISHED,
              createdById: user.id,
            },
          });

          await tx.workflowTemplate.update({
            where: { id },
            data: {
              status: TemplateStatus.PUBLISHED,
              currentVersion: 1,
            },
          });

          return {
            success: true,
            data: {
              id: currentTpl.id,
              versionNumber: 1,
              versionId: version1.id,
              status: TemplateStatus.PUBLISHED,
              message: 'Phát hành phiên bản v1 thành công.',
            },
          };
        }

        // Trường hợp 2: Phát hành bản nháp tiếp theo (v2, v3...)
        const draft = currentTpl.versions[0];
        if (!draft) {
          // Kiểm tra xem có phiên bản v(N) nào vừa được phát hành song song không
          throw new BadRequestException('Không có bản nháp nào đang chờ phát hành.');
        }

        const validation = validateWorkflowSchema({
          code: currentTpl.code,
          title: draft.title,
          steps: draft.steps,
        });

        if (!validation.valid) {
          throw new BadRequestException({
            message: 'Bản nháp quy trình không hợp lệ để phát hành.',
            errors: validation.errors,
          });
        }

        const publishedVersion = await tx.workflowTemplateVersion.update({
          where: { id: draft.id },
          data: {
            status: TemplateStatus.PUBLISHED,
            changeSummary: dto.changeSummary || dto.releaseNotes || draft.changeSummary,
          },
        });

        await tx.workflowTemplate.update({
          where: { id },
          data: {
            title: draft.title,
            description: draft.description,
            steps: draft.steps as any,
            currentVersion: draft.versionNumber,
            status: TemplateStatus.PUBLISHED,
          },
        });

        return {
          success: true,
          data: {
            id: currentTpl.id,
            versionNumber: publishedVersion.versionNumber,
            versionId: publishedVersion.id,
            status: TemplateStatus.PUBLISHED,
            message: `Phát hành phiên bản v${publishedVersion.versionNumber} thành công.`,
          },
        };
      });
    } catch (err: any) {
      if (err?.code === 'P2002' || err?.message?.includes('Unique constraint')) {
        throw new ConflictException(
          'Phiên bản quy trình vừa được một quản trị viên khác phát hành. Vui lòng tải lại trang.'
        );
      }
      throw err;
    }
  }

  /**
   * Lưu trữ quy trình phê duyệt
   */
  async archiveWorkflowTemplate(id: string, user: UserPrincipal) {
    this.assertAdminRole(user);

    const template = await this.prisma.workflowTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException('Không tìm thấy quy trình phê duyệt.');
    }

    this.assertAdminTenantMutationAccess(template.organizationId, user);

    const updated = await this.prisma.workflowTemplate.update({
      where: { id },
      data: { status: TemplateStatus.ARCHIVED },
    });

    return {
      success: true,
      data: {
        id: updated.id,
        status: updated.status,
      },
    };
  }

  /**
   * Kiểm tra quyền quản trị viên (ADMIN hoặc SUPER_ADMIN)
   */
  private assertAdminRole(user: UserPrincipal) {
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Chỉ Quản trị viên (ADMIN) mới có quyền thực hiện thao tác này.');
    }
  }

  /**
   * Kiểm tra quyền chỉnh sửa/đột biến (mutation) trên template:
   * - organizationId === null: chỉ SUPER_ADMIN mới được sửa
   * - organizationId !== null: ADMIN của công ty sở hữu hoặc SUPER_ADMIN
   */
  public assertAdminTenantMutationAccess(templateOrgId: string | null, user: UserPrincipal) {
    if (user.role === UserRole.SUPER_ADMIN) {
      return;
    }

    if (templateOrgId === null) {
      throw new ForbiddenException(
        'Chỉ Quản trị viên cấp cao (SUPER_ADMIN) mới có quyền chỉnh sửa, phát hành hoặc lưu trữ quy trình dùng chung toàn hệ thống.'
      );
    }

    if (user.organizationId !== templateOrgId) {
      throw new ForbiddenException('Bạn không có quyền thao tác trên quy trình của công ty/tổ chức khác.');
    }
  }

  /**
   * Kiểm tra quyền đọc của người dùng với template
   */
  private assertTenantAccess(templateOrgId: string | null, user: UserPrincipal) {
    if (user.role === UserRole.SUPER_ADMIN) {
      return;
    }

    if (templateOrgId && templateOrgId !== user.organizationId) {
      throw new ForbiddenException('Bạn không có quyền truy cập quy trình thuộc công ty/tổ chức khác.');
    }
  }

  /**
   * Tính mã băm SHA-256 chuẩn tắc của cấu hình các bước duyệt
   */
  private computeCanonicalContentHash(steps: any): string {
    const serialized = typeof steps === 'string' ? steps : canonicalizeJson(steps || []);
    return createHash('sha256').update(serialized).digest('hex');
  }
}
