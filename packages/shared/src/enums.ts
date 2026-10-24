/**
 * Các Enums chuẩn hóa cho toàn bộ hệ thống Trình ký Online
 */

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN', // Admin tập đoàn, quản trị toàn hệ thống
  ADMIN = 'ADMIN',             // Admin phòng ban / quản lý danh mục
  USER = 'USER',               // Nhân viên thông thường
}

export enum TemplateStatus {
  DRAFT = 'DRAFT',         // Bản nháp đang thiết kế
  PUBLISHED = 'PUBLISHED', // Đã phát hành, mọi nhân viên có thể sử dụng
  ARCHIVED = 'ARCHIVED',   // Đã lưu trữ, ngưng áp dụng
}

export enum UrgencyLevel {
  LOW = 'LOW',         // Thấp
  NORMAL = 'NORMAL',   // Bình thường
  URGENT = 'URGENT',   // Gấp
  EMERGENCY = 'EMERGENCY', // Khẩn cấp
}

export enum DocumentStatus {
  DRAFT = 'DRAFT',                       // Bản nháp của người tạo
  SUBMITTED = 'SUBMITTED',               // Đã gửi trình duyệt, chờ bước đầu tiên khởi động
  IN_REVIEW = 'IN_REVIEW',               // Đang trong quy trình duyệt
  REVISION_REQUESTED = 'REVISION_REQUESTED', // Có cấp duyệt yêu cầu chỉnh sửa lại nội dung
  APPROVED = 'APPROVED',                 // Toàn bộ các bước đã duyệt hoàn tất
  REJECTED = 'REJECTED',                 // Bị từ chối ở một bước phê duyệt
  CANCELLED = 'CANCELLED',               // Người tạo chủ động hủy hồ sơ
}

export enum WorkflowStatus {
  PENDING = 'PENDING',       // Chưa kích hoạt
  RUNNING = 'RUNNING',       // Đang chạy các bước
  COMPLETED = 'COMPLETED',   // Toàn bộ quy trình hoàn tất
  REJECTED = 'REJECTED',     // Quy trình kết thúc do bị từ chối
  CANCELLED = 'CANCELLED',   // Quy trình bị hủy
}

export enum StepType {
  SEQUENTIAL = 'SEQUENTIAL', // Duyệt tuần tự từng người
  PARALLEL = 'PARALLEL',     // Duyệt song song nhiều người cùng lúc
}

export enum StepCompletionRule {
  ALL_MUST_APPROVE = 'ALL_MUST_APPROVE', // Tất cả người duyệt trong bước phải đồng ý
  ANY_CAN_APPROVE = 'ANY_CAN_APPROVE',   // Chỉ cần 1 người duyệt đồng ý là bước hoàn thành
}

export enum StepStatus {
  WAITING = 'WAITING',                     // Chưa đến lượt xử lý
  IN_PROGRESS = 'IN_PROGRESS',             // Đang chờ người trong bước xử lý
  COMPLETED = 'COMPLETED',                 // Bước đã hoàn thành phê duyệt
  REJECTED = 'REJECTED',                   // Bước bị từ chối
  REVISION_REQUESTED = 'REVISION_REQUESTED', // Bước yêu cầu sửa
  SKIPPED = 'SKIPPED',                     // Bước bị bỏ qua (nếu có điều kiện rẽ nhánh)
  CANCELLED = 'CANCELLED',                 // Bị hủy
}

export enum AssigneeRole {
  APPROVER = 'APPROVER', // Người có quyền ký/duyệt hoặc từ chối
  REVIEWER = 'REVIEWER', // Người theo dõi/giám sát, chỉ được xem, nhận thông báo và bình luận
}

export enum AssigneeDecision {
  PENDING = 'PENDING',                     // Chưa đưa ra quyết định
  APPROVED = 'APPROVED',                   // Đồng ý / Phê duyệt
  REJECTED = 'REJECTED',                   // Từ chối phê duyệt
  REVISION_REQUESTED = 'REVISION_REQUESTED', // Yêu cầu chỉnh sửa lại hồ sơ
}

export enum SignatureType {
  DRAWN_SIGNATURE = 'DRAWN_SIGNATURE', // Ký vẽ trực tiếp bằng tay/chuột/bút cảm ứng
  IMAGE_UPLOAD = 'IMAGE_UPLOAD',       // Tải ảnh chữ ký cá nhân từ máy tính
  SYSTEM_FONT = 'SYSTEM_FONT',         // Chữ ký tạo tự động theo font chữ nghệ thuật
}

export enum AuditAction {
  CREATE_DOCUMENT = 'CREATE_DOCUMENT',
  UPDATE_DOCUMENT = 'UPDATE_DOCUMENT',
  SUBMIT_DOCUMENT = 'SUBMIT_DOCUMENT',
  APPROVE_STEP = 'APPROVE_STEP',
  REJECT_STEP = 'REJECT_STEP',
  REQUEST_REVISION = 'REQUEST_REVISION',
  RESUBMIT_DOCUMENT = 'RESUBMIT_DOCUMENT',
  CANCEL_DOCUMENT = 'CANCEL_DOCUMENT',
  REASSIGN_APPROVER = 'REASSIGN_APPROVER',
  ADD_COMMENT = 'ADD_COMMENT',
  SIGN_DOCUMENT = 'SIGN_DOCUMENT',
  INVALIDATE_SIGNATURE = 'INVALIDATE_SIGNATURE',
  VIEW_DOCUMENT = 'VIEW_DOCUMENT',
  DOWNLOAD_PDF = 'DOWNLOAD_PDF',
  CREATE_DELEGATION_POLICY = 'CREATE_DELEGATION_POLICY',
  UPDATE_DELEGATION_POLICY = 'UPDATE_DELEGATION_POLICY',
  REVOKE_DELEGATION_POLICY = 'REVOKE_DELEGATION_POLICY',
  RENDER_PDF = 'RENDER_PDF',
}

export enum NotificationType {
  ASSIGNED_STEP = 'ASSIGNED_STEP',
  REASSIGNED_STEP = 'REASSIGNED_STEP',
  REVISION_REQUESTED = 'REVISION_REQUESTED',
  DOCUMENT_APPROVED = 'DOCUMENT_APPROVED',
  DOCUMENT_REJECTED = 'DOCUMENT_REJECTED',
  SLA_WARNING = 'SLA_WARNING',
  SLA_OVERDUE = 'SLA_OVERDUE',
  DELEGATION_ASSIGNED = 'DELEGATION_ASSIGNED',
  DELEGATION_REVOKED = 'DELEGATION_REVOKED',
}

export enum NotificationStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
}

export enum ArtifactType {
  PREVIEW = 'PREVIEW',
  OFFICIAL_UNSIGNED = 'OFFICIAL_UNSIGNED',
}

export enum ArtifactStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

