import {
  DocumentStatus,
  WorkflowStatus,
  StepStatus,
  AssigneeRole,
  AssigneeDecision,
  UrgencyLevel,
  StepType,
  StepCompletionRule,
  UserRole,
} from '@trinh-ky/shared';

export {
  DocumentStatus,
  WorkflowStatus,
  StepStatus,
  AssigneeRole,
  AssigneeDecision,
  UrgencyLevel,
  StepType,
  StepCompletionRule,
  UserRole,
};

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  organizationId: string | null;
  organizationName: string;
  departmentId: string | null;
  departmentName?: string;
}

export interface DocumentItem {
  id: string;
  documentNumber: string;
  title: string;
  templateCode: string;
  templateTitle: string;
  status: DocumentStatus;
  urgency: UrgencyLevel;
  createdById: string;
  createdByName: string;
  organizationId?: string | null;
  organizationName?: string;
  departmentName?: string;
  currentStepOrder: number;
  totalSteps: number;
  currentStepName: string;
  dueDate?: string | null;
  isOverdue?: boolean;
  slaStatus?: 'ON_TRACK' | 'NEAR_DUE' | 'OVERDUE' | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentVersionView {
  id: string;
  versionNumber: number;
  formData: Record<string, any>;
  sha256Hash: string;
  changeSummary?: string | null;
  createdAt: string;
}

export interface StepAssigneeView {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  role: AssigneeRole;
  decision: AssigneeDecision;
  decisionComment?: string;
  decidedAt?: string;
}

export interface WorkflowStepView {
  id: string;
  stepOrder: number;
  stepName: string;
  stepType: StepType;
  completionRule: StepCompletionRule;
  status: StepStatus;
  dueDate?: string | null;
  dueDays?: number | null;
  isOverdue?: boolean;
  assignees: StepAssigneeView[];
}

export interface DecisionHistoryView {
  id: string;
  stepOrder: number;
  stepName: string;
  userId: string;
  userName: string;
  role: AssigneeRole;
  decision: AssigneeDecision;
  decisionComment?: string;
  decidedAt: string;
}

export interface SignatureView {
  id: string;
  userId: string;
  userName: string;
  signatureImageUrl: string;
  signedAt: string;
  isValid: boolean;
  contentHash: string;
}

export interface StepReassignmentHistoryView {
  id: string;
  stepId: string;
  stepName?: string;
  stepOrder?: number;
  oldUserId: string;
  oldUserName: string;
  newUserId: string;
  newUserName: string;
  reassignedById: string;
  reassignedByName: string;
  reason: string;
  createdAt: string;
}

export interface InAppNotification {
  id: string;
  userId: string;
  documentId?: string;
  documentNumber?: string;
  documentTitle?: string;
  type: string;
  title: string;
  content: string;
  isRead: boolean;
  readAt?: string | null;
  createdAt: string;
}

export interface DocumentDetail extends DocumentItem {
  currentVersion: number;
  versions: DocumentVersionView[];
  activeVersion: DocumentVersionView;
  workflow: {
    id: string;
    status: WorkflowStatus;
    currentStepOrder: number;
    steps: WorkflowStepView[];
  };
  decisionHistories: DecisionHistoryView[];
  signatures: SignatureView[];
  reassignmentHistories?: StepReassignmentHistoryView[];
  // Quyền hạn của user hiện tại trên hồ sơ này (tính toán sẵn từ Principal)
  permissions: {
    canApprove: boolean;
    canResubmit: boolean;
    canCancel: boolean;
    canReassign?: boolean;
    isCreator: boolean;
    isAdmin: boolean;
    currentStepAssigneeRole?: AssigneeRole;
  };
}

export interface ProcessDecisionPayload {
  decision: AssigneeDecision;
  decisionComment?: string;
  signatureImageUrl?: string;
}

export interface ResubmitPayload {
  formData: Record<string, any>;
  changeSummary?: string;
}

export interface CancelPayload {
  cancelReason?: string;
}

export interface ReassignApproverPayload {
  stepId?: string;
  oldUserId: string;
  newUserId: string;
  reason: string;
}

export interface DocumentPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface DocumentListResult {
  items: DocumentItem[];
  pagination: DocumentPagination;
}

export interface DocumentListQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: DocumentStatus | string;
}

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface IDocumentService {
  getCurrentUser(): Promise<UserProfile>;
  getDocuments(
    tab: 'pending_my_approval' | 'my_documents' | 'all',
    query?: DocumentListQuery
  ): Promise<DocumentItem[]>;
  getDocumentList?(
    tab: 'pending_my_approval' | 'my_documents' | 'all',
    query?: DocumentListQuery
  ): Promise<DocumentListResult>;
  getDocumentDetail(id: string): Promise<DocumentDetail>;
  processDecision(
    id: string,
    payload: ProcessDecisionPayload
  ): Promise<{ success: boolean; documentStatus: DocumentStatus }>;
  resubmitDocument(
    id: string,
    payload: ResubmitPayload
  ): Promise<{ success: boolean; newVersionNumber: number }>;
  cancelDocument(
    id: string,
    payload: CancelPayload
  ): Promise<{ success: boolean }>;
  reassignApprover(
    id: string,
    payload: ReassignApproverPayload
  ): Promise<{ success: boolean; message?: string }>;
  createDocument?(
    payload: import('./template.js').CreateDocumentPayload
  ): Promise<import('./template.js').CreatedDocumentResult>;
}


