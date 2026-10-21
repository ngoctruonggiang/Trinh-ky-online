import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { HttpDocumentService } from './http-document-service';
import {
  AssigneeDecision,
  DocumentStatus,
  UserRole,
} from '@/types/document';

describe('HttpDocumentService (API Adapter & Error Handling)', () => {
  let service: HttpDocumentService;
  const mockBaseUrl = 'http://api.test/api';

  beforeEach(() => {
    service = new HttpDocumentService({
      baseUrl: mockBaseUrl,
      getAuthHeaders: () => ({
        Authorization: 'Bearer test-token-123',
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Gọi API thành công (200 OK)', () => {
    it('1.1. getCurrentUser gọi đúng endpoint /auth/me kèm auth header', async () => {
      const mockProfile = {
        id: 'u-1',
        email: 'user@vinagroup.vn',
        fullName: 'Nguyễn Văn A',
        role: UserRole.USER,
        organizationId: 'org-hq',
        organizationName: 'VinaGroup HQ',
        departmentId: 'dept-it',
        departmentName: 'Phòng IT',
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: mockProfile }),
      } as any);

      const result = await service.getCurrentUser();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('http://api.test/api/auth/me');
      expect((options?.headers as any)['Authorization']).toBe('Bearer test-token-123');
      expect(result).toEqual(mockProfile);
    });

    it('1.2. getDocuments gửi đúng query params tab, page, limit, status, search', async () => {
      const mockItems = [
        {
          id: 'doc-1',
          documentNumber: 'TK-001',
          title: 'Đề nghị công tác',
        },
      ];

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            items: mockItems,
            pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
          },
        }),
      } as any);

      const result = await service.getDocuments('pending_my_approval', {
        page: 1,
        limit: 10,
        status: DocumentStatus.IN_REVIEW,
        search: 'TK-001',
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('/documents?');
      expect(url).toContain('tab=pending_my_approval');
      expect(url).toContain('page=1');
      expect(url).toContain('limit=10');
      expect(url).toContain(`status=${DocumentStatus.IN_REVIEW}`);
      expect(url).toContain('search=TK-001');
      expect(result).toEqual(mockItems);
    });

    it('1.3. getDocumentDetail lấy chi tiết hồ sơ theo ID', async () => {
      const mockDetail = {
        id: 'doc-123',
        documentNumber: 'TK-2026-0001',
        title: 'Chi tiết hồ sơ',
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: mockDetail }),
      } as any);

      const result = await service.getDocumentDetail('doc-123');

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://api.test/api/documents/doc-123',
        expect.anything()
      );
      expect(result).toEqual(mockDetail);
    });

    it('1.4. processDecision gửi POST đúng endpoint và payload', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { success: true, documentStatus: DocumentStatus.APPROVED },
        }),
      } as any);

      const payload = {
        decision: AssigneeDecision.APPROVED,
        decisionComment: 'Duyệt đề xuất',
        signatureImageUrl: 'https://cdn.test/sig.png',
      };

      const result = await service.processDecision('doc-123', payload);

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://api.test/api/documents/doc-123/decision',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(payload),
        })
      );
      expect(result.documentStatus).toBe(DocumentStatus.APPROVED);
    });
  });

  describe('2. Xử lý lỗi HTTP & Chuẩn hóa mã lỗi (Error Handling)', () => {
    it('2.1. Lỗi 400 Bad Request ném ApiError VALIDATION_ERROR', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Dữ liệu không đúng định dạng.',
          },
        }),
      } as any);

      await expect(service.getDocumentDetail('doc-bad')).rejects.toMatchObject({
        name: 'ApiError',
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Dữ liệu không đúng định dạng.',
      });
    });

    it('2.2. Lỗi 401 Unauthorized ném ApiError UNAUTHORIZED', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Token đã hết hạn.',
          },
        }),
      } as any);

      await expect(service.getCurrentUser()).rejects.toMatchObject({
        name: 'ApiError',
        statusCode: 401,
        code: 'UNAUTHORIZED',
        message: 'Token đã hết hạn.',
      });
    });

    it('2.3. Lỗi 403 Forbidden ném ApiError FORBIDDEN (Ranh giới đa công ty)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Bạn không có quyền truy cập hồ sơ thuộc công ty khác.',
          },
        }),
      } as any);

      await expect(service.getDocumentDetail('doc-other-company')).rejects.toMatchObject({
        name: 'ApiError',
        statusCode: 403,
        code: 'FORBIDDEN',
      });
    });

    it('2.4. Lỗi 404 Not Found ném ApiError DOCUMENT_NOT_FOUND', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({
          success: false,
          error: {
            code: 'DOCUMENT_NOT_FOUND',
            message: 'Không tìm thấy hồ sơ.',
          },
        }),
      } as any);

      await expect(service.getDocumentDetail('doc-none')).rejects.toMatchObject({
        name: 'ApiError',
        statusCode: 404,
        code: 'DOCUMENT_NOT_FOUND',
      });
    });

    it('2.5. Lỗi 409 Conflict ném ApiError CONCURRENCY_CONFLICT', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: async () => ({
          success: false,
          error: {
            code: 'CONCURRENCY_CONFLICT',
            message: 'Bước duyệt đã được người duyệt khác xử lý trước đó.',
          },
        }),
      } as any);

      await expect(
        service.processDecision('doc-123', { decision: AssigneeDecision.APPROVED })
      ).rejects.toMatchObject({
        name: 'ApiError',
        statusCode: 409,
        code: 'CONCURRENCY_CONFLICT',
      });
    });

    it('2.6. Lỗi 422 Unprocessable Entity ném ApiError INVALID_STATE_TRANSITION', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        json: async () => ({
          success: false,
          error: {
            code: 'INVALID_STATE_TRANSITION',
            message: 'Không thể nộp lại hồ sơ đang trong trạng thái IN_REVIEW.',
          },
        }),
      } as any);

      await expect(
        service.resubmitDocument('doc-123', { formData: {} })
      ).rejects.toMatchObject({
        name: 'ApiError',
        statusCode: 422,
        code: 'INVALID_STATE_TRANSITION',
      });
    });

    it('2.7. Lỗi mất mạng (Network Failure) ném ApiError NETWORK_ERROR, không âm thầm chuyển sang mock', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Failed to fetch'));

      await expect(service.getDocumentDetail('doc-123')).rejects.toMatchObject({
        name: 'ApiError',
        statusCode: 0,
        code: 'NETWORK_ERROR',
        message: 'Failed to fetch',
      });
    });
  });
});
