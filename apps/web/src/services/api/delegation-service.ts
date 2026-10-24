import {
  CreateDelegationPolicyDto,
  UpdateDelegationPolicyDto,
  DelegationPolicyView,
} from '@trinh-ky/shared';

export interface DelegationListQuery {
  isActive?: boolean;
  role?: 'delegator' | 'delegatee' | 'all';
  page?: number;
  limit?: number;
}

export interface DelegationListResult {
  items: DelegationPolicyView[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface DelegationServiceConfig {
  baseUrl?: string;
  getAuthHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
}

export class DelegationApiService {
  private readonly baseUrl: string;
  private readonly getAuthHeaders?: () => Record<string, string> | Promise<Record<string, string>>;

  constructor(config: string | DelegationServiceConfig = {}) {
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

    const response = await fetch(url, {
      ...options,
      headers,
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const errorMsg =
        body?.error?.message ||
        body?.message ||
        `Yêu cầu thất bại với mã lỗi HTTP ${response.status}`;
      throw new Error(errorMsg);
    }

    return body;
  }

  /**
   * Lấy danh sách chính sách ủy quyền
   */
  async getPolicies(query: DelegationListQuery = {}): Promise<DelegationListResult> {
    const params = new URLSearchParams();
    if (typeof query.isActive === 'boolean') {
      params.append('isActive', String(query.isActive));
    }
    if (query.role) {
      params.append('role', query.role);
    }
    if (query.page) {
      params.append('page', String(query.page));
    }
    if (query.limit) {
      params.append('limit', String(query.limit));
    }

    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await this.request<{
      success: boolean;
      data: DelegationPolicyView[];
      pagination: DelegationListResult['pagination'];
    }>(`/delegations${qs}`);

    return {
      items: res.data || [],
      pagination: res.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 },
    };
  }

  /**
   * Lấy chi tiết một chính sách ủy quyền
   */
  async getPolicyById(id: string): Promise<DelegationPolicyView> {
    const res = await this.request<{
      success: boolean;
      data: DelegationPolicyView;
    }>(`/delegations/${encodeURIComponent(id)}`);
    return res.data;
  }

  /**
   * Tạo mới chính sách ủy quyền
   */
  async createPolicy(dto: CreateDelegationPolicyDto): Promise<DelegationPolicyView> {
    const res = await this.request<{
      success: boolean;
      data: DelegationPolicyView;
    }>('/delegations', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
    return res.data;
  }

  /**
   * Cập nhật chính sách ủy quyền
   */
  async updatePolicy(id: string, dto: UpdateDelegationPolicyDto): Promise<DelegationPolicyView> {
    const res = await this.request<{
      success: boolean;
      data: DelegationPolicyView;
    }>(`/delegations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    });
    return res.data;
  }

  /**
   * Thu hồi chính sách ủy quyền (Soft Revoke)
   */
  async revokePolicy(id: string, reason?: string): Promise<DelegationPolicyView> {
    const res = await this.request<{
      success: boolean;
      data: DelegationPolicyView;
    }>(`/delegations/${encodeURIComponent(id)}/revoke`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    return res.data;
  }
}
