import {
  WorkflowTemplateSummary,
  WorkflowTemplateDetail,
  CreateWorkflowTemplatePayload,
  UpdateWorkflowTemplatePayload,
  PublishWorkflowTemplatePayload,
  DraftWorkflowVersionDetail,
  GetWorkflowTemplatesParams,
} from '@/types/workflow-template';
import { IWorkflowTemplateService } from './workflow-template-service.interface';
import { WorkflowStepConfig } from '@trinh-ky/shared';

const INITIAL_MOCK_WORKFLOWS: WorkflowTemplateDetail[] = [
  {
    id: 'wf-mock-01',
    code: 'WF_EXPENSE',
    title: 'Quy trình phê duyệt chi phí & tạm ứng ngân sách',
    description: 'Áp dụng cho mọi khoản tạm ứng và thanh toán chi phí trên 5.000.000 VNĐ',
    category: 'Tài chính',
    status: 'PUBLISHED',
    currentVersion: 1,
    steps: [
      {
        stepKey: 'step_mgr',
        stepName: 'Trưởng phòng chuyên môn duyệt',
        stepOrder: 1,
        stepType: 'SEQUENTIAL',
        completionRule: 'ALL_MUST_APPROVE',
        approverConfig: {
          type: 'DEPARTMENT_ROLE',
          role: 'MANAGER',
          departmentPolicy: 'SAME_AS_DOCUMENT',
        },
        reviewerUserIds: [],
        description: 'Kiểm tra tính cần thiết và kế hoạch ngân sách của phòng',
      },
      {
        stepKey: 'step_dir',
        stepName: 'Ban Giám đốc phê duyệt',
        stepOrder: 2,
        stepType: 'SEQUENTIAL',
        completionRule: 'ANY_CAN_APPROVE',
        approverConfig: {
          type: 'ORGANIZATION_ROLE',
          role: 'DIRECTOR',
        },
        reviewerUserIds: [],
        description: 'Duyệt chủ trương chi tiêu và hạn mức ngân sách',
      },
      {
        stepKey: 'step_acc',
        stepName: 'Kế toán trưởng kiểm soát',
        stepOrder: 3,
        stepType: 'SEQUENTIAL',
        completionRule: 'ALL_MUST_APPROVE',
        approverConfig: {
          type: 'ORGANIZATION_ROLE',
          role: 'ACCOUNTANT',
        },
        reviewerUserIds: [],
        description: 'Kiểm tra chứng từ và lập lệnh chi',
      },
    ],
    organizationId: null,
    organizationName: 'Toàn tập đoàn (Chung)',
    createdById: 'admin-01',
    createdByName: 'Admin Hệ Thống',
    createdAt: '2026-10-01T08:00:00Z',
    updatedAt: '2026-10-15T09:30:00Z',
    hasDraft: false,
    draftVersion: null,
    versions: [
      {
        id: 'ver-wf-01-v1',
        versionNumber: 1,
        title: 'Quy trình phê duyệt chi phí & tạm ứng ngân sách',
        changeSummary: 'Phát hành phiên bản chuẩn hóa ban đầu',
        status: 'PUBLISHED',
        createdByName: 'Admin Hệ Thống',
        createdAt: '2026-10-01T08:00:00Z',
        stepCount: 3,
      },
    ],
  },
  {
    id: 'wf-mock-02',
    code: 'WF_LEAVE',
    title: 'Quy trình xin nghỉ phép & công tác',
    description: 'Quy trình xét duyệt nghỉ phép năm, nghỉ chế độ và đi công tác ngoài tỉnh',
    category: 'Nhân sự',
    status: 'PUBLISHED',
    currentVersion: 2,
    steps: [
      {
        stepKey: 'step_mgr',
        stepName: 'Quản lý trực tiếp phê duyệt',
        stepOrder: 1,
        stepType: 'SEQUENTIAL',
        completionRule: 'ALL_MUST_APPROVE',
        approverConfig: {
          type: 'DEPARTMENT_ROLE',
          role: 'MANAGER',
          departmentPolicy: 'SAME_AS_DOCUMENT',
        },
        reviewerUserIds: [],
      },
      {
        stepKey: 'step_hr',
        stepName: 'Phòng Nhân sự xác nhận ngày phép',
        stepOrder: 2,
        stepType: 'SEQUENTIAL',
        completionRule: 'ANY_CAN_APPROVE',
        approverConfig: {
          type: 'ORGANIZATION_ROLE',
          role: 'ADMIN',
        },
        reviewerUserIds: [],
      },
    ],
    organizationId: null,
    organizationName: 'Toàn tập đoàn (Chung)',
    createdById: 'admin-01',
    createdByName: 'Admin Hệ Thống',
    createdAt: '2026-09-15T08:00:00Z',
    updatedAt: '2026-10-18T10:00:00Z',
    hasDraft: false,
    draftVersion: null,
    versions: [
      {
        id: 'ver-wf-02-v1',
        versionNumber: 1,
        title: 'Quy trình nghỉ phép v1',
        changeSummary: 'Khởi tạo quy trình',
        status: 'PUBLISHED',
        createdByName: 'Admin Hệ Thống',
        createdAt: '2026-09-15T08:00:00Z',
        stepCount: 1,
      },
      {
        id: 'ver-wf-02-v2',
        versionNumber: 2,
        title: 'Quy trình xin nghỉ phép & công tác',
        changeSummary: 'Bổ sung bước xác nhận phòng Nhân sự',
        status: 'PUBLISHED',
        createdByName: 'Admin Hệ Thống',
        createdAt: '2026-10-18T10:00:00Z',
        stepCount: 2,
      },
    ],
  },
];

