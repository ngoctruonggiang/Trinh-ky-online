import { IDocumentService } from '@/types/document';
import { mockDocumentService } from './mock-document-service';
import { HttpDocumentService } from './http-document-service';
import { ITemplateService } from './template-service.interface';
import { HttpTemplateService } from './http-template-service';
import { MockTemplateService } from './mock-template-service';

/**
 * Cấu hình chế độ dữ liệu:
 * - Mặc định kết nối API backend thật (HttpDocumentService, HttpTemplateService, HttpWorkflowTemplateService).
 * - Chỉ khi cấu hình rõ ràng biến môi trường NEXT_PUBLIC_USE_MOCK_API='true' mới sử dụng Mock để phát triển offline.
 */
export const isMockMode = process.env.NEXT_PUBLIC_USE_MOCK_API === 'true';

const getAuthHeaders = () => {
  const headers: Record<string, string> = {};
  if (typeof window !== 'undefined' && (window as any).__DEV_AUTH_TOKEN__) {
    headers['Authorization'] = `Bearer ${(window as any).__DEV_AUTH_TOKEN__}`;
  }
  return headers;
};

export const httpDocumentService = new HttpDocumentService({
  baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api',
  getAuthHeaders,
});

export const documentService: IDocumentService = isMockMode
  ? mockDocumentService
  : httpDocumentService;

export const mockTemplateService = new MockTemplateService();
export const httpTemplateService = new HttpTemplateService({
  baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api',
  getAuthHeaders,
});

export const templateService: ITemplateService = isMockMode
  ? mockTemplateService
  : httpTemplateService;

import { IWorkflowTemplateService } from './workflow-template-service.interface';
import { HttpWorkflowTemplateService } from './http-workflow-template-service';
import { MockWorkflowTemplateService } from './mock-workflow-template-service';

export const mockWorkflowTemplateService = new MockWorkflowTemplateService();
export const httpWorkflowTemplateService = new HttpWorkflowTemplateService({
  baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api',
  getAuthHeaders,
});

export const workflowTemplateService: IWorkflowTemplateService = isMockMode
  ? mockWorkflowTemplateService
  : httpWorkflowTemplateService;

export {
  mockDocumentService,
  HttpDocumentService,
  MockTemplateService,
  HttpTemplateService,
  MockWorkflowTemplateService,
  HttpWorkflowTemplateService,
};
export type { ITemplateService, IWorkflowTemplateService };
export { notificationService, NotificationService } from './notification-service';
