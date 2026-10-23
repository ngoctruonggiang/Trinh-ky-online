# MEMORY LOG - DỰ ÁN TRÌNH KÝ ONLINE

## 1. Trạng thái hiện tại (Current State)
- **Tình trạng dự án:** Hoàn thành toàn diện Phase 12 — Advanced Approval Features & Exception Handling (**200 Unit tests PASS [47 shared + 107 api + 46 web], 29 PostgreSQL Integration tests PASS [18 workflow integrity + 11 reassignment/SLA], 32/32 Live HTTP E2E tests PASS, `pnpm build` toàn monorepo PASS 100%**).
- **Trạng thái dịch vụ đang chạy phục vụ kiểm thử (Active Servers):**
  - **PostgreSQL Database:** Docker Container `trinh-ky-postgres-dev` (`postgres:16-alpine`) chạy healthy tại `localhost:5432`.
  - **Backend API Server (NestJS):** Đang chạy tại `http://localhost:4000` (PID / daemon task active), sẵn sàng nhận request từ frontend và các kịch bản test API.
  - **Frontend Web App (Next.js):** Đang cấu hình kết nối trực tiếp Real API (`NEXT_PUBLIC_USE_MOCK_API=false`), không âm thầm fallback sang mock.
- **Môi trường Database & Migrations:**
  - 2 migration mới trong Phase 12 đã áp dụng an toàn vào PostgreSQL thật:
    1. `20261023092601_add_reassignment_and_sla_notifications`: Thêm `dueDate` trên `documents` và `approval_steps`, bảng `step_reassignment_histories`, enum `NotificationType`, bảng `notifications`.
    2. `20261023100000_add_step_due_days`: Thêm `dueDays` trên `approval_steps` để lưu vết SLA từng bước.
- **Tính năng hoàn tất trong Phase 12:**
  - **Hạng mục A (Reassign Approver):** Cho phép chuyển giao người duyệt tại bước `IN_PROGRESS` của hồ sơ `IN_REVIEW`. Phân quyền nghiêm ngặt (`SUPER_ADMIN`, `ADMIN` cùng công ty, hoặc chính người duyệt cũ). Chặn người nhận inactive/khác công ty/trùng người cũ. Bảo toàn quyết định cũ (chỉ thay thế assignee `PENDING`), không mở lại bước đã hoàn tất trong `ANY_CAN_APPROVE`, không làm thay đổi các quyết định khác trong `ALL_MUST_APPROVE`. Khóa hàng bi quan `SELECT ... FOR UPDATE` chống race condition. Ghi vết `StepReassignmentHistory`, `AuditLog` và bắn thông báo In-App. Không bao giờ tự động chuyển trạng thái hồ sơ sang `APPROVED`.
  - **Hạng mục B (Delegate Approver Architecture):** Đã phân định ranh giới rõ ràng: Reassignment (chuyển giao tại bước/hồ sơ cụ thể khi người duyệt nghỉ/chuyển công tác) vs Delegation (chính sách ủy quyền dài hạn/theo thời gian giữa 2 user). Phạm vi delegation được báo cáo kiến trúc độc lập, không làm sơ sài.
  - **Hạng mục C (SLA & Hạn xử lý):** Lưu `dueDate` và `dueDays` trên từng bước và hồ sơ. Tính hạn `startedAt + dueDays * 24h`. Phân tách hoàn toàn trạng thái SLA (`ON_TRACK`, `NEAR_DUE`, `OVERDUE`) khỏi trạng thái nghiệp vụ. Quá hạn tuyệt đối không coi là tự động duyệt (`OVERDUE !== APPROVED`).
  - **Hạng mục D (In-App Notifications):** Module hóa `NotificationModule`, lưu CSDL PostgreSQL, hỗ trợ truy vấn danh sách, đếm unread và đánh dấu đã đọc (`PATCH /api/notifications/:id/read`, `PATCH /api/notifications/read-all`). Tự động sinh thông báo khi giao bước, chuyển giao, yêu cầu sửa hoặc chốt kết quả.
  - **Hạng mục E (Giao diện Người dùng Web):** Tích hợp nút và modal chuyển giao người duyệt trong `WorkflowActionBox` (chỉ hiện khi có quyền `canReassign`), bảng lịch sử chuyển giao `StepReassignmentHistory`, banner SLA cảnh báo trực quan (`OVERDUE` đỏ, `NEAR_DUE` vàng), chuông thông báo In-App trên `Header` với dropdown thời gian thực.