export class MockWorkflowTemplateService implements IWorkflowTemplateService {
  private templates: WorkflowTemplateDetail[] = JSON.parse(JSON.stringify(INITIAL_MOCK_WORKFLOWS));

  async getWorkflowTemplates(query?: GetWorkflowTemplatesParams): Promise<{
    items: WorkflowTemplateSummary[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    let filtered = [...this.templates];

    if (query?.status && query.status !== 'ALL') {
      filtered = filtered.filter((t) => t.status === query.status);
    }
    if (query?.category) {
      filtered = filtered.filter((t) => t.category === query.category);
    }
    if (query?.search) {
      const s = query.search.toLowerCase();
      filtered = filtered.filter(
        (t) => t.title.toLowerCase().includes(s) || t.code.toLowerCase().includes(s)
      );
    }

    const page = query?.page || 1;
    const limit = query?.limit || 20;
    const total = filtered.length;
    const start = (page - 1) * limit;
    const items = filtered.slice(start, start + limit).map((t) => ({
      id: t.id,
      code: t.code,
      title: t.title,
      description: t.description,
      category: t.category,
      status: t.status,
      currentVersion: t.currentVersion,
      stepCount: t.steps.length,
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

  async getWorkflowTemplateById(id: string): Promise<WorkflowTemplateDetail> {
    const found = this.templates.find((t) => t.id === id);
    if (!found) {
      throw new Error(`Không tìm thấy quy trình với id: ${id}`);
    }
    return JSON.parse(JSON.stringify(found));
  }

  async createWorkflowTemplate(
    payload: CreateWorkflowTemplatePayload
  ): Promise<{ id: string; code: string; title: string }> {
    const newId = `wf-mock-${Date.now()}`;
    const newTemplate: WorkflowTemplateDetail = {
      id: newId,
      code: payload.code.toUpperCase(),
      title: payload.title,
      description: payload.description || null,
      category: payload.category || 'Chung',
      status: 'DRAFT',
      currentVersion: 1,
      steps: payload.steps,
      organizationId: payload.organizationId || null,
      organizationName: 'Toàn tập đoàn (Chung)',
      createdById: 'mock-user-01',
      createdByName: 'Quản trị viên',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      hasDraft: false,
      draftVersion: null,
      versions: [],
    };

    this.templates.unshift(newTemplate);
    return { id: newId, code: newTemplate.code, title: newTemplate.title };
  }

  async updateWorkflowTemplate(
    id: string,
    payload: UpdateWorkflowTemplatePayload
  ): Promise<{ id: string; title: string }> {
    const found = this.templates.find((t) => t.id === id);
    if (!found) throw new Error('Không tìm thấy quy trình');
    if (payload.title) found.title = payload.title;
    if (payload.description !== undefined) found.description = payload.description;
    if (payload.category) found.category = payload.category;
    if (payload.steps) found.steps = payload.steps;
    found.updatedAt = new Date().toISOString();
    return { id: found.id, title: found.title };
  }

  async publishWorkflowTemplate(
    id: string,
    payload?: PublishWorkflowTemplatePayload
  ): Promise<{ id: string; versionNumber: number; versionId: string; status: string }> {
    const found = this.templates.find((t) => t.id === id);
    if (!found) throw new Error('Không tìm thấy quy trình');

    if (found.status === 'DRAFT') {
      found.status = 'PUBLISHED';
      found.currentVersion = 1;
      const vId = `ver-${found.id}-v1`;
      found.versions = [
        {
          id: vId,
          versionNumber: 1,
          title: found.title,
          changeSummary: payload?.changeSummary || payload?.releaseNotes || 'Phát hành v1',
          status: 'PUBLISHED',
          createdByName: 'Quản trị viên',
          createdAt: new Date().toISOString(),
          stepCount: found.steps.length,
        },
      ];
      return { id: found.id, versionNumber: 1, versionId: vId, status: 'PUBLISHED' };
    }

    if (found.draftVersion) {
      const vNum = found.draftVersion.versionNumber;
      found.currentVersion = vNum;
      found.title = found.draftVersion.title;
      found.steps = found.draftVersion.steps;
      const vId = `ver-${found.id}-v${vNum}`;
      found.versions.unshift({
        id: vId,
        versionNumber: vNum,
        title: found.draftVersion.title,
        changeSummary: payload?.changeSummary || payload?.releaseNotes || found.draftVersion.changeSummary,
        status: 'PUBLISHED',
        createdByName: 'Quản trị viên',
        createdAt: new Date().toISOString(),
        stepCount: found.steps.length,
      });
      found.draftVersion = null;
      found.hasDraft = false;
      return { id: found.id, versionNumber: vNum, versionId: vId, status: 'PUBLISHED' };
    }

    return { id: found.id, versionNumber: found.currentVersion, versionId: 'v-current', status: 'PUBLISHED' };
  }

  async archiveWorkflowTemplate(id: string): Promise<{ id: string; status: string }> {
    const found = this.templates.find((t) => t.id === id);
    if (!found) throw new Error('Không tìm thấy quy trình');
    found.status = 'ARCHIVED';
    return { id: found.id, status: 'ARCHIVED' };
  }

  async createDraftVersion(
    id: string
  ): Promise<{ id: string; versionNumber: number; title: string; status: string }> {
    const found = this.templates.find((t) => t.id === id);
    if (!found) throw new Error('Không tìm thấy quy trình');

    const nextVer = found.currentVersion + 1;
    found.hasDraft = true;
    found.draftVersion = {
      id: `draft-${found.id}-v${nextVer}`,
      workflowTemplateId: found.id,
      versionNumber: nextVer,
      title: found.title,
      description: found.description,
      steps: JSON.parse(JSON.stringify(found.steps)),
      status: 'DRAFT',
      changeSummary: `Bản nháp chuẩn bị cho v${nextVer}`,
      createdAt: new Date().toISOString(),
    };

    return { id: found.draftVersion.id, versionNumber: nextVer, title: found.draftVersion.title, status: 'DRAFT' };
  }

  async getDraftVersion(id: string): Promise<DraftWorkflowVersionDetail> {
    const found = this.templates.find((t) => t.id === id);
    if (!found || !found.draftVersion) throw new Error('Không có bản nháp nào');
    return JSON.parse(JSON.stringify(found.draftVersion));
  }

  async updateDraftVersion(
    id: string,
    payload: UpdateWorkflowTemplatePayload
  ): Promise<{ id: string; versionNumber: number; title: string; status: string }> {
    const found = this.templates.find((t) => t.id === id);
    if (!found || !found.draftVersion) throw new Error('Không có bản nháp nào');
    if (payload.title) found.draftVersion.title = payload.title;
    if (payload.description !== undefined) found.draftVersion.description = payload.description;
    if (payload.steps) found.draftVersion.steps = payload.steps;
    return {
      id: found.draftVersion.id,
      versionNumber: found.draftVersion.versionNumber,
      title: found.draftVersion.title,
      status: 'DRAFT',
    };
  }

  async discardDraftVersion(id: string): Promise<{ success: boolean; message: string }> {
    const found = this.templates.find((t) => t.id === id);
    if (!found) throw new Error('Không tìm thấy quy trình');
    found.draftVersion = null;
    found.hasDraft = false;
    return { success: true, message: 'Đã hủy bản nháp thành công' };
  }
}
