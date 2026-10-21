# MEMORY LOG - DỰ ÁN TRÌNH KÝ ONLINE

## 1. Trạng thái hiện tại (Current State)
- **Tình trạng dự án:** Hoàn thành Phase 6: Security Hardening & PostgreSQL Integration Verification (52/52 tests passed 100%).
- **Tính năng vừa hoàn thành:**
  - `apps/api`:
    - **Security Hardening (AuthGuard & JWT):**
      - Xây dựng tiện ích [jwt.util.ts](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/api/src/common/utils/jwt.util.ts) (HS256 HMAC-SHA256, timingSafeEqual, expiration check, base64url).
      - Tăng cường bảo mật [auth.guard.ts](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/api/src/common/guards/auth.guard.ts): Loại bỏ lỗ hổng giả mạo raw header (`x-user-role`, `x-user-id`). Chỉ chấp nhận Bearer JWT hợp lệ hoặc Trusted Gateway Secret (`GATEWAY_SHARED_SECRET`). Dev mock header chỉ được phép khi `ALLOW_DEV_MOCK_AUTH=true` trong môi trường non-production.
    - **Kiểm soát Phân quyền Đa tổ chức (Multi-Company Boundary Isolation):**
      - Nâng cấp `verifyDocumentAccess` trong [document-workflow.controller.ts](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/api/src/modules/workflow/document-workflow.controller.ts):
        - `SUPER_ADMIN`: Quản trị toàn tập đoàn (Cross-Company).
        - `ADMIN`: Giới hạn tuyệt đối trong `organizationId` của công ty mình. Chặn Admin công ty A thao tác tài liệu công ty B.
        - `USER`: Giới hạn trong tài liệu do chính mình tạo và cùng tổ chức.
        - Áp dụng kiểm tra tổ chức trên toàn bộ 4 endpoints: `submit`, `decision`, `resubmit`, `cancel`.
    - **Bootstrap Entrypoint:**
      - Bổ sung [main.ts](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/api/src/main.ts) cho NestJS backend API với CORS, Global ValidationPipe và WorkflowExceptionFilter.
    - **Bộ test bảo mật & Controller:**
      - Nâng cấp [document-workflow.controller.spec.ts](file:///f:/Projects/Trinh%20ky%20online/Trinh%20ky%20online/apps/api/src/modules/workflow/document-workflow.controller.spec.ts) lên 29 tests (tổng hệ thống 52/52 tests passed): Kiểm thử chống nâng quyền giả mạo, chữ ký JWT sai, token hết hạn, gateway secret, và chặn thao tác chéo công ty.
  - `Prisma & PostgreSQL Status`:
    - Đã xác thực toàn vẹn `schema.prisma` và `prisma generate` thành công với Prisma Client v6.19.3.
    - Không phát hiện PostgreSQL server thật hoặc Docker daemon đang chạy trên máy chủ (`localhost:5432` connection refused). Báo cáo minh bạch tình trạng và cung cấp file `docker-compose.yml` cùng quy trình migration chuẩn để chạy kiểm thử database tích hợp thực tế.
- **Tính năng tiếp theo:**
  - Khởi tạo kết nối Frontend Next.js (`apps/web`) với Backend API theo Hợp đồng API Contract vừa xuất.

## 2. Quyết định kỹ thuật & Kiến trúc (Key Decisions)
- **Ranh giới tin cậy xác thực (Trust Boundary):**
  - Backend NestJS không bao giờ mặc định tin tưởng các header định danh không có chữ ký.
  - Client trực tiếp bắt buộc phải sử dụng `Authorization: Bearer <JWT_TOKEN>`.
  - Nếu triển khai qua Reverse Proxy / API Gateway, bắt buộc có header bí mật `x-gateway-secret` khớp với `process.env.GATEWAY_SHARED_SECRET`.
- **Ranh giới phân quyền công ty (Multi-Company Model):**
  - Mọi thao tác đều kiểm tra `document.organizationId === user.organizationId` đối với `ADMIN` và `USER`.
  - Chỉ duy nhất `UserRole.SUPER_ADMIN` mới được phép thao tác xuyên công ty.
- **Bảo mật tương tranh (OCC):**
  - Cập nhật bước duyệt `updateMany` điều kiện kép `status: IN_PROGRESS` và `version: currentStep.version`, ngăn chặn kích hoạt bước tiếp theo 2 lần trong chế độ song song (`ANY_CAN_APPROVE`).

## 3. Nhật ký thay đổi gần nhất (Recent Changes)
- `[2026-10-21 - Phase 6: Security Hardening & PostgreSQL Integration Verification]`:
  - **Files:** `apps/api/src/common/guards/auth.guard.ts`, `apps/api/src/common/utils/jwt.util.ts`, `apps/api/src/modules/workflow/document-workflow.controller.ts`, `apps/api/src/modules/workflow/document-workflow.controller.spec.ts`, `apps/api/src/main.ts`.
  - **Kết quả:** `pnpm test` thành công: 52/52 tests passed; `tsc -b` và `tsc --noEmit` thành công; `prisma generate` thành công.
- `[2026-10-20 - Phase 5: Workflow API Layer, Security Review & Controller]`:
  - **Files:** `apps/api/src/common/*`, `apps/api/src/modules/workflow/dto/*`, `document-workflow.controller.*`, `workflow.module.ts`, `app.module.ts`.
- `[2026-10-20 - Triển khai Vertical Slice: FSM, Persistence & Workflow Orchestrator]`:
  - **Files:** `packages/shared/src/types.ts`, `packages/shared/src/workflow-fsm.ts`, `apps/api/prisma/schema.prisma`, `workflow-orchestrator.service.ts`.
- `[2026-10-20 - Phase 1: Kiểm định Repository & Đề xuất Vertical Slice]`:
  - **Khảo sát:** Đã kiểm tra `packages/shared`, `apps/api`, `apps/web`.
- `[2026-10-20 - Đánh giá Kiến trúc & Nghiệp vụ Trình Ký]`:
  - **Nội dung:** Thống nhất 6 câu hỏi nghiệp vụ và các nguyên tắc kỹ thuật (FSM, PDF Worker, Multi-tenancy).
