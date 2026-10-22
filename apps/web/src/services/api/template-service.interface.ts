import {
  TemplateSummary,
  TemplateDetail,
  CreateTemplatePayload,
  UpdateTemplatePayload,
  PublishTemplatePayload,
  DraftVersionDetail,
} from '../../types/template.js';

export interface GetTemplatesQuery {
  status?: string;
  category?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface ITemplateService {
  getTemplates(
    query?: GetTemplatesQuery
  ): Promise<{ items: TemplateSummary[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>;
  getTemplateById(id: string): Promise<TemplateDetail>;
  createTemplate(payload: CreateTemplatePayload): Promise<{ id: string; code: string; title: string }>;
  updateTemplate(id: string, payload: UpdateTemplatePayload): Promise<{ id: string; title: string }>;
  publishTemplate(id: string, payload?: PublishTemplatePayload): Promise<{ id: string; versionNumber: number; versionId: string }>;
  archiveTemplate(id: string): Promise<{ id: string; status: string }>;
  validateFormData(
    templateId: string,
    formData: Record<string, any>
  ): Promise<{ valid: boolean; errors: Record<string, string> }>;
  createDraftVersion(
    templateId: string
  ): Promise<{ id: string; versionNumber: number; title: string; status: string }>;
  getDraftVersion(templateId: string): Promise<DraftVersionDetail>;
  updateDraftVersion(
    templateId: string,
    payload: UpdateTemplatePayload
  ): Promise<{ id: string; versionNumber: number; title: string; status: string }>;
  discardDraftVersion(templateId: string): Promise<{ success: boolean; message: string }>;
}
