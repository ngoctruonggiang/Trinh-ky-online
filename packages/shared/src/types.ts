import {
  AssigneeDecision,
  AssigneeRole,
  DocumentStatus,
  StepCompletionRule,
  StepStatus,
  StepType,
  UrgencyLevel,
  WorkflowStatus,
} from './enums.js';

export interface WorkflowAssignee {
  id: string;
  stepId: string;
  userId: string;
  userFullName: string;
  userEmail: string;
  role: AssigneeRole; // APPROVER hoặc REVIEWER
  decision: AssigneeDecision;
  decisionComment?: string;
  decidedAt?: string; // ISO date string
}

export interface WorkflowStep {
  id: string;
  workflowId: string;
  stepOrder: number;
  stepName: string;
  stepType: StepType;
  completionRule: StepCompletionRule;
  status: StepStatus;
  assignees: WorkflowAssignee[];
  startedAt?: string;
  completedAt?: string;
}

export interface WorkflowInstance {
  id: string;
  documentId: string;
  status: WorkflowStatus;
  currentStepOrder: number;
  steps: WorkflowStep[];
  startedAt?: string;
  completedAt?: string;
}

export interface SignatureRecord {
  id: string;
  documentId: string;
  versionNumber: number;
  stepId: string;
  userId: string;
  userFullName: string;
  signatureImageUrl: string;
  contentHash: string; // SHA-256 của tài liệu tại thời điểm ký
  signedAt: string;
  isValid: boolean; // false nếu bị vô hiệu hóa khi tài liệu bị sửa đổi (Revision)
  invalidatedReason?: string;
  invalidatedAt?: string;
}

export interface FSMTransitionResult {
  success: boolean;
  error?: string;
  newDocumentStatus: DocumentStatus;
  newWorkflowStatus: WorkflowStatus;
  updatedWorkflow: WorkflowInstance;
  shouldNotifyUserIds: string[];
  invalidatedSignatures?: SignatureRecord[];
}
