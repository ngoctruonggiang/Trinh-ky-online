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
  validateTemplateSchema,
  validateFormData,
  FormFieldDefinition,
  LayoutBlock,
  DefaultWorkflowStep,
} from '@trinh-ky/shared';
import { CreateTemplateDto } from './dto/create-template.dto.js';
import { UpdateTemplateDto } from './dto/update-template.dto.js';
import { PublishTemplateDto } from './dto/publish-template.dto.js';
import { GetTemplatesQueryDto } from './dto/get-templates-query.dto.js';

@Injectable()
export class TemplateService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Lấy danh sách template theo phân quyền tổ chức và trạng thái
   */
  async getTemplates(user: UserPrincipal, query: GetTemplatesQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = {};

    // 1. Phân quyền tổ chức (Multi-Company Boundary)
    if (user.role === UserRole.SUPER_ADMIN) {
      // SUPER_ADMIN có thể xem toàn bộ mẫu hệ thống
    } else {
      // ADMIN và USER chỉ xem mẫu của công ty mình hoặc mẫu dùng chung toàn hệ thống
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
      // USER thông thường chỉ được xem các mẫu đã PUBLISHED để tạo hồ sơ
      where.status = TemplateStatus.PUBLISHED;
    } else if (query.status && query.status !== 'ALL') {
      where.status = query.status as TemplateStatus;
    }

    // 3. Lọc theo danh mục
    if (query.category) {
      where.category = query.category;
    }

    // 4. Tìm kiếm từ khóa theo title hoặc code
    if (query.search && query.search.trim()) {
      const search = query.search.trim();
      where.AND = where.AND || [];
      where.AND.push({
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    const [total, items] = await Promise.all([
      this.prisma.formTemplate.count({ where }),
      this.prisma.formTemplate.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ updatedAt: 'desc' }],
        include: {
          createdBy: {
            select: { id: true, fullName: true, email: true },
          },
          organization: {
            select: { id: true, name: true, code: true },
          },
        },
      }),
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        code: item.code,
        title: item.title,
        description: item.description,
        category: item.category,
        status: item.status,
        currentVersion: item.currentVersion,
        fieldCount: Array.isArray(item.fields) ? item.fields.length : 0,
        organizationId: item.organizationId,
        organizationName: item.organization?.name || 'Toàn tập đoàn (Chung)',
        createdById: item.createdById,
        createdByName: item.createdBy?.fullName || 'Hệ thống',
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Lấy chi tiết template kèm lịch sử phiên bản
   */
  async getTemplateById(id: string, user: UserPrincipal) {
    const template = await this.prisma.formTemplate.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: { id: true, fullName: true, email: true },
        },
        organization: {
          select: { id: true, name: true, code: true },
        },
        versions: {
          orderBy: { versionNumber: 'desc' },
          include: {
            createdByUser: {
              select: { id: true, fullName: true, email: true },
            },
          },
        },
      },
    });

    if (!template) {
      throw new NotFoundException('Không tìm thấy mẫu biểu mẫu được yêu cầu.');
    }

    // Kiểm tra quyền tổ chức
    this.assertTenantAccess(template.organizationId, user);

    // USER thông thường không được xem mẫu DRAFT của Admin
    if (user.role === UserRole.USER && template.status === TemplateStatus.DRAFT) {
      throw new ForbiddenException('Bạn không có quyền xem mẫu biểu mẫu đang ở trạng thái bản nháp.');
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
      fields: template.fields as unknown as FormFieldDefinition[],
      layoutBlocks: template.layoutBlocks as unknown as LayoutBlock[],
      defaultWorkflowSteps: template.defaultWorkflowSteps as unknown as DefaultWorkflowStep[],
      organizationId: template.organizationId,
      organizationName: template.organization?.name || 'Toàn tập đoàn (Chung)',
      createdById: template.createdById,
      createdByName: template.createdBy?.fullName || 'Hệ thống',
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      hasDraft: Boolean(draftVersion),
      draftVersion: draftVersion
        ? {
            id: draftVersion.id,
            versionNumber: draftVersion.versionNumber,
            title: draftVersion.title,
            description: draftVersion.description,
            fields: draftVersion.fields as unknown as FormFieldDefinition[],
            layoutBlocks: draftVersion.layoutBlocks as unknown as LayoutBlock[],
            changeSummary: draftVersion.changeSummary,
            createdAt: draftVersion.createdAt,
          }
        : null,
      versions: publishedVersions.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        title: v.title,
        changeSummary: v.changeSummary,
        status: v.status,
        createdByName: v.createdByUser?.fullName || 'Hệ thống',
        createdAt: v.createdAt,
        fieldCount: Array.isArray(v.fields) ? v.fields.length : 0,
      })),
    };
  }

  /**
   * Tạo template mới (chỉ ADMIN hoặc SUPER_ADMIN)
   */
  async createTemplate(dto: CreateTemplateDto, user: UserPrincipal) {
    this.assertAdminRole(user);

    // Xác thực tính hợp lệ của schema biểu mẫu
    const validation = validateTemplateSchema({
      code: dto.code,
      title: dto.title,
      fields: dto.fields,
    });

    if (!validation.valid) {
      throw new BadRequestException({
        message: 'Cấu hình schema biểu mẫu không hợp lệ.',
        errors: validation.errors,
      });
    }

    // Kiểm tra trùng mã code
    const existingCode = await this.prisma.formTemplate.findUnique({
      where: { code: dto.code.trim().toUpperCase() },
    });
    if (existingCode) {
      throw new ConflictException(`Mã biểu mẫu "${dto.code}" đã tồn tại trong hệ thống.`);
    }

    // Xác định organizationId: Nếu SUPER_ADMIN gửi organizationId thì dùng, còn ADMIN thì bắt buộc dùng user.organizationId
    let organizationId: string | null = null;
    if (user.role === UserRole.SUPER_ADMIN) {
      organizationId = dto.organizationId ?? null;
    } else {
      organizationId = user.organizationId;
    }

    const template = await this.prisma.formTemplate.create({
      data: {
        code: dto.code.trim().toUpperCase(),
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        category: dto.category || 'Hành chính - Nhân sự',
        status: TemplateStatus.DRAFT,
        currentVersion: 1,
        fields: dto.fields as any,
        layoutBlocks: (dto.layoutBlocks || []) as any,
        defaultWorkflowSteps: (dto.defaultWorkflowSteps || []) as any,
        createdById: user.id,
        organizationId,
      },
    });

    return {
      success: true,
      data: {
        id: template.id,
        code: template.code,
        title: template.title,
        status: template.status,
        currentVersion: template.currentVersion,
      },
    };
  }

  /**
   * Cập nhật template đang ở trạng thái DRAFT
   */
  async updateTemplate(id: string, dto: UpdateTemplateDto, user: UserPrincipal) {
    this.assertAdminRole(user);

    const template = await this.prisma.formTemplate.findUnique({ where: { id } });
    if (!template) {
      throw new NotFoundException('Không tìm thấy mẫu biểu mẫu để cập nhật.');
    }

    this.assertAdminTenantMutationAccess(template.organizationId, user);

    // Chỉ cho phép sửa trực tiếp khi template ở trạng thái DRAFT
    if (template.status !== TemplateStatus.DRAFT) {
      throw new BadRequestException(
        `Không thể sửa trực tiếp mẫu biểu mẫu đã ${template.status}. Vui lòng tạo bản nháp mới hoặc phát hành phiên bản mới.`
      );
    }

    // Nếu có cập nhật fields hoặc title, xác thực lại schema
    const updatedFields = dto.fields || (template.fields as unknown as FormFieldDefinition[]);
    const updatedTitle = dto.title || template.title;

    const validation = validateTemplateSchema({
      code: template.code,
      title: updatedTitle,
      fields: updatedFields,
    });

    if (!validation.valid) {
      throw new BadRequestException({
        message: 'Cấu hình schema biểu mẫu không hợp lệ.',
        errors: validation.errors,
      });
    }

    const updated = await this.prisma.formTemplate.update({
      where: { id },
      data: {
        title: dto.title ? dto.title.trim() : undefined,
        description: dto.description !== undefined ? dto.description : undefined,
        category: dto.category || undefined,
        fields: dto.fields ? (dto.fields as any) : undefined,
        layoutBlocks: dto.layoutBlocks ? (dto.layoutBlocks as any) : undefined,
        defaultWorkflowSteps: dto.defaultWorkflowSteps ? (dto.defaultWorkflowSteps as any) : undefined,
      },
    });

    return {
      success: true,
      data: {
        id: updated.id,
        title: updated.title,
        status: updated.status,
        currentVersion: updated.currentVersion,
      },
    };
  }

  /**
   * Tạo bản nháp cho phiên bản tiếp theo từ template đã PUBLISHED
   */
  async createDraftVersion(id: string, user: UserPrincipal) {
    this.assertAdminRole(user);

    const template = await this.prisma.formTemplate.findUnique({
      where: { id },
      include: {
        versions: {
          where: { status: TemplateStatus.DRAFT },
          take: 1,
        },
      },
    });

    if (!template) {
      throw new NotFoundException('Không tìm thấy mẫu biểu mẫu.');
    }

    this.assertAdminTenantMutationAccess(template.organizationId, user);

    if (template.status === TemplateStatus.ARCHIVED) {
      throw new BadRequestException('Không thể tạo bản nháp cho mẫu biểu mẫu đã lưu trữ.');
    }

    if (template.status === TemplateStatus.DRAFT) {
      // Đang là bản nháp đầu tiên (chưa từng xuất bản)
      return {
        success: true,
        data: {
          templateId: template.id,
          versionNumber: 1,
          isInitialDraft: true,
          fields: template.fields,
        },
      };
    }

    // Nếu đã có bản nháp tiếp theo đang dở dang thì trả về luôn bản nháp đó
    if (template.versions.length > 0) {
      const existingDraft = template.versions[0];
      return {
        success: true,
        data: {
          id: existingDraft.id,
          templateId: template.id,
          versionNumber: existingDraft.versionNumber,
          title: existingDraft.title,
          fields: existingDraft.fields,
          layoutBlocks: existingDraft.layoutBlocks,
          status: existingDraft.status,
          createdAt: existingDraft.createdAt,
        },
      };
    }

    // Tạo bản nháp FormTemplateVersion mới với versionNumber = currentVersion + 1
    const nextVersionNumber = template.currentVersion + 1;
    const newDraftVersion = await this.prisma.formTemplateVersion.create({
      data: {
        templateId: template.id,
        versionNumber: nextVersionNumber,
        title: template.title,
        description: template.description,
        fields: template.fields as any,
        layoutBlocks: template.layoutBlocks as any,
        defaultWorkflowSteps: template.defaultWorkflowSteps as any,
        changeSummary: `Bản nháp chuẩn bị cho phiên bản v${nextVersionNumber}`,
        status: TemplateStatus.DRAFT,
        createdById: user.id,
      },
    });

    return {
      success: true,
      data: {
        id: newDraftVersion.id,
        templateId: template.id,
        versionNumber: newDraftVersion.versionNumber,
        title: newDraftVersion.title,
        fields: newDraftVersion.fields,
        layoutBlocks: newDraftVersion.layoutBlocks,
        status: newDraftVersion.status,
        createdAt: newDraftVersion.createdAt,
      },
    };
  }

  /**
   * Lấy thông tin bản nháp của phiên bản tiếp theo
   */
  async getDraftVersion(id: string, user: UserPrincipal) {
    this.assertAdminRole(user);

    const template = await this.prisma.formTemplate.findUnique({
      where: { id },
      include: {
        versions: {
          where: { status: TemplateStatus.DRAFT },
          take: 1,
        },
      },
    });

    if (!template) {
      throw new NotFoundException('Không tìm thấy mẫu biểu mẫu.');
    }

    this.assertTenantAccess(template.organizationId, user);

    if (template.status === TemplateStatus.DRAFT) {
      return {
        id: template.id,
        versionNumber: 1,
        title: template.title,
        fields: template.fields,
        layoutBlocks: template.layoutBlocks,
        status: TemplateStatus.DRAFT,
      };
    }

    const draft = template.versions[0];
    if (!draft) {
      throw new NotFoundException('Không có bản nháp nào đang được chuẩn bị cho biểu mẫu này.');
    }

    return {
      id: draft.id,
      versionNumber: draft.versionNumber,
      title: draft.title,
      description: draft.description,
      fields: draft.fields,
      layoutBlocks: draft.layoutBlocks,
      status: draft.status,
      changeSummary: draft.changeSummary,
      createdAt: draft.createdAt,
    };
  }

  /**
   * Chỉnh sửa nội dung bản nháp cho phiên bản tiếp theo
   */
  async updateDraftVersion(id: string, dto: UpdateTemplateDto, user: UserPrincipal) {
    this.assertAdminRole(user);

    const template = await this.prisma.formTemplate.findUnique({
      where: { id },
      include: {
        versions: {
          where: { status: TemplateStatus.DRAFT },
          take: 1,
        },
      },
    });

    if (!template) {
      throw new NotFoundException('Không tìm thấy mẫu biểu mẫu để cập nhật.');
    }

    this.assertAdminTenantMutationAccess(template.organizationId, user);

    if (template.status === TemplateStatus.ARCHIVED) {
      throw new BadRequestException('Không thể chỉnh sửa mẫu biểu mẫu đã lưu trữ.');
    }

    // Nếu template đang ở DRAFT ban đầu
    if (template.status === TemplateStatus.DRAFT) {
      return this.updateTemplate(id, dto, user);
    }

    // Nếu template đã PUBLISHED, sửa trên bản nháp tiếp theo
    const draft = template.versions[0];
    if (!draft) {
      throw new NotFoundException('Chưa có bản nháp cho phiên bản tiếp theo. Vui lòng tạo bản nháp trước.');
    }

    const updatedFields = dto.fields || (draft.fields as unknown as FormFieldDefinition[]);
    const updatedTitle = dto.title || draft.title;

    const validation = validateTemplateSchema({
      code: template.code,
      title: updatedTitle,
      fields: updatedFields,
    });

    if (!validation.valid) {
      throw new BadRequestException({
        message: 'Cấu hình schema biểu mẫu không hợp lệ.',
        errors: validation.errors,
      });
    }

    const updatedDraft = await this.prisma.formTemplateVersion.update({
      where: { id: draft.id },
      data: {
        title: dto.title ? dto.title.trim() : undefined,
        description: dto.description !== undefined ? dto.description : undefined,
        fields: dto.fields ? (dto.fields as any) : undefined,
        layoutBlocks: dto.layoutBlocks ? (dto.layoutBlocks as any) : undefined,
        defaultWorkflowSteps: dto.defaultWorkflowSteps ? (dto.defaultWorkflowSteps as any) : undefined,
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

    const template = await this.prisma.formTemplate.findUnique({
      where: { id },
      include: {
        versions: {
          where: { status: TemplateStatus.DRAFT },
          take: 1,
        },
      },
    });

    if (!template) {
      throw new NotFoundException('Không tìm thấy mẫu biểu mẫu.');
    }

    this.assertAdminTenantMutationAccess(template.organizationId, user);

    if (template.status === TemplateStatus.DRAFT) {
      throw new BadRequestException('Không thể hủy bản nháp ban đầu của biểu mẫu chưa xuất bản.');
    }

    const draft = template.versions[0];
    if (!draft) {
      throw new NotFoundException('Không có bản nháp nào để hủy.');
    }

    await this.prisma.formTemplateVersion.delete({
      where: { id: draft.id },
    });

    return {
      success: true,
      message: 'Đã hủy bỏ bản nháp thành công.',
    };
  }

  /**
   * Phát hành template (DRAFT -> PUBLISHED hoặc phát hành bản nháp v2, v3...)
   * Hỗ trợ concurrency lock chống race condition khi nhiều request phát hành đồng thời
   */
  async publishTemplate(id: string, dto: PublishTemplateDto, user: UserPrincipal) {
    this.assertAdminRole(user);

    const template = await this.prisma.formTemplate.findUnique({
      where: { id },
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
    });

    if (!template) {
      throw new NotFoundException('Không tìm thấy mẫu biểu mẫu để phát hành.');
    }

    this.assertAdminTenantMutationAccess(template.organizationId, user);

    if (template.status === TemplateStatus.ARCHIVED) {
      throw new BadRequestException('Không thể phát hành mẫu biểu mẫu đã lưu trữ.');
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const currentTpl = await tx.formTemplate.findUnique({
          where: { id: template.id },
        });

        if (!currentTpl) {
          throw new NotFoundException('Không tìm thấy mẫu biểu mẫu trong giao dịch.');
        }

        if (currentTpl.status === TemplateStatus.ARCHIVED) {
          throw new BadRequestException('Không thể phát hành mẫu biểu mẫu đã lưu trữ.');
        }

        // Trường hợp 1: Phát hành v1 từ trạng thái DRAFT ban đầu
        if (currentTpl.status === TemplateStatus.DRAFT) {
          const validation = validateTemplateSchema({
            code: currentTpl.code,
            title: currentTpl.title,
            fields: currentTpl.fields as unknown as FormFieldDefinition[],
          });

          if (!validation.valid) {
            throw new BadRequestException({
              message: 'Không thể phát hành biểu mẫu do schema chưa hợp lệ.',
              errors: validation.errors,
            });
          }

          const versionRecord = await tx.formTemplateVersion.create({
            data: {
              templateId: currentTpl.id,
              versionNumber: 1,
              title: currentTpl.title,
              description: currentTpl.description,
              fields: currentTpl.fields as any,
              layoutBlocks: currentTpl.layoutBlocks as any,
              defaultWorkflowSteps: currentTpl.defaultWorkflowSteps as any,
              changeSummary: dto.changeSummary || 'Phát hành phiên bản đầu tiên (v1)',
              status: TemplateStatus.PUBLISHED,
              createdById: user.id,
            },
          });

          const updatedTemplate = await tx.formTemplate.update({
            where: { id: currentTpl.id },
            data: {
              status: TemplateStatus.PUBLISHED,
              currentVersion: 1,
            },
          });

          return { updatedTemplate, versionRecord };
        }

        // Trường hợp 2: Template đã PUBLISHED -> Kiểm tra có bản nháp DRAFT nào không
        const draft = await tx.formTemplateVersion.findFirst({
          where: { templateId: currentTpl.id, status: TemplateStatus.DRAFT },
          orderBy: { versionNumber: 'desc' },
        });

        if (draft) {
          if (draft.versionNumber <= currentTpl.currentVersion) {
            throw new ConflictException(`Xung đột tương tranh: Phiên bản v${draft.versionNumber} đã được phát hành bởi phiên làm việc khác.`);
          }

          const validation = validateTemplateSchema({
            code: currentTpl.code,
            title: draft.title,
            fields: draft.fields as unknown as FormFieldDefinition[],
          });

          if (!validation.valid) {
            throw new BadRequestException({
              message: 'Bản nháp không thể phát hành do schema chưa hợp lệ.',
              errors: validation.errors,
            });
          }

          const versionRecord = await tx.formTemplateVersion.update({
            where: { id: draft.id },
            data: {
              status: TemplateStatus.PUBLISHED,
              changeSummary: dto.changeSummary || `Phát hành phiên bản v${draft.versionNumber}`,
            },
          });

          const updatedTemplate = await tx.formTemplate.update({
            where: { id: currentTpl.id },
            data: {
              currentVersion: draft.versionNumber,
              fields: draft.fields as any,
              layoutBlocks: draft.layoutBlocks as any,
              defaultWorkflowSteps: draft.defaultWorkflowSteps as any,
              title: draft.title,
            },
          });

          return { updatedTemplate, versionRecord };
        }

        // Trường hợp 3: Phát hành trực tiếp phiên bản tiếp theo
        const nextVersionNumber = currentTpl.currentVersion + 1;
        const publishFields = (dto as any).fields || currentTpl.fields;
        const publishTitle = (dto as any).title || currentTpl.title;

        const val = validateTemplateSchema({
          code: currentTpl.code,
          title: publishTitle,
          fields: publishFields as any,
        });

        if (!val.valid) {
          throw new BadRequestException({
            message: 'Schema biểu mẫu xuất bản không hợp lệ.',
            errors: val.errors,
          });
        }

        const versionRecord = await tx.formTemplateVersion.create({
          data: {
            templateId: currentTpl.id,
            versionNumber: nextVersionNumber,
            title: publishTitle,
            description: currentTpl.description,
            fields: publishFields as any,
            layoutBlocks: currentTpl.layoutBlocks as any,
            defaultWorkflowSteps: currentTpl.defaultWorkflowSteps as any,
            changeSummary: dto.changeSummary || `Phát hành phiên bản v${nextVersionNumber}`,
            status: TemplateStatus.PUBLISHED,
            createdById: user.id,
          },
        });

        const updatedTemplate = await tx.formTemplate.update({
          where: { id: currentTpl.id },
          data: {
            currentVersion: nextVersionNumber,
            fields: publishFields as any,
            title: publishTitle,
          },
        });

        return { updatedTemplate, versionRecord };
      });

      return {
        success: true,
        data: {
          id: result.updatedTemplate.id,
          status: result.updatedTemplate.status,
          versionNumber: result.versionRecord.versionNumber,
          versionId: result.versionRecord.id,
        },
      };
    } catch (err: any) {
      if (
        err instanceof ConflictException ||
        err instanceof BadRequestException ||
        err instanceof ForbiddenException ||
        err instanceof NotFoundException
      ) {
        throw err;
      }
      if (err.code === 'P2002') {
        throw new ConflictException('Xung đột tương tranh: Phiên bản này đang được phát hành bởi một yêu cầu khác.');
      }
      throw err;
    }
  }

  /**
   * Lưu trữ template (ngừng sử dụng để tạo hồ sơ mới)
   */
  async archiveTemplate(id: string, user: UserPrincipal) {
    this.assertAdminRole(user);

    const template = await this.prisma.formTemplate.findUnique({ where: { id } });
    if (!template) {
      throw new NotFoundException('Không tìm thấy mẫu biểu mẫu để lưu trữ.');
    }

    this.assertAdminTenantMutationAccess(template.organizationId, user);

    const updated = await this.prisma.formTemplate.update({
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
   * Xác thực formData trước khi submit hồ sơ
   */
  async validateFormDataForTemplate(
    templateId: string,
    formData: Record<string, any>,
    user: UserPrincipal
  ) {
    const template = await this.prisma.formTemplate.findUnique({
      where: { id: templateId },
      select: {
        id: true,
        organizationId: true,
        status: true,
        fields: true,
      },
    });

    if (!template) {
      throw new NotFoundException('Không tìm thấy mẫu biểu mẫu.');
    }

    this.assertTenantAccess(template.organizationId, user);

    const fields = template.fields as unknown as FormFieldDefinition[];
    const result = validateFormData(fields, formData);

    return result;
  }

  // --- Helpers kiểm tra phân quyền ---

  private assertAdminRole(user: UserPrincipal) {
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Chỉ Quản trị viên (ADMIN hoặc SUPER_ADMIN) mới có quyền thao tác quản lý mẫu biểu mẫu.');
    }
  }

  private assertTenantAccess(templateOrgId: string | null, user: UserPrincipal) {
    if (user.role === UserRole.SUPER_ADMIN) return;
    if (templateOrgId && templateOrgId !== user.organizationId) {
      throw new ForbiddenException('Bạn không có quyền truy cập mẫu biểu mẫu của tổ chức khác.');
    }
  }

  private assertAdminTenantMutationAccess(templateOrgId: string | null, user: UserPrincipal) {
    if (user.role === UserRole.SUPER_ADMIN) return;
    if (templateOrgId === null) {
      throw new ForbiddenException('Chỉ Quản trị viên cấp cao (SUPER_ADMIN) mới có quyền quản trị biểu mẫu dùng chung toàn hệ thống.');
    }
    if (templateOrgId !== user.organizationId) {
      throw new ForbiddenException('Bạn không có quyền thao tác trên mẫu biểu mẫu của tổ chức khác.');
    }
  }
}