## 2. Quyết định kỹ thuật & Kiến trúc (Key Decisions)
- **Immutability of Prior Decisions in Reassignment:**
  - Thao tác chuyển giao chỉ được phép thay thế một bản ghi `StepAssignee` có `decision: 'PENDING'`. Mọi bản ghi đã `APPROVED`, `REJECTED`, `REVISION_REQUESTED` là bất biến tuyệt đối.
  - Chuyển giao trong `ALL_MUST_APPROVE` chỉ thay thế slot của người chưa duyệt; các quyết định của các assignee khác trong bước được bảo toàn 100%.
- **Pessimistic Locking on Reassignment:**
  - Áp dụng `SELECT id FROM documents WHERE id = :id FOR UPDATE` ngay đầu giao dịch `reassignApprover`, đồng thời kiểm tra lại trạng thái hồ sơ và bước duyệt trong transaction để loại bỏ triệt để race condition khi có 2 admin chuyển giao cùng lúc hoặc vừa chuyển giao vừa có người duyệt.
- **Decoupled SLA State Model:**
  - Trạng thái quá hạn (`isOverdue: true`, `slaStatus: 'OVERDUE'`) là thuộc tính hiển thị/giám sát, tuyệt đối không tự động kích hoạt chuyển trạng thái máy FSM của hồ sơ sang `APPROVED` hay `REJECTED`.
- **Fail-Fast Tenant & Inactivity Validation:**
  - Backend kiểm tra người nhận mới bắt buộc phải có `isActive: true` và `organizationId === document.organizationId`. Nếu vi phạm lập tức từ chối `400 Bad Request` và rollback transaction.

## 3. Nhật ký thay đổi gần nhất (Recent Changes)
- `[2026-10-23 - Phase 12: Advanced Approval Features & Exception Handling]`:
  - **Files:** `packages/shared/src/enums.ts`, `packages/shared/src/types.ts`, `apps/api/prisma/schema.prisma`, migrations `20261023092601` và `20261023100000`, `apps/api/src/modules/workflow/*`, `apps/api/src/modules/notification/*`, `apps/api/test/reassignment-sla-postgresql.integration.spec.ts`, `apps/api/test/e2e-http-live.ts`, `apps/web/src/types/document.ts`, `apps/web/src/services/api/*`, `apps/web/src/components/documents/*`, `apps/web/src/components/layout/header.tsx`, `apps/web/src/app/documents/[id]/page.tsx`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 200/200 Unit tests PASS [47 shared + 107 api + 46 web]; 29/29 PostgreSQL integration tests PASS; 32/32 Live HTTP E2E tests PASS; Monorepo build PASS 100%.
- `[2026-10-23 - Phase 11.1: End-to-End Verification & Workflow Integrity]`:
  - **Files:** `packages/shared/src/workflow-fsm.ts`, `apps/api/src/modules/workflow/workflow-orchestrator.service.ts`, `apps/api/test/workflow-integrity-postgresql.integration.spec.ts`, `apps/api/test/e2e-http-live.ts`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 187/187 Unit tests PASS; 62/62 PostgreSQL integration tests PASS; 26/26 Live HTTP E2E tests PASS; Monorepo build PASS 100%.
- `[2026-10-22 - Phase 11: Workflow Builder & Versioned Approval Engine]`:
  - **Files:** `packages/shared/src/workflow-schema.ts`, `apps/api/prisma/schema.prisma`, `apps/api/src/modules/workflow-template/*`, `apps/web/src/components/workflow-builder/*`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 186/186 Unit tests PASS; 44/44 PostgreSQL integration tests PASS; 22/22 Live HTTP E2E tests PASS; Monorepo build PASS 100%.
- `[2026-10-22 - Phase 10.1: Form Builder Verification & Hardening]`:
  - **Files:** `packages/shared/src/template-schema.ts`, `apps/api/src/modules/template/*`, `apps/api/test/template-postgresql.integration.spec.ts`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 153/153 Unit tests PASS; 32/32 PostgreSQL integration tests PASS; 16/16 Live HTTP E2E tests PASS; Monorepo build PASS 100%.
- `[2026-10-21 - Phase 10: Form Builder & Dynamic Template Engine]`:
  - **Files:** `packages/shared/src/template-schema.ts`, `apps/api/src/modules/template/*`, `apps/web/src/components/form-builder/*`.
  - **Kết quả:** 140 Unit tests PASS; 28 PostgreSQL integration tests PASS; Monorepo build PASS 100%.
