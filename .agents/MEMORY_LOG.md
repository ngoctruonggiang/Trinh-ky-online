# MEMORY LOG - DỰ ÁN TRÌNH KÝ ONLINE

## 1. Trạng thái hiện tại (Current State)
- **Tình trạng dự án:** Hoàn thành toàn diện Phase 11 — Workflow Builder & Versioned Approval Engine (**186 Unit tests PASS [46 shared + 94 api + 46 web], 44 Real PostgreSQL Integration tests PASS, 22/22 Live HTTP E2E tests PASS, `pnpm build` toàn monorepo PASS 100%**).
- **Trạng thái dịch vụ đang chạy phục vụ kiểm thử (Active Servers):**
  - **PostgreSQL Database:** Docker Container `trinh-ky-postgres-dev` (`postgres:16-alpine`) chạy healthy tại `localhost:5432`.
  - **Backend API Server (NestJS):** Đang chạy tại `http://localhost:4000` (task-2469), sẵn sàng nhận request từ frontend và các công cụ test API.
  - **Frontend Web App (Next.js):** Đang chạy tại `http://localhost:3000` (task-2137), hỗ trợ cả giao diện quản lý biểu mẫu, tạo hồ sơ, chi tiết phê duyệt và trình thiết kế luồng duyệt trực quan (/workflows).
- **Môi trường Database:**
  - Docker Container `trinh-ky-postgres-dev` (`postgres:16-alpine`) chạy healthy trên cổng 5432.
  - Đã chạy 4 migration liên tiếp:
    1. `20261021041604_init`
    2. `20261021153000_add_form_template_version`
    3. `20261022120000_restrict_document_template_version_delete`
    4. `20261022130000_add_workflow_template_and_version`: Bổ sung mô hình `WorkflowTemplate` và `WorkflowTemplateVersion` kèm các khóa ngoại `ON DELETE RESTRICT` trên `documents.workflowTemplateVersionId`.
- **Tính năng vừa hoàn thành (Phase 11):**
  - **Mô hình Quy trình Phê duyệt Độc lập & Phiên bản Bất biến:**
    - Cặp thực thể `WorkflowTemplate` và `WorkflowTemplateVersion` cho phép thiết kế quy trình duyệt độc lập hoặc liên kết linh hoạt với `FormTemplate`.
    - Snapshot phiên bản chốt cứng (`steps` JSON) đảm bảo hồ sơ đã tạo luôn giữ nguyên chuỗi người duyệt ban đầu, không bị ảnh hưởng khi quy trình cha được cập nhật phiên bản mới.
  - **Vòng đời Versioning & Draft Lifecycle cho Quy trình:**
    - Hỗ trợ đầy đủ chu trình: DRAFT ban đầu -> Edit DRAFT -> Publish v1 -> Tạo bản nháp v2 (`POST /api/workflow-templates/:id/draft`) -> Sửa draft v2 (`PUT /api/workflow-templates/:id/draft`) -> Publish v2 (`POST /api/workflow-templates/:id/publish`) -> Hủy bản nháp an toàn (`DELETE /api/workflow-templates/:id/draft`).
    - Concurrency Lock: Trả về `409 CONFLICT` khi phát hiện tranh chấp phát hành đồng thời trên cùng `(workflowTemplateId, versionNumber)`.
  - **Động cơ Giải quyết Người duyệt Động (Approver Resolution Engine):**
    - Hỗ trợ 3 loại cấu hình: `SPECIFIC_USERS`, `DEPARTMENT_ROLE` (theo phòng người tạo hoặc phòng chỉ định), `ORGANIZATION_ROLE` (theo chức danh toàn công ty).
    - Thẩm định trạng thái active và rollback an toàn: Nếu không tìm thấy người duyệt phù hợp hoặc người duyệt bị inactive, hệ thống lập tức từ chối `400 Bad Request` bằng thông báo tiếng Việt rõ ràng và rollback toàn bộ transaction tạo hồ sơ, không sinh ra bước rỗng hay dữ liệu rác.
    - Hỗ trợ quy tắc hoàn thành bước: `ALL_MUST_APPROVE` (tất cả cùng duyệt) và `ANY_CAN_APPROVE` (1 người duyệt là xong).
  - **Phân quyền Đa tổ chức (Tenant Boundary):**
    - ADMIN công ty chỉ được xem và quản trị quy trình của công ty mình hoặc quy trình dùng chung toàn hệ thống (`organizationId: null` do `SUPER_ADMIN` quản lý).
    - USER thường chỉ được xem và sử dụng các quy trình đã `PUBLISHED`.
  - **Giao diện Trình thiết kế Quy trình Trực quan (Visual Workflow Builder):**
    - `/workflows`: Danh sách quy trình kèm bộ lọc trạng thái, tìm kiếm, số bước duyệt và thông tin phiên bản.
    - `/workflows/new`: Trình thiết kế trực quan cho phép thêm/sửa/xóa bước duyệt, chọn loại người duyệt, cấu hình ALL/ANY và sơ đồ luồng (WorkflowChainPreview) cập nhật thời gian thực.
    - `/workflows/[id]`: Trang chi tiết quy trình hiển thị banner cảnh báo bản nháp, nút phát hành/hủy bản nháp, sơ đồ luồng và bảng lịch sử phiên bản bất biến.

