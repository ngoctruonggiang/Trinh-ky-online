import { IDocumentService } from '@/types/document';
import { mockDocumentService } from './mock-document-service';
import { HttpDocumentService } from './http-document-service';

/**
 * Cấu hình chế độ dữ liệu:
 * - Khi biến môi trường NEXT_PUBLIC_USE_MOCK_API='false': kết nối API backend thật.
 * - Mặc định (hoặc khi chưa cấu hình): sử dụng MockDocumentService để phát triển và kiểm thử an toàn.
 */
export const isMockMode = process.env.NEXT_PUBLIC_USE_MOCK_API !== 'false';

export const httpDocumentService = new HttpDocumentService({
  baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api',
  getAuthHeaders: () => {
    // Không lưu token bừa bãi vào localStorage.
    // Nếu có cookie hoặc cơ chế session, cấu hình tại đây.
    // Trong môi trường dev có thể truyền dev principal headers nếu được phép.
    const headers: Record<string, string> = {};
    if (typeof window !== 'undefined' && (window as any).__DEV_AUTH_TOKEN__) {
      headers['Authorization'] = `Bearer ${(window as any).__DEV_AUTH_TOKEN__}`;
    }
    return headers;
  },
});

export const documentService: IDocumentService = isMockMode
  ? mockDocumentService
  : httpDocumentService;

export { mockDocumentService, HttpDocumentService };
