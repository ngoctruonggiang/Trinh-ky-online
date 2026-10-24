import {
  AssigneeDecision,
  AssigneeRole,
  DocumentStatus,
  StepCompletionRule,
  StepStatus,
  StepType,
  UrgencyLevel,
  UserRole,
  WorkflowStatus,
} from '@trinh-ky/shared';

export interface DocumentListItemDto {
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

export interface PaginatedDocumentsDto {
  items: DocumentListItemDto[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface DocumentVersionViewDto {
  id: string;
  versionNumber: number;
  formData: Record<string, any>;
  sha256Hash: string;
  changeSummary?: string | null;
  createdAt: string;
}

export interface StepAssigneeViewDto {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  role: AssigneeRole;
  decision: AssigneeDecision;
  decisionComment?: string;
  decidedAt?: string;
}

export interface WorkflowStepViewDto {
  id: string;
  stepOrder: number;
  stepName: string;
  stepType: StepType;
  completionRule: StepCompletionRule;
  status: StepStatus;
  dueDate?: string | null;
  dueDays?: number | null;
  isOverdue?: boolean;
  assignees: StepAssigneeViewDto[];
}

export interface DecisionHistoryViewDto {
  id: string;
  stepOrder: number;
  stepName: string;
  userId: string;
  userName: string;
  role: AssigneeRole;
  decision: AssigneeDecision;
  decisionComment?: string;
  decidedAt: string;
  isDelegated?: boolean;
  delegatedFromUserId?: string;
  delegatedFromUserName?: string;
  delegationPolicyId?: string;
}

export interface SignatureViewDto {
  id: string;
  userId: string;
  userName: string;
  signatureImageUrl: string;
  signedAt: string;
  isValid: boolean;
  contentHash: string;
}

export interface StepReassignmentHistoryViewDto {
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

export interface DocumentPermissionsDto {
  canApprove: boolean;
  canResubmit: boolean;
  canCancel: boolean;
  canReassign: boolean;
  isCreator: boolean;
  isAdmin: boolean;
  currentStepAssigneeRole?: AssigneeRole;
  isDelegatedApproval?: boolean;
  delegatedFromUserName?: string;
}

export interface DocumentDetailDto extends DocumentListItemDto {
  currentVersion: number;
  versions: DocumentVersionViewDto[];
  activeVersion: DocumentVersionViewDto;
  workflow: {
    id: string;
    status: WorkflowStatus;
    currentStepOrder: number;
    steps: WorkflowStepViewDto[];
  };
  decisionHistories: DecisionHistoryViewDto[];
  signatures: SignatureViewDto[];
  reassignmentHistories: StepReassignmentHistoryViewDto[];
  permissions: DocumentPermissionsDto;
}