## 2. Quyết định kỹ thuật & Kiến trúc (Key Decisions)
- **Immutable Workflow Version Snapshot:**
  - Snapshot phiên bản quy trình lưu tại `WorkflowTemplateVersion` được chốt bất biến ngay khi xuất bản (`PUBLISHED`). Mọi hồ sơ tạo từ snapshot này tham chiếu qua `Document.workflowTemplateVersionId`.
- **Foreign Key Restrict Protection:**
  - Ràng buộc khóa ngoại `onDelete: Restrict` trên cả `Document.templateVersionId` và `Document.workflowTemplateVersionId` đảm bảo toàn vẹn pháp lý, ngăn chặn việc xóa bỏ vô tình các phiên bản snapshot đang phục vụ hồ sơ thực tế.
- **Fail-Fast Approver Resolution with Rollback:**
  - Trong quá trình khởi tạo hồ sơ, nếu bất kỳ bước duyệt nào không thể tìm ra người duyệt hợp lệ (ví dụ: phòng ban chưa bổ nhiệm Trưởng phòng, hoặc nhân viên chỉ định đã bị vô hiệu hóa), giao dịch rollback hoàn toàn và báo lỗi rõ ràng về cho người dùng.
- **Race Condition Prevention in Document Numbering:**
  - Sinh mã hồ sơ `TK-YYYY-XXXX-RAND` kết hợp hậu tố ngẫu nhiên để triệt tiêu hoàn toàn xung đột trùng khóa Unique khi nhiều request tạo hồ sơ đồng thời tại cùng mili-giây.

## 3. Nhật ký thay đổi gần nhất (Recent Changes)
- `[2026-10-22 - Phase 11: Workflow Builder & Versioned Approval Engine]`:
  - **Files:** `packages/shared/src/workflow-schema.ts`, `packages/shared/src/workflow-schema.spec.ts`, `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261022130000_add_workflow_template_and_version/migration.sql`, `apps/api/src/modules/workflow-template/*`, `apps/api/src/modules/workflow/workflow-orchestrator.service.ts`, `apps/api/src/modules/workflow/document-workflow.controller.ts`, `apps/api/test/workflow-template-postgresql.integration.spec.ts`, `apps/api/test/e2e-http-live.ts`, `apps/web/src/types/workflow-template.ts`, `apps/web/src/services/api/workflow-template-service.interface.ts`, `apps/web/src/services/api/http-workflow-template-service.ts`, `apps/web/src/services/api/mock-workflow-template-service.ts`, `apps/web/src/services/api/workflow-template-service.spec.ts`, `apps/web/src/components/workflow-builder/*`, `apps/web/src/app/workflows/*`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 186/186 Unit tests PASS; 44/44 PostgreSQL integration tests PASS; 22/22 Live HTTP E2E tests PASS; Monorepo build PASS 100%.
- `[2026-10-22 - Phase 10.1: Form Builder Verification & Hardening]`:
  - **Files:** `packages/shared/src/template-schema.ts`, `packages/shared/src/template-schema.spec.ts`, `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261022120000_restrict_document_template_version_delete/migration.sql`, `apps/api/src/modules/template/template.service.ts`, `apps/api/src/modules/template/template.controller.ts`, `apps/api/src/modules/workflow/workflow-orchestrator.service.ts`, `apps/api/src/modules/template/template.service.spec.ts`, `apps/api/test/template-postgresql.integration.spec.ts`, `apps/api/test/e2e-http-live.ts`, `apps/web/src/types/template.ts`, `apps/web/src/services/api/template-service.interface.ts`, `apps/web/src/services/api/http-template-service.ts`, `apps/web/src/services/api/mock-template-service.ts`, `apps/web/src/services/api/template-service.spec.ts`, `apps/web/src/app/templates/[id]/page.tsx`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 153/153 Unit tests PASS; 32/32 PostgreSQL integration tests PASS; 16/16 Live HTTP E2E tests PASS; Monorepo build PASS 100%.
- `[2026-10-21 - Phase 10: Form Builder & Dynamic Template Engine]`:
  - **Files:** `packages/shared/src/template-schema.ts`, `apps/api/src/modules/template/*`, `apps/web/src/components/form-builder/*`, `apps/web/src/app/templates/*`.
  - **Kết quả:** 140 Unit tests PASS; 28 PostgreSQL integration tests PASS; Monorepo build PASS 100%.
- `[2026-10-21 - Phase 9.1: Real PostgreSQL Verification & End-to-End Read API]`:
  - **Files:** `apps/api/src/modules/workflow/workflow-orchestrator.service.ts`, `apps/api/test/*`.
  - **Kết quả:** 21/21 PostgreSQL Integration tests PASS; 8/8 Live HTTP tests PASS; 92/92 Unit tests PASS; `pnpm build` PASS.
- `[2026-10-21 - Phase 9: Secure Read API & Real Frontend Integration]`:
  - **Files:** `apps/api/src/modules/workflow/document-read.service.ts`, `apps/web/src/services/api/http-document-service.ts`.
