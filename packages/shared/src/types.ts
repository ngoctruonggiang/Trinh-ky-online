import {
  ArtifactStatus,
  ArtifactType,
  CertificateStatus,
  KeyStorageType,
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

export interface DelegationPolicyView {
  id: string;
  organizationId: string;
  delegatorId: string;
  delegatorName?: string;
  delegatorEmail?: string;
  delegateeId: string;
  delegateeName?: string;
  delegateeEmail?: string;
  startDate: string;
  endDate: string;
  scopeDepartmentId?: string | null;
  scopeDepartmentName?: string | null;
  scopeTemplateId?: string | null;
  scopeTemplateTitle?: string | null;
  reason?: string | null;
  isActive: boolean;
  createdById: string;
  createdByName?: string;
  revokedAt?: string | null;
  revokedById?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDelegationPolicyDto {
  delegatorId?: string; // Tùy chọn nếu người dùng tự ủy quyền, bắt buộc nếu Admin tạo
  delegateeId: string;
  startDate: string; // ISO string
  endDate: string; // ISO string
  scopeDepartmentId?: string | null;
  scopeTemplateId?: string | null;
  reason?: string | null;
}

export interface UpdateDelegationPolicyDto {
  endDate?: string;
  scopeDepartmentId?: string | null;
  scopeTemplateId?: string | null;
  reason?: string | null;
}

export interface DocumentArtifactView {
  id: string;
  documentId: string;
  documentVersionId: string;
  organizationId: string;
  artifactType: ArtifactType;
  status: ArtifactStatus;
  storageKey?: string | null;
  mimeType: string;
  sizeBytes?: number | null;
  rawPdfHash?: string | null;
  formDataHash: string;
  signedPdfHash?: string | null;
  requestedById: string;
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  downloadUrl?: string;
}

export interface DigitalCertificateView {
  id: string;
  organizationId: string;
  userId: string | null;
  subjectDn: string;
  issuerDn: string;
  serialNumber: string;
  fingerprintSha256: string;
  certificatePem: string;
  validFrom: string;
  validTo: string;
  status: CertificateStatus;
  keyStorageType: KeyStorageType;
  keyAlias: string;
  createdAt: string;
  updatedAt: string;
  userFullName?: string | null;
}

export interface RegisterCertificateDto {
  userId?: string | null;
  certificatePem: string;
  keyAlias: string;
  keyStorageType?: KeyStorageType;
}

export interface UpdateCertificateStatusDto {
  status: CertificateStatus;
  reason?: string;
}

export interface SignDocumentDto {
  certificateId?: string;
  reason?: string;
  contactInfo?: string;
  location?: string;
  versionNumber?: number;
  requireTimestamp?: boolean;
  includeLtv?: boolean;
  stepId?: string;
  isDelegated?: boolean;
  delegatedFromUserId?: string;
  delegationPolicyId?: string;
}

export interface SignedPdfArtifactView {
  id: string;
  signedPdfHash: string;
  rawPdfHash?: string;
  signerName?: string;
  signerSubject?: string;
  signingTime?: string;
  hasTimestamp: boolean;
  timestampGenTime?: string;
  tsaSubject?: string;
  hasLtv: boolean;
  ltvStatus?: string;
  dssCertsCount?: number;
  dssOcspsCount?: number;
  dssCrlsCount?: number;
  ltvEmbeddedAt?: string;
  padesLevel: 'PADES_B_B' | 'PADES_B_T' | 'PADES_B_LT';
  downloadUrl: string;
  verifyLtvUrl: string;
}

export interface SignDocumentResultView {
  artifactId: string;
  documentId: string;
  documentVersionId: string;
  status: ArtifactStatus;
  signedPdfHash: string;
  rawPdfHash: string;
  formDataHash: string;
  sizeBytes: number;
  byteRange: number[];
  signerSubject: string;
  signerIssuer: string;
  signingTime: string;
  isSignatureVerified: boolean;
  downloadUrl: string;
  hasTimestamp: boolean;
  timestampGenTime?: string;
  tsaSubject?: string;
  hasLtv?: boolean;
  ltvStatus?: string;
  padesLevel?: string;
  dssCertsCount?: number;
  dssOcspsCount?: number;
  dssCrlsCount?: number;
  ltvEmbeddedAt?: string;
}

export interface PdfSignatureVerificationResult {
  isValid: boolean;
  isDigestValid: boolean;
  isSignatureValid: boolean;
  isTampered: boolean;
  signatureIntegrity?: boolean;
  certificatePathValid?: boolean;
  revocationStatus?: 'GOOD' | 'REVOKED' | 'UNKNOWN' | 'UNAVAILABLE';
  timestampStatus?: 'VALID' | 'EXPIRED' | 'UNTRUSTED_TSA' | 'MISSING';
  signerSubject?: string;
  signerIssuer?: string;
  serialNumber?: string;
  signingTime?: string;
  byteRange?: number[];
  messageDigestHex?: string;
  computedDigestHex?: string;
  errorMessage?: string;
  hasTimestamp: boolean;
  isTimestampValid?: boolean;
  timestampGenTime?: string;
  tsaSubject?: string;
  tsaIssuer?: string;
  tsaSerialNumber?: string;
  tsaPolicyOid?: string;
  timestampErrorMessage?: string;
  hasLtv?: boolean;
  ltvDataPresent?: boolean;
  ltvValidationStatus?: 'VALID' | 'INCOMPLETE_CHAIN' | 'REVOCATION_DATA_MISSING' | 'EXPIRED' | 'REVOKED' | 'UNAVAILABLE';
  padesLevel?: 'NONE' | 'PADES_B_B' | 'PADES_B_T' | 'PADES_B_LT';
  dssInfo?: {
    certsCount: number;
    ocspsCount: number;
    crlsCount: number;
    vriEntriesCount: number;
  };
}

export interface AddLtvDto {
  versionNumber?: number;
}

export interface AddLtvResultView {
  artifactId: string;
  documentId: string;
  documentVersionId: string;
  signedPdfHash: string;
  sizeBytes: number;
  hasLtv: boolean;
  ltvStatus: string;
  padesLevel: string;
  dssCertsCount: number;
  dssOcspsCount: number;
  dssCrlsCount: number;
  embeddedAt: string;
  downloadUrl: string;
}

export interface LtvVerificationResult {
  isValid: boolean;
  signatureIntegrity: boolean;
  certificatePathValid: boolean;
  revocationStatus: 'GOOD' | 'REVOKED' | 'UNKNOWN' | 'UNAVAILABLE';
  timestampStatus: 'VALID' | 'EXPIRED' | 'UNTRUSTED_TSA' | 'MISSING';
  hasTimestamp: boolean;
  hasLtv: boolean;
  ltvDataPresent: boolean;
  ltvValidationStatus: 'VALID' | 'INCOMPLETE_CHAIN' | 'REVOCATION_DATA_MISSING' | 'EXPIRED' | 'REVOKED' | 'UNAVAILABLE';
  padesLevel: 'NONE' | 'PADES_B_B' | 'PADES_B_T' | 'PADES_B_LT';
  dssInfo?: {
    certsCount: number;
    ocspsCount: number;
    crlsCount: number;
    vriEntriesCount: number;
  };
  errorMessage?: string;
}
