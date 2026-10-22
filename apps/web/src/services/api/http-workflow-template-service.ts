import { ApiError } from '@/types/document';
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

export interface HttpWorkflowTemplateServiceConfig {
  baseUrl?: string;
  getAuthHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
}

export class HttpWorkflowTemplateService implements IWorkflowTemplateService {
  private readonly baseUrl: string;
  private readonly getAuthHeaders?: () => Record<string, string> | Promise<Record<string, string>>;

  constructor(config: string | HttpWorkflowTemplateServiceConfig = {}) {
    if (typeof config === 'string') {
      this.baseUrl = config.replace(/\/$/, '');
    } else {
      this.baseUrl = (config.baseUrl || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api').replace(
        /\/$/,
        ''
      );
      this.getAuthHeaders = config.getAuthHeaders;
    }
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

    let dynamicHeaders: Record<string, string> = {};
    if (this.getAuthHeaders) {
      try {
        dynamicHeaders = await this.getAuthHeaders();
      } catch (err) {
        console.error('Lỗi khi lấy auth headers:', err);
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...dynamicHeaders,
      ...((options.headers as Record<string, string>) || {}),
    };

    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        headers,
      });
    } catch (networkErr: any) {
      throw new ApiError(
        0,
        'NETWORK_FAILURE',
        'Không thể kết nối đến máy chủ. Vui lòng kiểm tra lại đường truyền mạng.'
      );
    }

    let payload: any = null;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        payload = await response.json();
      } catch (err) {
        // Body không parse được dạng JSON
      }
    }

    if (!response.ok) {
      const code = payload?.error?.code || payload?.code || `HTTP_${response.status}`;
      const message = payload?.error?.message || payload?.message || 'Có lỗi xảy ra khi gọi API.';
      const details = payload?.error?.details || payload?.errors || undefined;

      throw new ApiError(response.status, code, message, details);
    }

    return (payload?.data !== undefined ? payload.data : payload) as T;
  }

  async getWorkflowTemplates(query?: GetWorkflowTemplatesParams): Promise<{
    items: WorkflowTemplateSummary[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const params = new URLSearchParams();
    if (query?.page) params.set('page', String(query.page));
    if (query?.limit) params.set('limit', String(query.limit));
    if (query?.status) params.set('status', query.status);
    if (query?.category) params.set('category', query.category);
    if (query?.search) params.set('search', query.search);

    const qs = params.toString();
    const endpoint = `/workflow-templates${qs ? `?${qs}` : ''}`;

    const res = await this.request<{
      items: WorkflowTemplateSummary[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>(endpoint, { method: 'GET' });

    return res;
  }

  async getWorkflowTemplateById(id: string): Promise<WorkflowTemplateDetail> {
    return this.request<WorkflowTemplateDetail>(`/workflow-templates/${id}`, {
      method: 'GET',
    });
  }

  async createWorkflowTemplate(
    payload: CreateWorkflowTemplatePayload
  ): Promise<{ id: string; code: string; title: string }> {
    return this.request<{ id: string; code: string; title: string }>('/workflow-templates', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async updateWorkflowTemplate(
    id: string,
    payload: UpdateWorkflowTemplatePayload
  ): Promise<{ id: string; title: string }> {
    return this.request<{ id: string; title: string }>(`/workflow-templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async publishWorkflowTemplate(
    id: string,
    payload?: PublishWorkflowTemplatePayload
  ): Promise<{ id: string; versionNumber: number; versionId: string; status: string }> {
    return this.request<{ id: string; versionNumber: number; versionId: string; status: string }>(
      `/workflow-templates/${id}/publish`,
      {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      }
    );
  }

  async archiveWorkflowTemplate(id: string): Promise<{ id: string; status: string }> {
    return this.request<{ id: string; status: string }>(`/workflow-templates/${id}/archive`, {
      method: 'POST',
    });
  }

  async createDraftVersion(
    id: string
  ): Promise<{ id: string; versionNumber: number; title: string; status: string }> {
    return this.request<{ id: string; versionNumber: number; title: string; status: string }>(
      `/workflow-templates/${id}/draft`,
      {
        method: 'POST',
      }
    );
  }

  async getDraftVersion(id: string): Promise<DraftWorkflowVersionDetail> {
    return this.request<DraftWorkflowVersionDetail>(`/workflow-templates/${id}/draft`, {
      method: 'GET',
    });
  }

  async updateDraftVersion(
    id: string,
    payload: UpdateWorkflowTemplatePayload
  ): Promise<{ id: string; versionNumber: number; title: string; status: string }> {
    return this.request<{ id: string; versionNumber: number; title: string; status: string }>(
      `/workflow-templates/${id}/draft`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    );
  }

  async discardDraftVersion(id: string): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>(
      `/workflow-templates/${id}/draft`,
      {
        method: 'DELETE',
      }
    );
  }
}
