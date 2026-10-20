# MEMORY LOG - DỰ ÁN TRÌNH KÝ ONLINE

## 1. Trạng thái hiện tại (Current State)
- **Tình trạng dự án:** Hoàn thành Giai đoạn 1 (Scaffold Monorepo pnpm, Core Prisma Schema & Lõi Workflow FSM đã pass 100% tests).
- **Tính năng vừa hoàn thành:**
  - Cài đặt & cấu hình môi trường: Node.js LTS v24.20, npm 11.19, pnpm 12.14.
  - Thiết lập Monorepo pnpm workspace (`apps/web`, `apps/api`, `packages/shared`).
  - Xây dựng `packages/shared`:
    - Enums & Types chuẩn hóa: [enums.ts](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/packages/shared/src/enums.ts), [types.ts](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/packages/shared/src/types.ts).
    - Lõi máy trạng thái: [workflow-fsm.ts](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/packages/shared/src/workflow-fsm.ts).
    - Bộ test kiểm thử tự động (6/6 tests passed): [workflow-fsm.spec.ts](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/packages/shared/src/workflow-fsm.spec.ts).
    - Zod Schema cho Block Template & Form fields: [template-schema.ts](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/packages/shared/src/template-schema.ts).
  - Xây dựng `apps/api`:
    - [schema.prisma](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/api/prisma/schema.prisma) chuẩn hóa 13 models, đã generate Prisma Client thành công.
- **Tính năng đang làm dở / Tiếp theo:**
  - Khởi tạo backend API service (`apps/api`) xử lý nghiệp vụ Document & Workflow.
  - Hoặc khởi tạo giao diện Next.js (`apps/web`) với UI shell (Sidebar, Header, Hộp thư tác nghiệp: Công việc của tôi, Tạo bởi tôi, Danh sách theo dõi).

## 2. Quyết định kỹ thuật & Kiến trúc (Key Decisions)
- **Nghiệp vụ đã chốt:**
  - 1) Mọi người dùng đều được tạo biểu mẫu (FormTemplate).
  - 2) Không cô lập cứng phạm vi dữ liệu giữa các công ty con (Truy cập dữ liệu tập đoàn mở).
  - 3) Reviewer chỉ có quyền xem, nhận thông báo & bình luận; KHÔNG có quyền duyệt/từ chối.
  - 4) GĐ 1: 100% tạo tài liệu từ biểu mẫu; PDF tải ngoài là attachment.
  - 5) 1 cấp Super Admin quản lý toàn bộ hệ thống & các công ty con.
- **Quy tắc chữ ký & version:** Khi có quyết định `REVISION_REQUESTED`, tài liệu sinh version mới và toàn bộ chữ ký cũ tự động chuyển `isValid = false` (`INVALIDATED_BY_REVISION`).
- **Engine duyệt:** Hỗ trợ cả Sequential và Parallel (ALL_MUST_APPROVE hoặc ANY_CAN_APPROVE).

## 3. Nhật ký thay đổi gần nhất (Recent Changes)
- `[2026-10-20 - Hoàn thành Giai đoạn 1: Monorepo, Prisma Schema, Workflow FSM]`:
  - **Files:** `pnpm-workspace.yaml`, `package.json`, `packages/shared/*`, `apps/api/prisma/schema.prisma`.
  - **Kết quả:** Vitest 6/6 tests passed, Prisma Client generated thành công.
  - **Next steps:** Xây dựng khung giao diện Next.js hoặc Service xử lý Workflow API.
- `[2026-10-20 - Đánh giá Kiến trúc & Nghiệp vụ Trình Ký]`:
  - **Nội dung:** Thống nhất 6 câu hỏi nghiệp vụ và các nguyên tắc kỹ thuật (FSM, PDF Worker, Multi-tenancy).
- `[2026-10-20 - Khởi tạo Memory Bank Protocol]`:
  - **Files:** `.agents/rules/memory-tracker.md`, `.agents/MEMORY_LOG.md`.
