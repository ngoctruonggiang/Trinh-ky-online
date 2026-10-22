import {
  WorkflowTemplateSummary,
  WorkflowTemplateDetail,
  CreateWorkflowTemplatePayload,
  UpdateWorkflowTemplatePayload,
  PublishWorkflowTemplatePayload,
  DraftWorkflowVersionDetail,
  GetWorkflowTemplatesParams,
} from '../../types/workflow-template.js';

export interface IWorkflowTemplateService {
  getWorkflowTemplates(
    query?: GetWorkflowTemplatesParams
  ): Promise<{
    items: WorkflowTemplateSummary[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>;
  getWorkflowTemplateById(id: string): Promise<WorkflowTemplateDetail>;
  createWorkflowTemplate(
    payload: CreateWorkflowTemplatePayload
  ): Promise<{ id: string; code: string; title: string }>;
  updateWorkflowTemplate(
    id: string,
    payload: UpdateWorkflowTemplatePayload
  ): Promise<{ id: string; title: string }>;
  publishWorkflowTemplate(
    id: string,
    payload?: PublishWorkflowTemplatePayload
  ): Promise<{ id: string; versionNumber: number; versionId: string; status: string }>;
  archiveWorkflowTemplate(id: string): Promise<{ id: string; status: string }>;
  createDraftVersion(
    id: string
  ): Promise<{ id: string; versionNumber: number; title: string; status: string }>;
  getDraftVersion(id: string): Promise<DraftWorkflowVersionDetail>;
  updateDraftVersion(
    id: string,
    payload: UpdateWorkflowTemplatePayload
  ): Promise<{ id: string; versionNumber: number; title: string; status: string }>;
  discardDraftVersion(id: string): Promise<{ success: boolean; message: string }>;
}
