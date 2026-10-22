# MEMORY LOG - DỰ ÁN TRÌNH KÝ ONLINE

## 1. Trạng thái hiện tại (Current State)
- **Tình trạng dự án:** Hoàn thành toàn diện Phase 10: Form Builder & Dynamic Template Engine (**140 Unit tests PASS [31 shared + 75 api + 34 web], 28 Real PostgreSQL Integration tests PASS, `pnpm build` toàn monorepo PASS 100%**).
- **Môi trường Database:**
  - Docker Container `trinh-ky-postgres-dev` (`postgres:16-alpine`) chạy healthy trên cổng 5432.
  - Đã chạy migration phi phá hủy: `20261021153000_add_form_template_version` bổ sung `FormTemplateVersion`, `FormTemplate.organizationId`, `FormTemplate.currentVersion`, và `Document.templateVersionId`.
- **Tính năng vừa hoàn thành (Phase 10):**
  - `packages/shared`:
    - Thư viện schema động [template-schema.ts](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/packages/shared/src/template-schema.ts): Hỗ trợ các kiểu trường `text`, `textarea`, `number`, `date`, `select`, `radio`, `checkbox`, `email`, `currency_vnd`. Validate schema backend, phòng chống duplicate key, type mismatch, XSS/expression injection, và validate formData độc lập.
    - 15 unit tests `template-schema.spec.ts` (Tổng: 31/31 PASS).
  - `apps/api`:
    - Model & Migrations: `FormTemplateVersion` lưu snapshot bất biến của schema mỗi khi phát hành. `Document` liên kết `templateVersionId` bảo toàn tính xem lại hồ sơ lịch sử.
    - `TemplateService` & `TemplateController`: 6 endpoint quản lý template (`GET /templates`, `GET /templates/:id`, `POST /templates`, `PUT /templates/:id`, `POST /templates/:id/publish`, `POST /templates/:id/archive`, `POST /templates/:id/validate`). Phân quyền ADMIN/SUPER_ADMIN và cô lập dữ liệu theo tổ chức `organizationId`.
    - `WorkflowOrchestratorService.createDocument`: Endpoint `POST /api/documents` khởi tạo hồ sơ `DRAFT` từ mẫu đã `PUBLISHED`, kiểm tra schema hợp lệ, sinh số hồ sơ, tính toán SHA-256 hash và khởi tạo các bước duyệt theo template trong cùng 1 database transaction.
    - 14 unit tests mới cho template service (Tổng api unit: 75/75 PASS).
    - 7 PostgreSQL integration tests trên DB thật [template-postgresql.integration.spec.ts](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/api/test/template-postgresql.integration.spec.ts) (Tổng integration: 28/28 PASS).
  - `apps/web`:
    - Component `DynamicFormRenderer`: Dựng form động theo schema từ API, hỗ trợ đầy đủ các kiểu trường, validation lỗi thân thiện, bảo lưu dữ liệu nhập.
    - Trang Quản lý Biểu mẫu (`/templates`): Xem danh sách mẫu, trạng thái DRAFT / PUBLISHED / ARCHIVED, số phiên bản.
    - Trang Visual Form Builder (`/templates/new`): Thêm sửa xóa trường, cấu hình nhãn, placeholder, required, options, tab Live Preview trực quan.
    - Trang Chi tiết & Lịch sử phiên bản (`/templates/[id]`): Hiển thị chi tiết trường, nhật ký các phiên bản đã xuất bản, modal phát hành phiên bản mới.
    - Trang Khởi tạo Hồ sơ Mới (`/documents/new`): Chọn biểu mẫu đã phát hành, điền dữ liệu động và lưu nháp hồ sơ kết nối trực tiếp với backend.
    - Chi tiết hồ sơ (`/documents/[id]`): Hỗ trợ hiển thị linh hoạt các trường dữ liệu động mới bên cạnh định dạng truyền thống.
    - 13 unit tests mới cho `HttpTemplateService` & `MockTemplateService` (Tổng web unit: 34/34 PASS).
  - `docs/API_CONTRACT.md`: Cập nhật chi tiết 7 endpoint biểu mẫu động và endpoint `POST /api/documents`.

