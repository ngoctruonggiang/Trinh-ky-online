import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { HttpWorkflowTemplateService } from './http-workflow-template-service';
import { MockWorkflowTemplateService } from './mock-workflow-template-service';
import { TemplateStatus } from '@/types/workflow-template';
import { WorkflowStepConfig } from '@trinh-ky/shared';

describe('HttpWorkflowTemplateService & MockWorkflowTemplateService Tests', () => {
  const sampleSteps: WorkflowStepConfig[] = [
    {
      stepKey: 'step_mgr',
      stepName: 'Trưởng phòng duyệt',
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
      stepKey: 'step_dir',
      stepName: 'Giám đốc duyệt',
      stepOrder: 2,
      stepType: 'SEQUENTIAL',
      completionRule: 'ANY_CAN_APPROVE',
      approverConfig: {
        type: 'ORGANIZATION_ROLE',
        role: 'DIRECTOR',
      },
      reviewerUserIds: [],
    },
  ];

  describe('HttpWorkflowTemplateService (REST API Calls & Error Handling)', () => {
    let service: HttpWorkflowTemplateService;
    const mockBaseUrl = 'http://api.test/api';

    beforeEach(() => {
      service = new HttpWorkflowTemplateService({
        baseUrl: mockBaseUrl,
        getAuthHeaders: () => ({
          Authorization: 'Bearer test-jwt-token',
        }),
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('1.1. getWorkflowTemplates gọi GET /workflow-templates với query params và auth headers', async () => {
      const mockResult = {
        items: [
          {
            id: 'wf-1',
            code: 'WF-PURCHASE',
            title: 'Quy trình mua sắm',
            status: 'PUBLISHED' as TemplateStatus,
            currentVersion: 1,
            stepCount: 2,
            organizationName: 'VinaGroup HQ',
            createdById: 'u-admin',
            createdByName: 'Admin',
            category: 'Hành chính',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        pagination: { total: 1, page: 1, limit: 10, totalPages: 1 },
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true, data: mockResult }),
      } as any);

      const res = await service.getWorkflowTemplates({ status: 'PUBLISHED', search: 'mua sắm' });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toContain('http://api.test/api/workflow-templates?');
      expect(url).toContain('status=PUBLISHED');
      expect(url).toContain('search=mua+s%E1%BA%AFm');
      expect(opts?.headers).toHaveProperty('Authorization', 'Bearer test-jwt-token');
      expect(res.items.length).toBe(1);
      expect(res.items[0].code).toBe('WF-PURCHASE');
    });

    it('1.2. getWorkflowTemplateById gọi GET /workflow-templates/:id', async () => {
      const mockDetail = {
        id: 'wf-1',
        code: 'WF-PURCHASE',
        title: 'Quy trình mua sắm',
        status: 'PUBLISHED' as TemplateStatus,
        currentVersion: 1,
        steps: sampleSteps,
        organizationName: 'VinaGroup HQ',
        createdById: 'u-admin',
        createdByName: 'Admin',
        category: 'Hành chính',
        hasDraft: false,
        draftVersion: null,
        versions: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true, data: mockDetail }),
      } as any);

      const res = await service.getWorkflowTemplateById('wf-1');
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://api.test/api/workflow-templates/wf-1',
        expect.objectContaining({ method: 'GET' })
      );
      expect(res.steps.length).toBe(2);
    });

    it('1.3. createWorkflowTemplate gọi POST /workflow-templates', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          success: true,
          data: { id: 'wf-new', code: 'WF_NEW', title: 'Quy trình mới' },
        }),
      } as any);

      const res = await service.createWorkflowTemplate({
        code: 'WF_NEW',
        title: 'Quy trình mới',
        steps: sampleSteps,
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://api.test/api/workflow-templates',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            code: 'WF_NEW',
            title: 'Quy trình mới',
            steps: sampleSteps,
          }),
        })
      );
      expect(res.id).toBe('wf-new');
    });

    it('1.4. publishWorkflowTemplate gọi POST /workflow-templates/:id/publish', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          success: true,
          data: { id: 'wf-1', versionNumber: 1, versionId: 'v1-id', status: 'PUBLISHED' },
        }),
      } as any);

      const res = await service.publishWorkflowTemplate('wf-1', {
        changeSummary: 'Phát hành chính thức v1',
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://api.test/api/workflow-templates/wf-1/publish',
        expect.objectContaining({ method: 'POST' })
      );
      expect(res.versionNumber).toBe(1);
    });

    it('1.5. createDraftVersion và discardDraftVersion gọi đúng endpoints', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, opts: any) => {
        if (opts?.method === 'POST') {
          return {
            ok: true,
            status: 201,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              success: true,
              data: { id: 'draft-id', versionNumber: 2, title: 'Draft v2', status: 'DRAFT' },
            }),
          } as any;
        } else if (opts?.method === 'DELETE') {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              success: true,
              message: 'Hủy bản nháp thành công',
            }),
          } as any;
        }
        return {} as any;
      });

      const draftRes = await service.createDraftVersion('wf-1');
      expect(draftRes.versionNumber).toBe(2);

      const discardRes = await service.discardDraftVersion('wf-1');
      expect(discardRes.success).toBe(true);
    });

    it('1.6. Xử lý lỗi mạng NETWORK_FAILURE khi fetch bị từ chối kết nối', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Failed to fetch'));

      await expect(service.getWorkflowTemplateById('wf-1')).rejects.toThrow(
        /Không thể kết nối đến máy chủ/
      );
    });

    it('1.7. Bắt lỗi Conflict 409 khi có tranh chấp đồng thời', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 409,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          statusCode: 409,
          error: {
            code: 'CONFLICT',
            message: 'Phiên bản vừa được phát hành bởi người khác.',
          },
        }),
      } as any);

      await expect(
        service.publishWorkflowTemplate('wf-1', { changeSummary: 'Publish' })
      ).rejects.toThrow(/Phiên bản vừa được phát hành bởi người khác/);
    });
  });

  describe('MockWorkflowTemplateService (Standalone Mock Lifecycle)', () => {
    let mockService: MockWorkflowTemplateService;

    beforeEach(() => {
      mockService = new MockWorkflowTemplateService();
    });

    it('2.1. getWorkflowTemplates trả về danh sách mẫu có sẵn', async () => {
      const res = await mockService.getWorkflowTemplates();
      expect(res.items.length).toBeGreaterThan(0);
      expect(res.pagination.total).toBeGreaterThan(0);
    });

    it('2.2. createWorkflowTemplate tạo quy trình DRAFT', async () => {
      const created = await mockService.createWorkflowTemplate({
        code: 'WF_MOCK_TEST',
        title: 'Quy trình thử nghiệm mock',
        steps: sampleSteps,
      });

      expect(created.id).toBeDefined();
      expect(created.code).toBe('WF_MOCK_TEST');

      const detail = await mockService.getWorkflowTemplateById(created.id);
      expect(detail.status).toBe('DRAFT');
      expect(detail.steps.length).toBe(2);
    });

    it('2.3. Quy trình DRAFT -> Publish v1 -> Tạo draft v2 -> Hủy draft v2', async () => {
      const created = await mockService.createWorkflowTemplate({
        code: 'WF_LIFECYCLE',
        title: 'Quy trình vòng đời',
        steps: sampleSteps,
      });

      // 1. Publish v1
      const pub1 = await mockService.publishWorkflowTemplate(created.id, { releaseNotes: 'v1' });
      expect(pub1.versionNumber).toBe(1);

      // 2. Tạo draft v2
      const draft2 = await mockService.createDraftVersion(created.id);
      expect(draft2.versionNumber).toBe(2);

      const afterDraft = await mockService.getWorkflowTemplateById(created.id);
      expect(afterDraft.hasDraft).toBe(true);

      // 3. Hủy draft v2
      const discard = await mockService.discardDraftVersion(created.id);
      expect(discard.success).toBe(true);

      const afterDiscard = await mockService.getWorkflowTemplateById(created.id);
      expect(afterDiscard.hasDraft).toBe(false);
      expect(afterDiscard.currentVersion).toBe(1);
    });
  });
});
