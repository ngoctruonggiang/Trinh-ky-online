# MEMORY LOG - DỰ ÁN TRÌNH KÝ ONLINE

## 1. Trạng thái hiện tại (Current State)
- **Tình trạng dự án:** Hoàn thành Phase 8: Frontend Foundation & Workflow Vertical Slice (65/65 tests passed 100%, `pnpm build` thành công trên toàn bộ monorepo).
- **Tính năng vừa hoàn thành:**
  - `apps/web`:
    - **Nền tảng Next.js 15 (App Router):**
      - Cấu hình [tsconfig.json](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/web/tsconfig.json), [next.config.js](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/web/next.config.js), [tailwind.config.js](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/web/tailwind.config.js), [postcss.config.js](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/web/postcss.config.js), [globals.css](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/web/src/app/globals.css).
      - Layout chuẩn doanh nghiệp tiếng Việt: [Sidebar](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/web/src/components/layout/sidebar.tsx), [Header](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/web/src/components/layout/header.tsx), [RootLayout](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/web/src/app/layout.tsx).
    - **Thành phần Dùng chung (UI Components):**
      - [badge.tsx](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/web/src/components/ui/badge.tsx): `StatusBadge` (7 trạng thái) và `UrgencyBadge` (4 cấp độ khẩn cấp).
      - [button.tsx](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/web/src/components/ui/button.tsx): Button đa dạng biến thể (`primary`, `success`, `danger`, `warning`, `outline`, `ghost`) hỗ trợ trạng thái loading và icon.
      - [modal.tsx](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/web/src/components/ui/modal.tsx): Hộp thoại xác nhận thao tác, hỗ trợ phím Esc và backdrop blur.
      - [workflow-stepper.tsx](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/web/src/components/documents/workflow-stepper.tsx): Tiến trình duyệt trực quan, hiển thị phân công, vai trò (`APPROVER`, `REVIEWER`), quyết định và ý kiến ghi chú.
      - [workflow-action-box.tsx](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/web/src/components/documents/workflow-action-box.tsx): Hộp thao tác duyệt (`APPROVE`, `REJECT`, `REVISION_REQUESTED`), nộp lại (`RESUBMIT`), hủy (`CANCEL`) và xử lý lỗi xung đột tương tranh HTTP 409.
    - **Lớp Dịch vụ & Mock Adapter (Domain Types & Service Layer):**
      - [types/document.ts](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/web/src/types/document.ts): Kiểu dữ liệu đồng bộ với `@trinh-ky/shared` và Prisma schema.
      - [mock-document-service.ts](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/web/src/services/api/mock-document-service.ts): Mock adapter chuẩn enterprise mô phỏng chuyển trạng thái FSM, tính toàn vẹn SHA-256, vô hiệu hóa chữ ký khi sửa, và ném lỗi 409 khi có tương tranh.
    - **Lát cắt Nghiệp vụ Hoàn chỉnh (Vertical Slice):**
      - [page.tsx](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/web/src/app/page.tsx): Trang danh sách hồ sơ với 3 tab ("Chờ tôi duyệt", "Hồ sơ của tôi", "Tất cả hồ sơ"), tìm kiếm, lọc trạng thái, bảng hiển thị chi tiết, Suspense boundary.
      - [documents/[id]/page.tsx](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/web/src/app/documents/%5Bid%5D/page.tsx): Trang chi tiết hồ sơ 2 cột: Xem dữ liệu biểu mẫu động, mã băm SHA-256, lịch sử quyết định, con dấu chữ ký số, hộp thao tác duyệt và tiến trình stepper.
    - **Bộ test Frontend:**
      - [mock-document-service.spec.ts](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/web/src/services/api/mock-document-service.spec.ts): 9/9 tests passed.
  - Tổng số tests toàn bộ monorepo: **65/65 tests passed 100%** (16 shared + 40 api + 9 web).
- **Tính năng tiếp theo:**
  - Bổ sung các endpoint đọc phía Backend (`GET /api/documents`, `GET /api/documents/:id`) để thay thế Mock Adapter bằng API thật.

## 2. Quyết định kỹ thuật & Kiến trúc (Key Decisions)
- **Tách biệt Service Adapter (Safe API Strategy):**
  - Khảo sát mã nguồn thực tế cho thấy Backend hiện chỉ có 4 endpoint mutation (`POST /submit`, `/decision`, `/resubmit`, `/cancel`), chưa có các endpoint đọc danh sách hay chi tiết (`GET`).
  - Thay vì tự bịa endpoint không có thật hoặc lưu token nguy hiểm trong localStorage, frontend xây dựng kiến trúc `IDocumentService` với `MockDocumentService` có kiểu dữ liệu chặt chẽ, sẵn sàng trỏ sang `HttpDocumentService` khi backend bổ sung `GET`.
- **Phân quyền Frontend là lớp UX, không phải lớp Bảo mật:**
  - Frontend chỉ ẩn/hiển thị nút dựa trên tính toán permission của phiên làm việc. Mọi quyết định hợp lệ cuối cùng vẫn phải được backend và FSM xác minh.
- **Xử lý Xung đột Đồng thời (HTTP 409 Conflict):**
  - Giao diện có sẵn banner lỗi cảnh báo chuyên biệt khi gặp lỗi 409 trong chế độ duyệt song song `ANY_CAN_APPROVE`, kèm nút "Tải lại dữ liệu mới nhất" giúp người dùng cập nhật trạng thái ngay mà không mất dữ liệu.

## 3. Nhật ký thay đổi gần nhất (Recent Changes)
- `[2026-10-21 - Phase 8: Frontend Foundation & Workflow Vertical Slice]`:
  - **Files:** `apps/web/src/types/document.ts`, `apps/web/src/components/*`, `apps/web/src/services/*`, `apps/web/src/app/*`, `apps/web/package.json`, `apps/web/vitest.config.ts`, `package.json`.
  - **Kết quả:** `pnpm build` thành công 100% trên toàn monorepo; 65/65 tests passed.
- `[2026-10-21 - Phase 7: PostgreSQL Integration & API Contract Verification]`:
  - **Files:** `packages/shared/src/workflow-fsm.ts`, `packages/shared/src/workflow-fsm.spec.ts`, `apps/api/src/modules/workflow/workflow-orchestrator.service.ts`, `apps/api/test/workflow-postgresql.integration.spec.ts`, `docker-compose.dev.yml`, `docs/API_CONTRACT.md`.
- `[2026-10-21 - Phase 6: Security Hardening & PostgreSQL Integration Verification]`:
  - **Files:** `apps/api/src/common/guards/auth.guard.ts`, `apps/api/src/common/utils/jwt.util.ts`, `apps/api/src/modules/workflow/document-workflow.controller.ts`.
