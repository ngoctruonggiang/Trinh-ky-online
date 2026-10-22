import { ApiError } from '@/types/document';
import {
  TemplateSummary,
  TemplateDetail,
  CreateTemplatePayload,
  UpdateTemplatePayload,
  PublishTemplatePayload,
} from '@/types/template';
import { ITemplateService, GetTemplatesQuery } from './template-service.interface';

export interface HttpTemplateServiceConfig {
  baseUrl?: string;
  getAuthHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
}

export class HttpTemplateService implements ITemplateService {
  private readonly baseUrl: string;
  private readonly getAuthHeaders?: () => Record<string, string> | Promise<Record<string, string>>;

  constructor(config: string | HttpTemplateServiceConfig = {}) {
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
        'Không thể kết nối đến máy chủ backend. Vui lòng kiểm tra kết nối mạng.',
        networkErr
      );
    }

    let responseJson: any;
    try {
      responseJson = await response.json();
    } catch {
      throw new ApiError(
        response.status,
        'INVALID_RESPONSE',
        `Phản hồi từ máy chủ không hợp lệ (HTTP ${response.status}).`
      );
    }

    if (!response.ok || responseJson.success === false) {
      const errorObj = responseJson.error || {};
      const errorCode = errorObj.code || `HTTP_${response.status}`;
      const errorMessage =
        errorObj.message ||
        responseJson.message ||
        `Yêu cầu thất bại với mã lỗi HTTP ${response.status}`;

      throw new ApiError(response.status, errorCode, errorMessage, errorObj);
    }

    return responseJson.data as T;
  }

  public async getTemplates(
    query: GetTemplatesQuery = {}
  ): Promise<{ items: TemplateSummary[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
    const params = new URLSearchParams();
    if (query.status) params.set('status', query.status);
    if (query.category) params.set('category', query.category);
    if (query.search) params.set('search', query.search);
    if (query.page) params.set('page', String(query.page));
    if (query.limit) params.set('limit', String(query.limit));

    const qs = params.toString();
    return this.request(`/templates${qs ? `?${qs}` : ''}`, { method: 'GET' });
  }

  public async getTemplateById(id: string): Promise<TemplateDetail> {
    return this.request<TemplateDetail>(`/templates/${encodeURIComponent(id)}`, { method: 'GET' });
  }

  public async createTemplate(
    payload: CreateTemplatePayload
  ): Promise<{ id: string; code: string; title: string }> {
    return this.request('/templates', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  public async updateTemplate(
    id: string,
    payload: UpdateTemplatePayload
  ): Promise<{ id: string; title: string }> {
    return this.request(`/templates/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  public async publishTemplate(
    id: string,
    payload?: PublishTemplatePayload
  ): Promise<{ id: string; versionNumber: number; versionId: string }> {
    return this.request(`/templates/${encodeURIComponent(id)}/publish`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
  }

  public async archiveTemplate(id: string): Promise<{ id: string; status: string }> {
    return this.request(`/templates/${encodeURIComponent(id)}/archive`, {
      method: 'POST',
    });
  }

  public async validateFormData(
    templateId: string,
    formData: Record<string, any>
  ): Promise<{ valid: boolean; errors: Record<string, string> }> {
    return this.request(`/templates/${encodeURIComponent(templateId)}/validate`, {
      method: 'POST',
      body: JSON.stringify({ formData }),
    });
  }
}
