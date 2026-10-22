import { FormFieldDefinition, FormFieldType, FormFieldOption, LayoutBlock, DefaultWorkflowStep } from '@trinh-ky/shared';

export type TemplateStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface TemplateSummary {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  category: string;
  status: TemplateStatus;
  currentVersion: number;
  fieldCount: number;
  organizationId?: string | null;
  organizationName: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateVersionItem {
  id: string;
  versionNumber: number;
  title: string;
  changeSummary?: string | null;
  status: TemplateStatus;
  createdByName: string;
  createdAt: string;
  fieldCount: number;
}

export interface DraftVersionDetail {
  id: string;
  templateId?: string;
  versionNumber: number;
  title: string;
  description?: string | null;
  fields: FormFieldDefinition[];
  layoutBlocks?: LayoutBlock[];
  defaultWorkflowSteps?: DefaultWorkflowStep[];
  status?: TemplateStatus;
  changeSummary?: string | null;
  createdAt: string;
}

export interface TemplateDetail {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  category: string;
  status: TemplateStatus;
  currentVersion: number;
  fields: FormFieldDefinition[];
  layoutBlocks?: LayoutBlock[];
  defaultWorkflowSteps?: DefaultWorkflowStep[];
  organizationId?: string | null;
  organizationName: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  hasDraft?: boolean;
  draftVersion?: DraftVersionDetail | null;
  versions: TemplateVersionItem[];
}

export interface CreateTemplatePayload {
  code: string;
  title: string;
  description?: string;
  category?: string;
  fields: FormFieldDefinition[];
  layoutBlocks?: LayoutBlock[];
  defaultWorkflowSteps?: DefaultWorkflowStep[];
  organizationId?: string | null;
}

export interface UpdateTemplatePayload {
  title?: string;
  description?: string;
  category?: string;
  fields?: FormFieldDefinition[];
  layoutBlocks?: LayoutBlock[];
  defaultWorkflowSteps?: DefaultWorkflowStep[];
}

export interface PublishTemplatePayload {
  changeSummary?: string;
}

export interface CreateDocumentPayload {
  templateId: string;
  title: string;
  urgency?: 'LOW' | 'NORMAL' | 'URGENT' | 'EMERGENCY';
  dueDate?: string;
  formData: Record<string, any>;
}

export interface CreatedDocumentResult {
  id: string;
  documentNumber: string;
  title: string;
  status: string;
  currentVersion: number;
  templateId: string;
  templateVersionNumber: number;
  createdAt: string;
}
