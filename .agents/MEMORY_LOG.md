# MEMORY LOG - DỰ ÁN TRÌNH KÝ ONLINE

## 1. Trạng thái hiện tại (Current State)
- **Tình trạng dự án:** Hoàn thành toàn diện Phase 12.0.2 — Notification Reliability Audit & Production Readiness Gate (**218 Unit tests PASS [47 shared + 125 api + 46 web], 86 PostgreSQL Integration tests PASS [11 template + 14 read-api + 7 workflow + 12 workflow-template + 18 workflow-integrity + 11 reassignment/SLA + 13 SLA scheduler/idempotency/retry], 41/41 Live HTTP E2E tests PASS, `pnpm build` toàn monorepo PASS 100%**).
- **Trạng thái dịch vụ đang chạy phục vụ kiểm thử (Active Servers):**
  - **PostgreSQL Database:** Docker Container `trinh-ky-postgres-dev` (`postgres:16-alpine`) chạy healthy tại `localhost:5432`.
  - **Backend API Server (NestJS):** Đang chạy tại `http://localhost:4000`, SLA Scheduler worker (chu kỳ 300s) và Notification Retry Worker (chu kỳ 60s) hoạt động nền an toàn.
  - **Frontend Web App (Next.js):** Đang cấu hình kết nối trực tiếp Real API (`NEXT_PUBLIC_USE_MOCK_API=false`), không âm thầm fallback sang mock.
- **Môi trường Database & Migrations:**
  - CSDL PostgreSQL thật đang ở trạng thái up-to-date với 7 migrations (migration gần nhất `20261023110000_add_sla_tracking_and_notification_idempotency`). Toàn bộ migration an toàn 100% với dữ liệu hiện hữu.
- **Tính năng hoàn tất và gia cố trong Phase 12.0.2:**
  - **Mục 3 (Notification Retry Worker & Phục hồi sau Restart):**
    - Cài đặt `OnModuleInit`/`OnModuleDestroy` cho `NotificationService` với worker nền tự động chạy định kỳ (mặc định 60s, biến môi trường `NOTIFICATION_RETRY_INTERVAL_MS`).
    - Nâng cấp `retryFailedNotifications`: Hỗ trợ cả trạng thái `FAILED` và `PENDING` (còn sót lại sau server restart); sử dụng cơ chế khóa `FOR UPDATE SKIP LOCKED` trên PostgreSQL thật để nhiều worker/instance chạy song song không tranh chấp và không cập nhật trùng.
    - Giới hạn số lần thử (`retryCount < maxRetries`), dừng retry khi vượt ngưỡng để loại trừ vòng lặp vô hạn của lỗi vĩnh viễn; xóa sạch `errorMessage` và chuyển sang `SENT` khi thành công; tuyệt đối không xử lý lại bản ghi đã `SENT`.
    - Thêm endpoint quản trị `POST /api/notifications/retry-failed` (yêu cầu quyền `SUPER_ADMIN` hoặc `ADMIN`).
  - **Mục 4 (Tính nguyên tử của SLA Scheduler & Khóa phân tán):**
    - Chống chạy chồng lấn nội bộ trong cùng 1 instance bằng cờ `isProcessing`.
    - Bảo vệ đa instance bằng Session Advisory Lock `SELECT pg_try_advisory_lock(88421941)` khi chạy quét toàn hệ thống.
    - Bắt lỗi `P2002` (Unique Constraint) trong vòng lặp tạo thông báo và ghi nhận trạng thái `SKIPPED_DUPLICATE` thay vì báo lỗi không kiểm soát.
  - **Mục 5 (Phân quyền & Tenant Isolation):**
    - `POST /api/workflows/sla/trigger-check`: Tenant `ADMIN` chỉ được phép kích hoạt quét trong phạm vi tổ chức của mình (`targetOrgId = user.organizationId`). Chỉ `SUPER_ADMIN` mới có quyền quét toàn hệ thống xuyên tổ chức.
    - `GET /api/workflows/sla/status`: Chặn người dùng thường (`USER`) với mã lỗi `403 Forbidden`. Tenant `ADMIN` chỉ xem số liệu trong tổ chức của mình; `SUPER_ADMIN` xem toàn hệ thống.
    - `POST /api/notifications/retry-failed`: Chặn `USER` với `403 Forbidden`.

