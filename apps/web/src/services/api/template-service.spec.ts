import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { HttpTemplateService } from './http-template-service';
import { MockTemplateService } from './mock-template-service';
import { TemplateStatus } from '@/types/template';

describe('HttpTemplateService & MockTemplateService Tests', () => {
  describe('HttpTemplateService (REST API Integration & Error Handling)', () => {
    let service: HttpTemplateService;
    const mockBaseUrl = 'http://api.test/api';

    beforeEach(() => {
      service = new HttpTemplateService({
        baseUrl: mockBaseUrl,
        getAuthHeaders: () => ({
          Authorization: 'Bearer test-jwt-token',
        }),
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('1.1. getTemplates gọi GET /templates với auth header và query params', async () => {
      const mockResult = {
        items: [
          {
            id: 'tpl-1',
            code: 'TPL-PURCHASE',
            title: 'Mẫu mua sắm',
            status: 'PUBLISHED' as TemplateStatus,
            currentVersion: 1,
            fieldCount: 3,
            organizationName: 'VinaGroup HQ',
            createdById: 'u-admin',
            createdByName: 'Admin',
            category: 'Hành chính',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        pagination: {
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        },
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: mockResult }),
      } as any);

      const res = await service.getTemplates({ status: 'PUBLISHED', search: 'mua sắm' });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toContain('http://api.test/api/templates?');
      expect(url).toContain('status=PUBLISHED');
      expect(url).toContain('search=mua+s%E1%BA%AFm');
      expect((opts?.headers as any)['Authorization']).toBe('Bearer test-jwt-token');
      expect(res.items).toHaveLength(1);
      expect(res.items[0].code).toBe('TPL-PURCHASE');
    });

    it('1.2. getTemplateById gọi GET /templates/:id', async () => {
      const mockTemplate = {
        id: 'tpl-1',
        code: 'TPL-01',
        title: 'Mẫu xin nghỉ phép',
        status: 'DRAFT' as TemplateStatus,
        fields: [
          { key: 'leave_days', label: 'Số ngày nghỉ', type: 'number', required: true },
        ],
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: mockTemplate }),
      } as any);

      const res = await service.getTemplateById('tpl-1');

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://api.test/api/templates/tpl-1',
        expect.objectContaining({ method: 'GET' })
      );
      expect(res.id).toBe('tpl-1');
      expect(res.fields[0].key).toBe('leave_days');
    });

    it('1.3. createTemplate gửi POST /templates với schema', async () => {
      const payload = {
        title: 'Đề xuất tạm ứng',
        code: 'TPL-ADV',
        fields: [
          { key: 'amount', label: 'Số tiền', type: 'number' as const, required: true },
        ],
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ success: true, data: { id: 'tpl-new', ...payload, status: 'DRAFT' } }),
      } as any);

      const res = await service.createTemplate(payload);

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://api.test/api/templates',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(payload),
        })
      );
      expect(res.id).toBe('tpl-new');
    });

    it('1.4. publishTemplate gửi POST /templates/:id/publish', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            id: 'tpl-1',
            status: 'PUBLISHED',
            versionNumber: 1,
            versionId: 'ver-1',
          },
        }),
      } as any);

      const res = await service.publishTemplate('tpl-1', { changeSummary: 'Bản phát hành chính thức đầu tiên' });

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://api.test/api/templates/tpl-1/publish',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ changeSummary: 'Bản phát hành chính thức đầu tiên' }),
        })
      );
      expect(res.versionNumber).toBe(1);
      expect(res.versionId).toBe('ver-1');
    });

    it('1.5. archiveTemplate gửi POST /templates/:id/archive', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            id: 'tpl-1',
            status: 'ARCHIVED',
          },
        }),
      } as any);

      const res = await service.archiveTemplate('tpl-1');

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://api.test/api/templates/tpl-1/archive',
        expect.objectContaining({ method: 'POST' })
      );
      expect(res.status).toBe('ARCHIVED');
    });

    it('1.6. validateFormData gửi POST /templates/:id/validate', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            valid: true,
            errors: {},
          },
        }),
      } as any);

      const res = await service.validateFormData('tpl-1', { amount: 500000 });

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://api.test/api/templates/tpl-1/validate',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ formData: { amount: 500000 } }),
        })
      );
      expect(res.valid).toBe(true);
    });

    it('1.7. API trả về lỗi 403 Forbidden ném ApiError FORBIDDEN mà không fallback sang mock', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Chỉ Quản trị viên (ADMIN) mới có quyền xuất bản biểu mẫu.',
          },
        }),
      } as any);

      await expect(service.publishTemplate('tpl-1', {})).rejects.toMatchObject({
        name: 'ApiError',
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'Chỉ Quản trị viên (ADMIN) mới có quyền xuất bản biểu mẫu.',
      });
    });

    it('1.8. API mất kết nối ném ApiError NETWORK_FAILURE mà không giấu lỗi', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection refused'));

      await expect(service.getTemplates({})).rejects.toMatchObject({
        name: 'ApiError',
        statusCode: 0,
        code: 'NETWORK_FAILURE',
      });
    });

    it('1.9. createDraftVersion, getDraftVersion, updateDraftVersion, discardDraftVersion gọi đúng /templates/:id/draft', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, opts: any) => {
        const method = opts?.method || 'GET';
        if (method === 'POST') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: { id: 'draft-1', versionNumber: 2, title: 'Draft v2', status: 'DRAFT' } }),
          } as any;
        }
        if (method === 'GET') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: { id: 'draft-1', versionNumber: 2, title: 'Draft v2', fields: [], status: 'DRAFT', createdAt: new Date().toISOString() } }),
          } as any;
        }
        if (method === 'PUT') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: { id: 'draft-1', versionNumber: 2, title: 'Draft v2 Updated', status: 'DRAFT' } }),
          } as any;
        }
        if (method === 'DELETE') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, message: 'Đã hủy bỏ bản nháp thành công.' }),
          } as any;
        }
        return { ok: false, status: 404 } as any;
      });

      const draftCreated = await service.createDraftVersion('tpl-1');
      expect(draftCreated.versionNumber).toBe(2);

      const draftDetail = await service.getDraftVersion('tpl-1');
      expect(draftDetail.versionNumber).toBe(2);

      const draftUpdated = await service.updateDraftVersion('tpl-1', { title: 'Draft v2 Updated' });
      expect(draftUpdated.title).toBe('Draft v2 Updated');

      const discardRes = await service.discardDraftVersion('tpl-1');
      expect(discardRes.message).toContain('thành công');
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });
  });

  describe('MockTemplateService (In-memory verification for dev & fallback)', () => {
    let mockService: MockTemplateService;

    beforeEach(() => {
      mockService = new MockTemplateService();
    });

    it('2.1. Khởi tạo danh sách mẫu mặc định với ít nhất 1 mẫu PUBLISHED', async () => {
      const res = await mockService.getTemplates({});
      expect(res.items.length).toBeGreaterThan(0);
      const published = res.items.find((t) => t.status === 'PUBLISHED');
      expect(published).toBeDefined();
    });

    it('2.2. Tạo mẫu mới ở trạng thái DRAFT', async () => {
      const created = await mockService.createTemplate({
        title: 'Mẫu biên bản bàn giao',
        code: 'TPL-HANDOVER',
        fields: [
          { key: 'recipient', label: 'Người nhận bàn giao', type: 'text', required: true },
        ],
      });

      expect(created.id).toBeDefined();
      expect(created.code).toBe('TPL-HANDOVER');

      const found = await mockService.getTemplateById(created.id);
      expect(found.title).toBe('Mẫu biên bản bàn giao');
      expect(found.status).toBe('DRAFT');
    });

    it('2.3. Cập nhật mẫu DRAFT thành công và chặn cập nhật mẫu ARCHIVED', async () => {
      const created = await mockService.createTemplate({
        title: 'Mẫu thử nghiệm',
        code: 'TPL-TEST',
        fields: [
          { key: 'test_field', label: 'Trường kiểm tra', type: 'text', required: false },
        ],
      });

      const updated = await mockService.updateTemplate(created.id, {
        title: 'Mẫu thử nghiệm đã sửa',
      });
      expect(updated.title).toBe('Mẫu thử nghiệm đã sửa');

      await mockService.archiveTemplate(created.id);

      await expect(
        mockService.updateTemplate(created.id, { title: 'Không thể sửa' })
      ).rejects.toThrow();
    });

    it('2.4. Phát hành mẫu DRAFT chuyển status sang PUBLISHED và tăng version', async () => {
      const created = await mockService.createTemplate({
        title: 'Mẫu thanh toán',
        code: 'TPL-PAY',
        fields: [
          { key: 'invoice_no', label: 'Số hóa đơn', type: 'text', required: true },
        ],
      });

      const published = await mockService.publishTemplate(created.id, { changeSummary: 'Initial release' });
      expect(published.versionNumber).toBe(1);

      const found = await mockService.getTemplateById(created.id);
      expect(found.status).toBe('PUBLISHED');
      expect(found.versions).toHaveLength(1);
    });

    it('2.5. validateFormData kiểm tra hợp lệ và phát hiện trường bắt buộc bị thiếu', async () => {
      const created = await mockService.createTemplate({
        title: 'Mẫu kiểm tra',
        code: 'TPL-VAL',
        fields: [
          { key: 'full_name', label: 'Họ tên', type: 'text', required: true },
          { key: 'email_addr', label: 'Email', type: 'email', required: false },
        ],
      });

      // Thiếu full_name
      const val1 = await mockService.validateFormData(created.id, {});
      expect(val1.valid).toBe(false);
      expect(val1.errors['full_name']).toBeDefined();

      // Email không đúng định dạng
      const val2 = await mockService.validateFormData(created.id, {
        full_name: 'Nguyễn Văn B',
        email_addr: 'invalid-email',
      });
      expect(val2.valid).toBe(false);
      expect(val2.errors['email_addr']).toBeDefined();

      // Hợp lệ
      const val3 = await mockService.validateFormData(created.id, {
        full_name: 'Nguyễn Văn B',
        email_addr: 'nguyen.van.b@vinagroup.vn',
      });
      expect(val3.valid).toBe(true);
      expect(Object.keys(val3.errors)).toHaveLength(0);
    });

    it('2.6. Lifecycle toàn vẹn của MockTemplateService: Tạo DRAFT -> Publish v1 -> Tạo draft v2 -> Sửa draft v2 -> Publish v2 -> v1 không bị ghi đè', async () => {
      // 1. Tạo template DRAFT
      const tpl = await mockService.createTemplate({
        title: 'Mẫu v1 gốc',
        code: 'TPL-LIFECYCLE',
        fields: [{ key: 'f1', label: 'Field 1', type: 'text', required: true }],
      });

      // 2. Publish v1
      const pub1 = await mockService.publishTemplate(tpl.id, { changeSummary: 'Release v1' });
      expect(pub1.versionNumber).toBe(1);

      // 3. Tạo draft v2
      const draft = await mockService.createDraftVersion(tpl.id);
      expect(draft.versionNumber).toBe(2);

      // 4. Sửa draft v2
      await mockService.updateDraftVersion(tpl.id, {
        title: 'Mẫu v2 nâng cấp',
        fields: [
          { key: 'f1', label: 'Field 1', type: 'text', required: true },
          { key: 'f2', label: 'Field 2', type: 'number', required: false },
        ],
      });

      // 5. Publish v2
      const pub2 = await mockService.publishTemplate(tpl.id, { changeSummary: 'Release v2' });
      expect(pub2.versionNumber).toBe(2);

      // 6. Kiểm tra template hiện tại là v2
      const updatedTpl = await mockService.getTemplateById(tpl.id);
      expect(updatedTpl.currentVersion).toBe(2);
      expect(updatedTpl.title).toBe('Mẫu v2 nâng cấp');
      expect(updatedTpl.fields).toHaveLength(2);

      // 7. Xác minh snapshot v1 vẫn còn nguyên vẹn trong versions
      const v1Snapshot = updatedTpl.versions.find((v) => v.versionNumber === 1);
      expect(v1Snapshot).toBeDefined();
      expect(v1Snapshot?.fieldCount).toBe(1);
      expect(v1Snapshot?.title).toBe('Mẫu v1 gốc');
    });
  });
});