## 2. Quyết định kỹ thuật & Kiến trúc (Key Decisions)
- **Snapshot Phiên bản Mẫu Bất biến (Immutable Form Version Snapshots):**
  - Khi Admin phát hành (`publish`) một biểu mẫu, một bản ghi `FormTemplateVersion` mới được tạo kèm snapshot toàn bộ trường (`fields`) và layout blocks tại thời điểm đó.
  - Khi người dùng tạo hồ sơ, trường `templateVersionId` trỏ trực tiếp đến `FormTemplateVersion` cụ thể. Các bản cập nhật sau này (v2, v3) hoặc thao tác Archive hoàn toàn không làm thay đổi hay phá vỡ việc xem lại các hồ sơ lịch sử.
- **Backend-Driven Dynamic Validation:**
  - Backend là tầng thẩm định dữ liệu cuối cùng (`validateFormData`). Không tin tưởng validation ở frontend, chặn mọi dữ liệu giả mạo hoặc sai lệch kiểu trước khi ghi nhận vào PostgreSQL.
- **Multi-Tenant Template Isolation:**
  - Biểu mẫu có `organizationId`. Người dùng chỉ được truy cập các mẫu thuộc công ty mình hoặc mẫu dùng chung toàn hệ thống (`organizationId: null`). Thao tác biên tập chỉ cho phép `ADMIN` cùng công ty hoặc `SUPER_ADMIN`.
- **Next.js CSR Prerendering Boundary:**
  - Toàn bộ trang Next.js App Router sử dụng `useSearchParams()` (như `/documents/new`) bắt buộc phải bọc trong `<React.Suspense>` boundary để tránh lỗi de-opt static build trong Next.js 15.

## 3. Nhật ký thay đổi gần nhất (Recent Changes)
- `[2026-10-21 - Phase 10: Form Builder & Dynamic Template Engine]`:
  - **Files:** `packages/shared/src/template-schema.ts`, `packages/shared/src/template-schema.spec.ts`, `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261021153000_add_form_template_version/*`, `apps/api/src/modules/template/*`, `apps/api/src/modules/workflow/workflow-orchestrator.service.ts`, `apps/api/src/modules/workflow/document-workflow.controller.ts`, `apps/api/test/template-postgresql.integration.spec.ts`, `apps/web/src/types/template.ts`, `apps/web/src/services/api/*`, `apps/web/src/components/form-builder/dynamic-form-renderer.tsx`, `apps/web/src/app/templates/*`, `apps/web/src/app/documents/new/page.tsx`, `apps/web/src/app/documents/[id]/page.tsx`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 140 Unit tests PASS (31 shared, 75 api, 34 web); 28 PostgreSQL integration tests PASS; Monorepo build PASS 100%.
- `[2026-10-21 - Phase 9.1: Real PostgreSQL Verification & End-to-End Read API]`:
  - **Files:** `apps/api/src/modules/workflow/workflow-orchestrator.service.ts`, `apps/api/src/common/filters/workflow-exception.filter.ts`, `apps/api/test/*`, `apps/web/src/app/*`.
  - **Kết quả:** 21/21 PostgreSQL Integration tests PASS; 8/8 Live HTTP tests PASS; 92/92 Unit tests PASS; `pnpm build` PASS.
- `[2026-10-21 - Phase 9: Secure Read API & Real Frontend Integration]`:
  - **Files:** `apps/api/src/modules/workflow/document-read.service.ts`, `apps/api/src/modules/auth/*`, `apps/web/src/services/api/http-document-service.ts`.
- `[2026-10-21 - Phase 8: Frontend Foundation & Workflow Vertical Slice]`:
  - **Files:** `apps/web/src/types/document.ts`, `apps/web/src/components/*`, `apps/web/src/services/*`, `apps/web/src/app/*`.
- `[2026-10-21 - Phase 7: PostgreSQL Integration & API Contract Verification]`:
  - **Files:** `packages/shared/src/workflow-fsm.ts`, `apps/api/src/modules/workflow/workflow-orchestrator.service.ts`.
