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
  version?: number; // Hỗ trợ optimistic concurrency
  assignees: WorkflowAssignee[];
  dueDate?: string; // Hạn hoàn thành bước theo SLA (ISO string)
  dueDays?: number; // Số ngày xử lý tối đa theo SLA
  startedAt?: string;
  completedAt?: string;
}

export interface WorkflowInstance {
  id: string;
  documentId: string;
  status: WorkflowStatus;
  currentStepOrder: number;
  version?: number; // Hỗ trợ optimistic concurrency
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

export interface ProcessDecisionParams {
  workflow: WorkflowInstance;
  documentStatus?: DocumentStatus;
  userId: string;
  decision: AssigneeDecision;
  decisionComment?: string;
  existingSignatures?: SignatureRecord[];
  nowISO?: string;
}

export interface StartWorkflowParams {
  workflow: WorkflowInstance;
  documentStatus?: DocumentStatus;
  nowISO?: string;
}

export interface ResubmitWorkflowParams {
  workflow: WorkflowInstance;
  documentStatus: DocumentStatus;
  resubmittedById: string;
  changeSummary?: string;
  nowISO?: string;
}

export interface CancelWorkflowParams {
  workflow: WorkflowInstance;
  documentStatus: DocumentStatus;
  cancelledById: string;
  cancelReason?: string;
  nowISO?: string;
}

