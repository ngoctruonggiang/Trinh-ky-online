import {
  WorkflowStepConfig,
  ApproverConfig,
  ApproverType,
  ApproverRole,
  DepartmentPolicy,
} from '@trinh-ky/shared';

export type TemplateStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface WorkflowTemplateSummary {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  category: string;
  status: TemplateStatus;
  currentVersion: number;
  stepCount: number;
  organizationId?: string | null;
  organizationName: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowTemplateVersionItem {
  id: string;
  versionNumber: number;
  title: string;
  changeSummary?: string | null;
  status: TemplateStatus;
  createdByName: string;
  createdAt: string;
  stepCount: number;
}

export interface DraftWorkflowVersionDetail {
  id: string;
  workflowTemplateId?: string;
  versionNumber: number;
  title: string;
  description?: string | null;
  steps: WorkflowStepConfig[];
  status?: TemplateStatus;
  changeSummary?: string | null;
  createdAt: string;
}

export interface WorkflowTemplateDetail {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  category: string;
  status: TemplateStatus;
  currentVersion: number;
  steps: WorkflowStepConfig[];
  organizationId?: string | null;
  organizationName: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  hasDraft: boolean;
  draftVersion: DraftWorkflowVersionDetail | null;
  versions: WorkflowTemplateVersionItem[];
}

export interface CreateWorkflowTemplatePayload {
  code: string;
  title: string;
  description?: string | null;
  category?: string;
  organizationId?: string | null;
  steps: WorkflowStepConfig[];
}

export interface UpdateWorkflowTemplatePayload {
  title?: string;
  description?: string | null;
  category?: string;
  steps?: WorkflowStepConfig[];
}

export interface PublishWorkflowTemplatePayload {
  changeSummary?: string;
  releaseNotes?: string;
}

export interface GetWorkflowTemplatesParams {
  page?: number;
  limit?: number;
  status?: TemplateStatus | 'ALL';
  category?: string;
  search?: string;
}
