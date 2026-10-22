import {
  ApiError,
  CancelPayload,
  DocumentDetail,
  DocumentItem,
  DocumentListQuery,
  DocumentListResult,
  DocumentStatus,
  IDocumentService,
  ProcessDecisionPayload,
  ResubmitPayload,
  UserProfile,
} from '@/types/document';
import { CreateDocumentPayload, CreatedDocumentResult } from '@/types/template';

export interface HttpServiceConfig {
  baseUrl?: string;
  getAuthHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
}

export class HttpDocumentService implements IDocumentService {
  private readonly baseUrl: string;
  private readonly getAuthHeaders?: () => Record<string, string> | Promise<Record<string, string>>;

  constructor(config: string | HttpServiceConfig = {}) {
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

  /**
   * Helper gửi request với xử lý lỗi chuẩn hóa
   */
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
    } catch (networkError: any) {
      // Bắt lỗi rớt mạng hoặc kết nối máy chủ thất bại
      throw new ApiError(
        0,
        'NETWORK_ERROR',
        networkError?.message || 'Không thể kết nối đến máy chủ API. Vui lòng kiểm tra đường truyền mạng.',
        networkError
      );
    }

    // Nếu mã HTTP không thành công (4xx, 5xx)
    if (!response.ok) {
      let errorData: any = null;
      try {
        errorData = await response.json();
      } catch {
        // Body không phải JSON hợp lệ
      }

      const serverError = errorData?.error;
      const code = serverError?.code || this.mapStatusCodeToErrorCode(response.status);
      const message =
        serverError?.message ||
        this.getDefaultErrorMessage(response.status, response.statusText);

      throw new ApiError(response.status, code, message, errorData);
    }

    // Phân tích response thành công { success: true, data: T }
    try {
      const json = await response.json();
      return json.data as T;
    } catch (parseError: any) {
      throw new ApiError(
        response.status,
        'INVALID_RESPONSE',
        'Phản hồi từ máy chủ không đúng định dạng JSON chuẩn.',
        parseError
      );
    }
  }

  private mapStatusCodeToErrorCode(status: number): string {
    switch (status) {
      case 400:
        return 'VALIDATION_ERROR';
      case 401:
        return 'UNAUTHORIZED';
      case 403:
        return 'FORBIDDEN';
      case 404:
        return 'DOCUMENT_NOT_FOUND';
      case 409:
        return 'CONCURRENCY_CONFLICT';
      case 422:
        return 'INVALID_STATE_TRANSITION';
      case 500:
      default:
        return 'INTERNAL_ERROR';
    }
  }

  private getDefaultErrorMessage(status: number, statusText: string): string {
    switch (status) {
      case 400:
        return 'Dữ liệu gửi lên không đúng định dạng (400 Bad Request).';
      case 401:
        return 'Phiên làm việc đã hết hạn hoặc chưa đăng nhập. Vui lòng đăng nhập lại (401 Unauthorized).';
      case 403:
        return 'Bạn không có quyền thực hiện thao tác hoặc xem hồ sơ này (403 Forbidden).';
      case 404:
        return 'Không tìm thấy hồ sơ hoặc tài nguyên yêu cầu (404 Not Found).';
      case 409:
        return 'Xung đột tương tranh: Thao tác đã được người khác xử lý trước đó (409 Conflict).';
      case 422:
        return 'Trạng thái hiện tại của hồ sơ không cho phép thực hiện thao tác này (422 Unprocessable Entity).';
      case 500:
      default:
        return `Lỗi hệ thống máy chủ (${status} ${statusText || 'Internal Server Error'}).`;
    }
  }

  /**
   * Lấy thông tin người dùng hiện tại (GET /api/auth/me)
   */
  public async getCurrentUser(): Promise<UserProfile> {
    return this.request<UserProfile>('/auth/me');
  }

  /**
   * Lấy danh sách hồ sơ trình ký (GET /api/documents)
   * Giữ tương thích giao diện trả về mảng DocumentItem[]
   */
  public async getDocuments(
    tab: 'pending_my_approval' | 'my_documents' | 'all',
    query?: DocumentListQuery
  ): Promise<DocumentItem[]> {
    const listResult = await this.getDocumentList(tab, query);
    return listResult.items;
  }

  /**
   * Lấy danh sách hồ sơ kèm phân trang đầy đủ (GET /api/documents)
   */
  public async getDocumentList(
    tab: 'pending_my_approval' | 'my_documents' | 'all',
    query?: DocumentListQuery
  ): Promise<DocumentListResult> {
    const params = new URLSearchParams();
    params.set('tab', tab);
    if (query?.page) params.set('page', String(query.page));
    if (query?.limit) params.set('limit', String(query.limit));
    if (query?.status && query.status !== 'ALL') params.set('status', String(query.status));
    if (query?.search && query.search.trim()) params.set('search', query.search.trim());

    const result = await this.request<{
      items: DocumentItem[];
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      };
    }>(`/documents?${params.toString()}`);

    return {
      items: result.items,
      pagination: result.pagination,
    };
  }

  /**
   * Lấy chi tiết hồ sơ trình ký (GET /api/documents/:id)
   */
  public async getDocumentDetail(id: string): Promise<DocumentDetail> {
    return this.request<DocumentDetail>(`/documents/${encodeURIComponent(id)}`);
  }

  /**
   * Ra quyết định phê duyệt (POST /api/documents/:id/decision)
   */
  public async processDecision(
    id: string,
    payload: ProcessDecisionPayload
  ): Promise<{ success: boolean; documentStatus: DocumentStatus }> {
    const result = await this.request<{
      success: boolean;
      documentStatus: DocumentStatus;
    }>(`/documents/${encodeURIComponent(id)}/decision`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    return {
      success: result.success,
      documentStatus: result.documentStatus,
    };
  }

  /**
   * Nộp lại hồ sơ sau chỉnh sửa (POST /api/documents/:id/resubmit)
   */
  public async resubmitDocument(
    id: string,
    payload: ResubmitPayload
  ): Promise<{ success: boolean; newVersionNumber: number }> {
    const result = await this.request<{
      success: boolean;
      newVersionNumber: number;
    }>(`/documents/${encodeURIComponent(id)}/resubmit`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    return {
      success: result.success,
      newVersionNumber: result.newVersionNumber,
    };
  }

  /**
   * Hủy hồ sơ trình ký (POST /api/documents/:id/cancel)
   */
  public async cancelDocument(
    id: string,
    payload: CancelPayload
  ): Promise<{ success: boolean }> {
    const result = await this.request<{
      success: boolean;
    }>(`/documents/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    return {
      success: result.success,
    };
  }

  /**
   * Tạo hồ sơ mới từ biểu mẫu (POST /api/documents)
   */
  public async createDocument(
    payload: CreateDocumentPayload
  ): Promise<CreatedDocumentResult> {
    return this.request<CreatedDocumentResult>('/documents', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
}
