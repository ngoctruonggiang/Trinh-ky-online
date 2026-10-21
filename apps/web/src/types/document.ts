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
  // Quyền hạn của user hiện tại trên hồ sơ này (tính toán sẵn từ Principal)
  permissions: {
    canApprove: boolean;
    canResubmit: boolean;
    canCancel: boolean;
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
