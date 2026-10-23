# MEMORY LOG - DỰ ÁN TRÌNH KÝ ONLINE

## 1. Trạng thái hiện tại (Current State)
- **Tình trạng dự án:** Hoàn thành toàn diện Phase 12.0.1 — SLA Scheduler, Notification Reliability & Regression Verification (**214 Unit tests PASS [47 shared + 121 api + 46 web], 37 PostgreSQL Integration tests PASS [18 workflow integrity + 11 reassignment/SLA + 8 SLA scheduler/idempotency], 38/38 Live HTTP E2E tests PASS, `pnpm build` toàn monorepo PASS 100%**).
- **Trạng thái dịch vụ đang chạy phục vụ kiểm thử (Active Servers):**
  - **PostgreSQL Database:** Docker Container `trinh-ky-postgres-dev` (`postgres:16-alpine`) chạy healthy tại `localhost:5432`.
  - **Backend API Server (NestJS):** Đang chạy tại `http://localhost:4000`, SLA Scheduler timer nền hoạt động (tần suất 300s), sẵn sàng nhận request API.
  - **Frontend Web App (Next.js):** Đang cấu hình kết nối trực tiếp Real API (`NEXT_PUBLIC_USE_MOCK_API=false`), không âm thầm fallback sang mock.
- **Môi trường Database & Migrations:**
  - Áp dụng thành công migration `20261023110000_add_sla_tracking_and_notification_idempotency` trên CSDL PostgreSQL thật:
    - Bổ sung `slaWarningSentAt` và `slaOverdueSentAt` trên `approval_steps`.
    - Bổ sung `idempotencyKey` (@unique), `status` (enum `NotificationStatus: PENDING, SENT, FAILED`), `retryCount`, `errorMessage` trên `notifications`.
- **Tính năng hoàn tất trong Phase 12.0.1:**
  - **Hạng mục B & C (SLA Scheduler & Idempotency Bền vững):**
    - Cài đặt `SlaSchedulerService` quét định kỳ các bước `IN_PROGRESS` của hồ sơ `IN_REVIEW`.
    - Tính toán chính xác ngưỡng sắp đến hạn (`NEAR_DUE` trong vòng 24h) và quá hạn (`OVERDUE`).
    - Cơ chế Idempotency 2 lớp: (1) Khóa hàng bi quan `SELECT id FROM approval_steps WHERE id = :id FOR UPDATE` ngăn 2 worker chạy đè lên nhau; (2) Ràng buộc `idempotencyKey` `@unique` tại PostgreSQL ngăn chèn trùng lặp; bắt lỗi `P2002` an toàn.
    - Restart resilience: Transaction rollback tự động khi crash/restart, lần quét tiếp theo khôi phục và xử lý đầy đủ mà không mất dữ liệu.
    - Race condition safety: Bước duyệt chuyển sang `COMPLETED`, `CANCELLED` hoặc `REJECTED` trong lúc scheduler đang quét sẽ tự động bị bỏ qua, không bao giờ gửi cảnh báo cho bước đã kết thúc.
    - Decoupled state: Quá hạn SLA tuyệt đối không tự động duyệt hồ sơ (`OVERDUE !== APPROVED`).
  - **Hạng mục D (Bảo mật Notification API):**
    - Xác minh ranh giới quyền sở hữu: Người dùng chỉ được đọc/đánh dấu đã đọc thông báo của chính mình. Thao tác trên thông báo của người khác bị chặn `403 Forbidden`. Thông báo không tồn tại trả về `404 Not Found`.
    - Bộ lọc `isRead` và phân trang `page`/`limit` hoạt động chuẩn xác, không rò rỉ dữ liệu nhạy cảm của biểu mẫu.
  - **Endpoint mới:**
    - `POST /api/workflows/sla/trigger-check`: Kích hoạt quét SLA thủ công/worker (yêu cầu quyền `SUPER_ADMIN` hoặc `ADMIN`).
    - `GET /api/workflows/sla/status`: Thống kê trực tiếp tình trạng SLA các hồ sơ đang xử lý.

