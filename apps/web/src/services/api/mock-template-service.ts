import {
  TemplateSummary,
  TemplateDetail,
  CreateTemplatePayload,
  UpdateTemplatePayload,
  PublishTemplatePayload,
  DraftVersionDetail,
} from '@/types/template';
import { ITemplateService, GetTemplatesQuery } from './template-service.interface';
import { validateFormData, validateTemplateSchema, FormFieldDefinition } from '@trinh-ky/shared';

const INITIAL_MOCK_TEMPLATES: TemplateDetail[] = [
  {
    id: 'mock-tmpl-01',
    code: 'TAM_UNG',
    title: 'Giấy đề nghị tạm ứng kinh phí công tác',
    description: 'Áp dụng cho cán bộ nhân viên xin tạm ứng chi phí trước chuyến công tác',
    category: 'Tài chính - Kế toán',
    status: 'PUBLISHED',
    currentVersion: 1,
    organizationId: 'org-01',
    organizationName: 'Tập đoàn VinaGroup (HQ)',
    createdById: 'user-admin-01',
    createdByName: 'Nguyễn Quản Trị',
    createdAt: '2026-10-15T08:00:00.000Z',
    updatedAt: '2026-10-15T09:30:00.000Z',
    fields: [
      {
        id: 'f1',
        key: 'so_tien',
        label: 'Số tiền tạm ứng (VNĐ)',
        type: 'number',
        required: true,
        order: 1,
        placeholder: 'Ví dụ: 5000000',
        helpText: 'Tối thiểu 100.000 VNĐ, tối đa 50.000.000 VNĐ',
        validation: { min: 100000, max: 50000000 },
      },
      {
        id: 'f2',
        key: 'ly_do',
        label: 'Lý do & Nội dung công tác',
        type: 'textarea',
        required: true,
        order: 2,
        placeholder: 'Nêu rõ địa điểm, mục đích và thời gian công tác...',
      },
      {
        id: 'f3',
        key: 'phuong_tien',
        label: 'Phương tiện di chuyển',
        type: 'select',
        required: true,
        order: 3,
        options: [
          { label: 'Máy bay', value: 'MAY_BAY' },
          { label: 'Tàu hỏa', value: 'TAU_HOA' },
          { label: 'Xe công ty', value: 'XE_CONG_TY' },
          { label: 'Tự túc xe cá nhân', value: 'TU_TUC' },
        ],
      },
      {
        id: 'f4',
        key: 'ngay_khoi_hanh',
        label: 'Ngày bắt đầu công tác',
        type: 'date',
        required: true,
        order: 4,
      },
      {
        id: 'f5',
        key: 'email_lien_he',
        label: 'Email liên hệ khi đi công tác',
        type: 'email',
        required: false,
        order: 5,
        placeholder: 'name@vinagroup.vn',
      },
    ],
    defaultWorkflowSteps: [
      {
        stepOrder: 1,
        stepName: 'Trưởng phòng phê duyệt',
        stepType: 'SEQUENTIAL',
        completionRule: 'ALL_MUST_APPROVE',
      },
      {
        stepOrder: 2,
        stepName: 'Kế toán trưởng thẩm tra',
        stepType: 'SEQUENTIAL',
        completionRule: 'ALL_MUST_APPROVE',
      },
    ],
    versions: [
      {
        id: 'mock-ver-01',
        versionNumber: 1,
        title: 'Giấy đề nghị tạm ứng kinh phí công tác',
        changeSummary: 'Phát hành chính thức v1',
        status: 'PUBLISHED',
        createdByName: 'Nguyễn Quản Trị',
        createdAt: '2026-10-15T09:30:00.000Z',
        fieldCount: 5,
      },
    ],
  },
  {
    id: 'mock-tmpl-02',
    code: 'NGHI_PHEP',
    title: 'Đơn xin nghỉ phép năm',
    description: 'Áp dụng cho nhân viên xin nghỉ phép năm, nghỉ việc riêng có lương hoặc không lương',
    category: 'Hành chính - Nhân sự',
    status: 'PUBLISHED',
    currentVersion: 1,
    organizationId: 'org-01',
    organizationName: 'Tập đoàn VinaGroup (HQ)',
    createdById: 'user-admin-01',
    createdByName: 'Nguyễn Quản Trị',
    createdAt: '2026-10-16T10:00:00.000Z',
    updatedAt: '2026-10-16T10:00:00.000Z',
    fields: [
      {
        id: 'f2_1',
        key: 'loai_nghi',
        label: 'Loại nghỉ phép',
        type: 'select',
        required: true,
        order: 1,
        options: [
          { label: 'Nghỉ phép năm', value: 'PHEP_NAM' },
          { label: 'Nghỉ ốm / thai sản', value: 'OM_THAI_SAN' },
          { label: 'Nghỉ việc riêng hưởng lương', value: 'VIEC_RIENG' },
          { label: 'Nghỉ không hưởng lương', value: 'KHONG_LUONG' },
        ],
      },
      {
        id: 'f2_2',
        key: 'so_ngay_nghi',
        label: 'Số ngày xin nghỉ',
        type: 'number',
        required: true,
        order: 2,
        validation: { min: 0.5, max: 30 },
      },
      {
        id: 'f2_3',
        key: 'ngay_bat_dau',
        label: 'Từ ngày',
        type: 'date',
        required: true,
        order: 3,
      },
      {
        id: 'f2_4',
        key: 'ly_do_nghi',
        label: 'Lý do nghỉ cụ thể',
        type: 'textarea',
        required: true,
        order: 4,
      },
      {
        id: 'f2_5',
        key: 'ban_giao_cong_viec',
        label: 'Người nhận bàn giao công việc',
        type: 'text',
        required: true,
        order: 5,
        placeholder: 'Họ tên đồng nghiệp hỗ trợ công việc...',
      },
    ],
    defaultWorkflowSteps: [
      {
        stepOrder: 1,
        stepName: 'Quản lý trực tiếp duyệt',
        stepType: 'SEQUENTIAL',
        completionRule: 'ALL_MUST_APPROVE',
      },
    ],
    versions: [
      {
        id: 'mock-ver-02',
        versionNumber: 1,
        title: 'Đơn xin nghỉ phép năm',
        changeSummary: 'Phát hành chính thức v1',
        status: 'PUBLISHED',
        createdByName: 'Nguyễn Quản Trị',
        createdAt: '2026-10-16T10:00:00.000Z',
        fieldCount: 5,
      },
    ],
  },
  {
    id: 'mock-tmpl-03',
    code: 'MUA_SAM_TB',
    title: 'Đề xuất mua sắm trang thiết bị làm việc',
    description: 'Trang thiết bị văn phòng, máy tính, màn hình phục vụ công việc',
    category: 'Vật tư - Thiết bị',
    status: 'DRAFT',
    currentVersion: 1,
    organizationId: 'org-01',
    organizationName: 'Tập đoàn VinaGroup (HQ)',
    createdById: 'user-admin-01',
    createdByName: 'Nguyễn Quản Trị',
    createdAt: '2026-10-18T14:00:00.000Z',
    updatedAt: '2026-10-18T14:00:00.000Z',
    fields: [
      {
        id: 'f3_1',
        key: 'ten_thiet_bi',
        label: 'Tên thiết bị cần mua',
        type: 'text',
        required: true,
        order: 1,
      },
      {
        id: 'f3_2',
        key: 'so_luong',
        label: 'Số lượng',
        type: 'number',
        required: true,
        order: 2,
        validation: { min: 1, max: 100 },
      },
      {
        id: 'f3_3',
        key: 'don_gia_du_kien',
        label: 'Đơn giá dự kiến (VNĐ)',
        type: 'number',
        required: true,
        order: 3,
      },
    ],
    versions: [],
  },
];

