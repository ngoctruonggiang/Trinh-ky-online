# MEMORY LOG - DỰ ÁN TRÌNH KÝ ONLINE

## 1. Trạng thái hiện tại (Current State)
- **Tình trạng dự án:** Hoàn thành Phase 9: Secure Read API & Real Frontend Integration (**92/92 tests passed 100%**, `pnpm build` thành công trên toàn bộ monorepo).
- **Tính năng vừa hoàn thành:**
  - `apps/api`:
    - **Read API Endpoints:**
      - `GET /api/documents`: Phân trang (`page`, `limit`), lọc (`tab`, `status`), tìm kiếm (`search` trên `title` và `documentNumber`), giới hạn ranh giới tổ chức tại cấp database (`organizationId: user.organizationId` đối với USER/ADMIN; `SUPER_ADMIN` có quyền toàn hệ thống).
      - `GET /api/documents/:id`: Đọc chi tiết phiên bản active, dữ liệu biểu mẫu formData, mã SHA-256, các bước workflow, assignees, lịch sử quyết định và con dấu chữ ký số thực tế có trong DB. Tính toán phân quyền tại server (`permissions`: `canApprove`, `canResubmit`, `canCancel`, `isCreator`, `isAdmin`). Chặn truy cập trái phép đa công ty (403 Forbidden).
      - `GET /api/auth/me`: Trả về profile định danh, tổ chức và phòng ban của người dùng hiện tại từ session/token. Tuyệt đối không trả về passwordHash, secrets hay token.
    - **Dịch vụ & DTO:**
      - [GetDocumentsQueryDto](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/api/src/modules/workflow/dto/get-documents-query.dto.ts), [DocumentResponseDto](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/api/src/modules/workflow/dto/document-response.dto.ts), [DocumentReadService](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/api/src/modules/workflow/document-read.service.ts), [AuthController](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/api/src/modules/auth/auth.controller.ts), [AuthModule](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/api/src/modules/auth/auth.module.ts).
    - **Bộ test Backend bổ sung:**
      - [document-read.service.spec.ts](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/api/src/modules/workflow/document-read.service.spec.ts) (12 tests), [auth.controller.spec.ts](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/api/src/modules/auth/auth.controller.spec.ts) (2 tests), [document-workflow.controller.spec.ts](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/api/src/modules/workflow/document-workflow.controller.spec.ts) (31 tests). Tổng backend: 56 tests.
  - `apps/web`:
    - **HttpDocumentService:**
      - [http-document-service.ts](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/web/src/services/api/http-document-service.ts): Adapter gọi API thật, chuẩn hóa mã lỗi HTTP 400, 401, 403, 404, 409, 422, 500 và lỗi mất mạng (Network Failure) thành `ApiError`. Không bao giờ âm thầm fallback sang mock khi API thật có lỗi.
      - [services/api/index.ts](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/web/src/services/api/index.ts): Cơ chế chuyển đổi rõ ràng giữa Mock và Real API qua biến môi trường `NEXT_PUBLIC_USE_MOCK_API`.
    - **Tích hợp giao diện Frontend:**
      - [page.tsx](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/web/src/app/page.tsx) & [documents/[id]/page.tsx](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/web/src/app/documents/%5Bid%5D/page.tsx) chuyển sang dùng `documentService`, hiển thị rõ ràng nhãn môi trường `Giả lập (Mock)` hoặc `API Thật (Connected)` trên header, hiển thị banner lỗi và nút retry thân thiện.
    - **Bộ test Frontend:**
      - [http-document-service.spec.ts](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/web/src/services/api/http-document-service.spec.ts) (11 tests) + [mock-document-service.spec.ts](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/web/src/services/api/mock-document-service.spec.ts) (9 tests). Tổng frontend: 20 tests.
  - Tổng số tests toàn monorepo: **92/92 tests passed 100%** (16 shared + 56 api + 20 web).
- **Tính năng tiếp theo:**
  - Khởi động môi trường PostgreSQL thực tế và chạy bộ integration test xác nhận trên database thật.
  - Tích hợp Module Form Builder (tạo mẫu tài liệu động) và chức năng khởi tạo hồ sơ từ mẫu.

## 2. Quyết định kỹ thuật & Kiến trúc (Key Decisions)
- **Bảo vệ Ranh giới Tổ chức tại cấp Database Query (Database-Level Multi-Tenancy):**
  - Mọi câu truy vấn danh sách `GET /api/documents` đối với `USER` và `ADMIN` đều bắt buộc đưa `where.organizationId = user.organizationId` vào cấp database, tuyệt đối không tải dữ liệu toàn bộ rồi lọc bằng Javascript.
  - `SUPER_ADMIN` được cấp quyền truy vấn tài liệu của tất cả các công ty thành viên.
- **Tính toán Quyền hạn tại Server (Server-Side Permissions Calculation):**
  - Object `permissions` (`canApprove`, `canResubmit`, `canCancel`, `isCreator`, `isAdmin`, `currentStepAssigneeRole`) được backend tính toán sẵn dựa trên UserPrincipal và gửi kèm `DocumentDetail`, đảm bảo UI hiển thị nút bấm chính xác mà không cần frontend phải suy đoán logic nghiệp vụ phức tạp.
- **Tách biệt Chế độ Mock & Real API minh bạch:**
  - `HttpDocumentService` và `MockDocumentService` cùng tuân thủ interface [IDocumentService](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/web/src/types/document.ts).
  - Biến `isMockMode` được kiểm tra qua `NEXT_PUBLIC_USE_MOCK_API`. UI có badge phân định rõ ràng; khi gặp lỗi API thật, ném `ApiError` chứ không ngầm chuyển sang mock.

## 3. Nhật ký thay đổi gần nhất (Recent Changes)
- `[2026-10-21 - Phase 9: Secure Read API & Real Frontend Integration]`:
  - **Files:** `apps/api/src/modules/workflow/document-read.service.ts`, `apps/api/src/modules/workflow/document-read.service.spec.ts`, `apps/api/src/modules/workflow/document-workflow.controller.ts`, `apps/api/src/modules/auth/*`, `apps/web/src/services/api/http-document-service.ts`, `apps/web/src/services/api/http-document-service.spec.ts`, `apps/web/src/services/api/index.ts`, `apps/web/src/app/page.tsx`, `apps/web/src/app/documents/[id]/page.tsx`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 92/92 tests passed; `pnpm build` biên dịch thành công 100%.
- `[2026-10-21 - Phase 8: Frontend Foundation & Workflow Vertical Slice]`:
  - **Files:** `apps/web/src/types/document.ts`, `apps/web/src/components/*`, `apps/web/src/services/*`, `apps/web/src/app/*`.
- `[2026-10-21 - Phase 7: PostgreSQL Integration & API Contract Verification]`:
  - **Files:** `packages/shared/src/workflow-fsm.ts`, `apps/api/src/modules/workflow/workflow-orchestrator.service.ts`, `apps/api/test/workflow-postgresql.integration.spec.ts`, `docs/API_CONTRACT.md`.
- `[2026-10-21 - Phase 6: Security Hardening & PostgreSQL Integration Verification]`:
  - **Files:** `apps/api/src/common/guards/auth.guard.ts`, `apps/api/src/common/utils/jwt.util.ts`.
- `[2026-10-21 - Phase 5: Workflow API Layer & Security Review]`:
  - **Files:** `apps/api/src/modules/workflow/document-workflow.controller.ts`, `apps/api/src/modules/workflow/workflow.module.ts`.