## 2. Quyết định kỹ thuật & Kiến trúc (Key Decisions)
- **Database-Backed Idempotency via Unique Constraint:**
  - Mọi thông báo hệ thống tự động (SLA warning, SLA overdue, phân công duyệt) đều bắt buộc gán `idempotencyKey` với format chuẩn `TYPE:stepId:userId`. Ràng buộc `@unique` tại PostgreSQL là nguồn chân lý duy nhất chống duplicate notification.
- **Pessimistic Step Locking in Scheduler (`FOR UPDATE`):**
  - Quá trình xử lý SLA từng bước được bọc trong transaction với khóa `FOR UPDATE` trên `approval_steps`. Kiểm tra lại trạng thái bước ngay sau khi có khóa để loại bỏ race condition khi người duyệt bấm duyệt cùng lúc với scheduler quét.
- **Fail-Safe Notification Status & Retry:**
  - Bổ sung enum `NotificationStatus` (`PENDING`, `SENT`, `FAILED`) và phương thức `retryFailedNotifications` để hỗ trợ cơ chế retry độc lập khi mở rộng sang các kênh thông báo bên ngoài (Email, Webhook).

## 3. Nhật ký thay đổi gần nhất (Recent Changes)
- `[2026-10-23 - Phase 12.0.1: SLA Scheduler, Notification Reliability & Regression Verification]`:
  - **Files:** `packages/shared/src/enums.ts`, `apps/api/prisma/schema.prisma`, migration `20261023110000`, `apps/api/src/modules/workflow/sla-scheduler.service.ts`, `apps/api/src/modules/workflow/sla-scheduler.controller.ts`, `apps/api/src/modules/notification/notification.service.ts`, `apps/api/test/sla-scheduler-idempotency-postgresql.integration.spec.ts`, `apps/api/test/e2e-http-live.ts`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 214/214 Unit tests PASS [47 shared + 121 api + 46 web]; 37/37 PostgreSQL integration tests PASS; 38/38 Live HTTP E2E tests PASS; Monorepo build PASS 100%.
- `[2026-10-23 - Phase 12: Advanced Approval Features & Exception Handling]`:
  - **Files:** `packages/shared/src/enums.ts`, `packages/shared/src/types.ts`, `apps/api/prisma/schema.prisma`, migrations `20261023092601` và `20261023100000`, `apps/api/src/modules/workflow/*`, `apps/api/src/modules/notification/*`, `apps/web/src/types/document.ts`, `apps/web/src/services/api/*`, `apps/web/src/components/documents/*`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 200/200 Unit tests PASS; 29/29 PostgreSQL integration tests PASS; 32/32 Live HTTP E2E tests PASS; Monorepo build PASS 100%.
- `[2026-10-23 - Phase 11.1: End-to-End Verification & Workflow Integrity]`:
  - **Files:** `packages/shared/src/workflow-fsm.ts`, `apps/api/src/modules/workflow/workflow-orchestrator.service.ts`, `apps/api/test/workflow-integrity-postgresql.integration.spec.ts`, `apps/api/test/e2e-http-live.ts`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 187/187 Unit tests PASS; 62/62 PostgreSQL integration tests PASS; 26/26 Live HTTP E2E tests PASS; Monorepo build PASS 100%.
- `[2026-10-22 - Phase 11: Workflow Builder & Versioned Approval Engine]`:
  - **Files:** `packages/shared/src/workflow-schema.ts`, `apps/api/prisma/schema.prisma`, `apps/api/src/modules/workflow-template/*`, `apps/web/src/components/workflow-builder/*`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 186/186 Unit tests PASS; 44/44 PostgreSQL integration tests PASS; 22/22 Live HTTP E2E tests PASS; Monorepo build PASS 100%.
- `[2026-10-22 - Phase 10.1: Form Builder Verification & Hardening]`:
  - **Files:** `packages/shared/src/template-schema.ts`, `apps/api/src/modules/template/*`, `apps/api/test/template-postgresql.integration.spec.ts`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 153/153 Unit tests PASS; 32/32 PostgreSQL integration tests PASS; 16/16 Live HTTP E2E tests PASS; Monorepo build PASS 100%.