export class MockTemplateService implements ITemplateService {
  private templates: TemplateDetail[] = JSON.parse(JSON.stringify(INITIAL_MOCK_TEMPLATES));

  public async getTemplates(
    query: GetTemplatesQuery = {}
  ): Promise<{ items: TemplateSummary[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
    let filtered = [...this.templates];

    if (query.status && query.status !== 'ALL') {
      filtered = filtered.filter((t) => t.status === query.status);
    }

    if (query.category) {
      filtered = filtered.filter((t) => t.category === query.category);
    }

    if (query.search && query.search.trim()) {
      const s = query.search.toLowerCase();
      filtered = filtered.filter(
        (t) => t.title.toLowerCase().includes(s) || t.code.toLowerCase().includes(s)
      );
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const total = filtered.length;
    const start = (page - 1) * limit;
    const paginated = filtered.slice(start, start + limit);

    const items: TemplateSummary[] = paginated.map((t) => ({
      id: t.id,
      code: t.code,
      title: t.title,
      description: t.description,
      category: t.category,
      status: t.status,
      currentVersion: t.currentVersion,
      fieldCount: t.fields.length,
      organizationId: t.organizationId,
      organizationName: t.organizationName,
      createdById: t.createdById,
      createdByName: t.createdByName,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));

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

  public async getTemplateById(id: string): Promise<TemplateDetail> {
    const template = this.templates.find((t) => t.id === id);
    if (!template) {
      throw new Error(`Không tìm thấy mẫu biểu mẫu với id: ${id}`);
    }
    return JSON.parse(JSON.stringify(template));
  }

  public async createTemplate(
    payload: CreateTemplatePayload
  ): Promise<{ id: string; code: string; title: string }> {
    const validation = validateTemplateSchema(payload);
    if (!validation.valid) {
      throw new Error(`Schema không hợp lệ: ${validation.errors.join(', ')}`);
    }

    const newId = `mock-tmpl-${Date.now()}`;
    const newTemplate: TemplateDetail = {
      id: newId,
      code: payload.code.toUpperCase(),
      title: payload.title,
      description: payload.description || null,
      category: payload.category || 'Hành chính - Nhân sự',
      status: 'DRAFT',
      currentVersion: 1,
      fields: payload.fields,
      layoutBlocks: payload.layoutBlocks || [],
      defaultWorkflowSteps: payload.defaultWorkflowSteps || [],
      organizationId: payload.organizationId || 'org-01',
      organizationName: 'Tập đoàn VinaGroup (HQ)',
      createdById: 'current-user',
      createdByName: 'Người dùng hiện tại',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      versions: [],
    };

    this.templates.unshift(newTemplate);
    return { id: newId, code: newTemplate.code, title: newTemplate.title };
  }

  public async updateTemplate(
    id: string,
    payload: UpdateTemplatePayload
  ): Promise<{ id: string; title: string }> {
    const template = this.templates.find((t) => t.id === id);
    if (!template) {
      throw new Error(`Không tìm thấy template: ${id}`);
    }
    if (template.status !== 'DRAFT') {
      throw new Error('Chỉ có thể sửa template ở trạng thái DRAFT');
    }

    if (payload.title) template.title = payload.title;
    if (payload.description !== undefined) template.description = payload.description;
    if (payload.category) template.category = payload.category;
    if (payload.fields) template.fields = payload.fields;
    if (payload.layoutBlocks) template.layoutBlocks = payload.layoutBlocks;
    if (payload.defaultWorkflowSteps) template.defaultWorkflowSteps = payload.defaultWorkflowSteps;
    template.updatedAt = new Date().toISOString();

    return { id: template.id, title: template.title };
  }

  public async publishTemplate(
    id: string,
    payload?: PublishTemplatePayload
  ): Promise<{ id: string; versionNumber: number; versionId: string }> {
    const template = this.templates.find((t) => t.id === id);
    if (!template) {
      throw new Error(`Không tìm thấy template: ${id}`);
    }

    let nextVer = 1;
    let publishedFields = template.fields;
    let publishedTitle = template.title;
    let publishedBlocks = template.layoutBlocks;

    if (template.draftVersion) {
      nextVer = template.draftVersion.versionNumber;
      publishedFields = template.draftVersion.fields;
      publishedTitle = template.draftVersion.title;
      publishedBlocks = template.draftVersion.layoutBlocks || [];
      template.fields = publishedFields;
      template.title = publishedTitle;
      template.layoutBlocks = publishedBlocks;
      template.hasDraft = false;
      template.draftVersion = null;
    } else if (template.status === 'PUBLISHED') {
      nextVer = template.currentVersion + 1;
    }

    template.status = 'PUBLISHED';
    template.currentVersion = nextVer;
    template.updatedAt = new Date().toISOString();

    const verId = `mock-ver-${Date.now()}`;
    template.versions.unshift({
      id: verId,
      versionNumber: nextVer,
      title: publishedTitle,
      changeSummary: payload?.changeSummary || `Phiên bản v${nextVer}`,
      status: 'PUBLISHED',
      createdByName: 'Admin',
      createdAt: new Date().toISOString(),
      fieldCount: publishedFields.length,
    });

    return { id: template.id, versionNumber: nextVer, versionId: verId };
  }

  public async archiveTemplate(id: string): Promise<{ id: string; status: string }> {
    const template = this.templates.find((t) => t.id === id);
    if (!template) {
      throw new Error(`Không tìm thấy template: ${id}`);
    }
    template.status = 'ARCHIVED';
    template.updatedAt = new Date().toISOString();
    return { id: template.id, status: template.status };
  }

  public async validateFormData(
    templateId: string,
    formData: Record<string, any>
  ): Promise<{ valid: boolean; errors: Record<string, string> }> {
    const template = await this.getTemplateById(templateId);
    return validateFormData(template.fields, formData);
  }

  public async createDraftVersion(
    templateId: string
  ): Promise<{ id: string; versionNumber: number; title: string; status: string }> {
    const template = this.templates.find((t) => t.id === templateId);
    if (!template) {
      throw new Error(`Không tìm thấy template: ${templateId}`);
    }
    if (template.status === 'ARCHIVED') {
      throw new Error('Không thể tạo bản nháp cho mẫu đã lưu trữ');
    }
    if (template.draftVersion) {
      return {
        id: template.draftVersion.id,
        versionNumber: template.draftVersion.versionNumber,
        title: template.draftVersion.title,
        status: 'DRAFT',
      };
    }

    const nextVer = template.currentVersion + 1;
    const draft: DraftVersionDetail = {
      id: `mock-draft-${Date.now()}`,
      templateId: template.id,
      versionNumber: nextVer,
      title: template.title,
      description: template.description,
      fields: JSON.parse(JSON.stringify(template.fields)),
      layoutBlocks: JSON.parse(JSON.stringify(template.layoutBlocks || [])),
      defaultWorkflowSteps: JSON.parse(JSON.stringify(template.defaultWorkflowSteps || [])),
      status: 'DRAFT',
      changeSummary: `Bản nháp chuẩn bị cho phiên bản v${nextVer}`,
      createdAt: new Date().toISOString(),
    };
    template.hasDraft = true;
    template.draftVersion = draft;

    return {
      id: draft.id,
      versionNumber: draft.versionNumber,
      title: draft.title,
      status: 'DRAFT',
    };
  }

  public async getDraftVersion(templateId: string): Promise<DraftVersionDetail> {
    const template = this.templates.find((t) => t.id === templateId);
    if (!template) {
      throw new Error(`Không tìm thấy template: ${templateId}`);
    }
    if (template.status === 'DRAFT') {
      return {
        id: template.id,
        templateId: template.id,
        versionNumber: 1,
        title: template.title,
        description: template.description,
        fields: template.fields,
        layoutBlocks: template.layoutBlocks,
        defaultWorkflowSteps: template.defaultWorkflowSteps,
        status: 'DRAFT',
        createdAt: template.createdAt,
      };
    }
    if (!template.draftVersion) {
      throw new Error('Không có bản nháp nào đang được chuẩn bị cho biểu mẫu này.');
    }
    return JSON.parse(JSON.stringify(template.draftVersion));
  }

  public async updateDraftVersion(
    templateId: string,
    payload: UpdateTemplatePayload
  ): Promise<{ id: string; versionNumber: number; title: string; status: string }> {
    const template = this.templates.find((t) => t.id === templateId);
    if (!template) {
      throw new Error(`Không tìm thấy template: ${templateId}`);
    }
    if (template.status === 'DRAFT') {
      await this.updateTemplate(templateId, payload);
      return {
        id: template.id,
        versionNumber: 1,
        title: template.title,
        status: 'DRAFT',
      };
    }
    if (!template.draftVersion) {
      throw new Error('Chưa có bản nháp cho phiên bản tiếp theo.');
    }

    if (payload.title) template.draftVersion.title = payload.title;
    if (payload.description !== undefined) template.draftVersion.description = payload.description;
    if (payload.fields) template.draftVersion.fields = payload.fields;
    if (payload.layoutBlocks) template.draftVersion.layoutBlocks = payload.layoutBlocks;
    if (payload.defaultWorkflowSteps) template.draftVersion.defaultWorkflowSteps = payload.defaultWorkflowSteps;

    return {
      id: template.draftVersion.id,
      versionNumber: template.draftVersion.versionNumber,
      title: template.draftVersion.title,
      status: 'DRAFT',
    };
  }

  public async discardDraftVersion(
    templateId: string
  ): Promise<{ success: boolean; message: string }> {
    const template = this.templates.find((t) => t.id === templateId);
    if (!template) {
      throw new Error(`Không tìm thấy template: ${templateId}`);
    }
    if (template.status === 'DRAFT') {
      throw new Error('Không thể hủy bản nháp ban đầu của biểu mẫu chưa xuất bản.');
    }
    if (!template.draftVersion) {
      throw new Error('Không có bản nháp nào để hủy.');
    }
    template.hasDraft = false;
    template.draftVersion = null;

    return {
      success: true,
      message: 'Đã hủy bỏ bản nháp thành công.',
    };
  }
}
