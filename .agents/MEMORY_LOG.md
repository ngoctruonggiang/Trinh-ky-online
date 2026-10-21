# MEMORY LOG - DỰ ÁN TRÌNH KÝ ONLINE

## 1. Trạng thái hiện tại (Current State)
- **Tình trạng dự án:** Hoàn thành Phase 7: PostgreSQL Integration & API Contract Verification (56/56 unit/regression tests passed 100%).
- **Tính năng vừa hoàn thành:**
  - `packages/shared`:
    - **Sửa lỗi tính nhất quán khi Cancel:** Cập nhật [workflow-fsm.ts](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/packages/shared/src/workflow-fsm.ts) để chuyển đổi trạng thái bước duyệt sang `CANCELLED` khi hồ sơ đang ở trạng thái `REVISION_REQUESTED`.
    - **Regression Tests:** Bổ sung test 15 & 16 trong [workflow-fsm.spec.ts](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/packages/shared/src/workflow-fsm.spec.ts) (tổng 16 tests pass).
  - `apps/api`:
    - **Cập nhật hủy bước trong Orchestrator:** Sửa `cancelDocument` trong [workflow-orchestrator.service.ts](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/api/src/modules/workflow/workflow-orchestrator.service.ts) đưa `StepStatus.REVISION_REQUESTED` vào `approvalStep.updateMany`.
    - **Orchestrator Regression Tests:** Bổ sung test 10 & 11 trong [workflow-orchestrator.service.spec.ts](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/api/src/modules/workflow/workflow-orchestrator.service.spec.ts) (tổng 11 tests pass).
    - **Integration Test Suite trên PostgreSQL Thật:** Xây dựng [workflow-postgresql.integration.spec.ts](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/api/test/workflow-postgresql.integration.spec.ts) với 7 kịch bản kiểm thử toàn diện bằng `PrismaClient` thật (Transaction Atomicity, OCC, Chữ ký SHA-256, Resubmit versioning v1/v2, Cancel, Duplicate Retry).
    - **Môi trường Database & Cấu hình:**
      - Tạo file [docker-compose.dev.yml](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/docker-compose.dev.yml) cho PostgreSQL 16 cục bộ.
      - Tạo mẫu [apps/api/.env.example](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/api/.env.example) an toàn, không chứa secret production.
      - Phân tách lệnh test trong [package.json](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/api/package.json): `"test"` (unit tests) và `"test:integration"` (real database integration).
    - **Hợp đồng API Toàn diện:** Xuất bản tài liệu [docs/API_CONTRACT.md](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/docs/API_CONTRACT.md) chi tiết 4 REST endpoints, mã lỗi, DTOs, và các lưu ý khi tích hợp Frontend.
- **Tính năng tiếp theo:**
  - Bắt đầu triển khai giao diện Frontend Next.js (`apps/web`) kết nối với REST API backend theo Hợp đồng API Contract.

## 2. Quyết định kỹ thuật & Kiến trúc (Key Decisions)
- **Kiểm soát Tương tranh Lạc quan (OCC) trong Luồng Song song:**
  - `ANY_CAN_APPROVE` sử dụng `updateMany` có điều kiện kép `status: IN_PROGRESS` và `version: currentStep.version`. Chỉ transaction đầu tiên có `count === 1` mới được quyền chuyển bước sau sang `IN_PROGRESS`, loại bỏ race condition kích hoạt bước kế 2 lần.
- **Bảo mật Ranh giới Đa tổ chức:**
  - `SUPER_ADMIN` quản trị toàn hệ thống; `ADMIN` và `USER` bị giới hạn trong `organizationId` của mình trên mọi thao tác `submit`, `decision`, `resubmit`, `cancel`.
- **Phân tách Rõ ràng giữa Unit Test và Integration Test:**
  - Unit test chạy bằng mock/in-memory (56 tests) phục vụ phản hồi nhanh trong quá trình dev.
  - Integration test chạy trực tiếp trên PostgreSQL thật qua `pnpm --filter @trinh-ky/api test:integration`. Nếu database chưa bật, runner hiển thị cảnh báo và hướng dẫn thiết lập minh bạch.

## 3. Nhật ký thay đổi gần nhất (Recent Changes)
- `[2026-10-21 - Phase 7: PostgreSQL Integration & API Contract Verification]`:
  - **Files:** `packages/shared/src/workflow-fsm.ts`, `packages/shared/src/workflow-fsm.spec.ts`, `apps/api/src/modules/workflow/workflow-orchestrator.service.ts`, `apps/api/src/modules/workflow/workflow-orchestrator.service.spec.ts`, `apps/api/test/workflow-postgresql.integration.spec.ts`, `docker-compose.dev.yml`, `apps/api/.env.example`, `apps/api/package.json`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 56/56 unit/regression tests passed 100%; integration test suite hoàn chỉnh với chẩn đoán kết nối tự động.
- `[2026-10-21 - Phase 6: Security Hardening & PostgreSQL Integration Verification]`:
  - **Files:** `apps/api/src/common/guards/auth.guard.ts`, `apps/api/src/common/utils/jwt.util.ts`, `apps/api/src/modules/workflow/document-workflow.controller.ts`, `apps/api/src/modules/workflow/document-workflow.controller.spec.ts`, `apps/api/src/main.ts`.
- `[2026-10-20 - Phase 5: Workflow API Layer, Security Review & Controller]`:
  - **Files:** `apps/api/src/common/*`, `apps/api/src/modules/workflow/dto/*`, `document-workflow.controller.*`, `workflow.module.ts`, `app.module.ts`.
- `[2026-10-20 - Triển khai Vertical Slice: FSM, Persistence & Workflow Orchestrator]`:
  - **Files:** `packages/shared/src/types.ts`, `packages/shared/src/workflow-fsm.ts`, `apps/api/prisma/schema.prisma`, `workflow-orchestrator.service.ts`.
- `[2026-10-20 - Phase 1: Kiểm định Repository & Đề xuất Vertical Slice]`:
  - **Khảo sát:** Đã kiểm tra `packages/shared`, `apps/api`, `apps/web`.