## 2. Quyết định kỹ thuật & Kiến trúc (Key Decisions)
- **Multi-Worker Concurrency với `FOR UPDATE SKIP LOCKED`:**
  - Cơ chế retry notification trên PostgreSQL áp dụng lệnh `SELECT ... FOR UPDATE SKIP LOCKED` để phân phối tải động cho nhiều worker mà không bao giờ gây lock contention hay deadlock.
- **Two-Tier Multi-Instance Concurrency Control:**
  - Cấp 1 (Instance level): Session Advisory Lock `pg_try_advisory_lock` ngăn nhiều instance cùng quét toàn hệ thống.
  - Cấp 2 (Row level): Pessimistic Lock `SELECT id FROM approval_steps WHERE id = :id FOR UPDATE` và ràng buộc `idempotencyKey @unique` bảo vệ tính toàn vẹn từng bước duyệt.
- **Tenant-Scoped Administrative Triggers:**
  - Mọi thao tác trigger quét hay giám sát từ `ADMIN` cấp công ty bắt buộc truyền và lọc theo `organizationId`, đảm bảo không rò rỉ hoặc tác động chéo tenant.

## 3. Nhật ký thay đổi gần nhất (Recent Changes)
- `[2026-10-23 - Phase 12.0.2: Notification Reliability Audit & Production Readiness Gate]`:
  - **Files:** `apps/api/src/modules/notification/notification.service.ts`, `apps/api/src/modules/notification/notification.controller.ts`, `apps/api/src/modules/notification/notification.service.spec.ts`, `apps/api/src/modules/workflow/sla-scheduler.service.ts`, `apps/api/src/modules/workflow/sla-scheduler.controller.ts`, `apps/api/src/modules/workflow/sla-scheduler.controller.spec.ts`, `apps/api/test/sla-scheduler-idempotency-postgresql.integration.spec.ts`, `apps/api/test/e2e-http-live.ts`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 218/218 Unit tests PASS [47 shared + 125 api + 46 web]; 86/86 PostgreSQL integration tests PASS; 41/41 Live HTTP E2E tests PASS; Monorepo build PASS 100%.
- `[2026-10-23 - Phase 12.0.1: SLA Scheduler, Notification Reliability & Regression Verification]`:
  - **Files:** `packages/shared/src/enums.ts`, `apps/api/prisma/schema.prisma`, migration `20261023110000`, `apps/api/src/modules/workflow/sla-scheduler.service.ts`, `apps/api/src/modules/workflow/sla-scheduler.controller.ts`, `apps/api/src/modules/notification/notification.service.ts`, `apps/api/test/sla-scheduler-idempotency-postgresql.integration.spec.ts`, `apps/api/test/e2e-http-live.ts`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 214/214 Unit tests PASS; 37/37 PostgreSQL integration tests PASS; 38/38 Live HTTP E2E tests PASS; Monorepo build PASS 100%.
- `[2026-10-23 - Phase 12: Advanced Approval Features & Exception Handling]`:
  - **Files:** `packages/shared/src/enums.ts`, `packages/shared/src/types.ts`, `apps/api/prisma/schema.prisma`, migrations `20261023092601` và `20261023100000`, `apps/api/src/modules/workflow/*`, `apps/api/src/modules/notification/*`, `apps/web/src/types/document.ts`, `apps/web/src/services/api/*`, `apps/web/src/components/documents/*`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 200/200 Unit tests PASS; 29/29 PostgreSQL integration tests PASS; 32/32 Live HTTP E2E tests PASS; Monorepo build PASS 100%.
- `[2026-10-23 - Phase 11.1: End-to-End Verification & Workflow Integrity]`:
  - **Files:** `packages/shared/src/workflow-fsm.ts`, `apps/api/src/modules/workflow/workflow-orchestrator.service.ts`, `apps/api/test/workflow-integrity-postgresql.integration.spec.ts`, `apps/api/test/e2e-http-live.ts`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 187/187 Unit tests PASS; 62/62 PostgreSQL integration tests PASS; 26/26 Live HTTP E2E tests PASS; Monorepo build PASS 100%.
- `[2026-10-22 - Phase 11: Workflow Builder & Versioned Approval Engine]`:
  - **Files:** `packages/shared/src/workflow-schema.ts`, `apps/api/prisma/schema.prisma`, `apps/api/src/modules/workflow-template/*`, `apps/web/src/components/workflow-builder/*`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 186/186 Unit tests PASS; 44/44 PostgreSQL integration tests PASS; 22/22 Live HTTP E2E tests PASS; Monorepo build PASS 100%.

