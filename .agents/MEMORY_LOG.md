# MEMORY LOG - DỰ ÁN TRÌNH KÝ ONLINE

## 1. Trạng thái hiện tại (Current State)
- **Tình trạng dự án:** Hoàn thành xuất sắc Phase 13.1 — PDF Rendering Engine & Secure Artifact Storage (**ALL GATES PASSED — GO CHO PHASE 13.2**).
- **Trạng thái dịch vụ đang chạy phục vụ kiểm thử (Active Servers):**
  - **PostgreSQL Database:** Docker Container `trinh-ky-postgres-dev` (`postgres:16-alpine`) chạy healthy tại `localhost:5432`.
  - **Backend API Server (NestJS):** Đang chạy tại `http://localhost:4000`, SLA Scheduler worker (300s) và Notification Retry Worker (60s) hoạt động nền an toàn.
  - **Frontend Web App (Next.js):** Đang cấu hình kết nối trực tiếp Real API (`NEXT_PUBLIC_USE_MOCK_API=false`), không fallback sang mock.
- **Tính năng hoàn thành trong Phase 13.1:**
  - `PdfGeneratorService`: Kết xuất tài liệu PDF A4 chuẩn tiếng Việt Unicode (sử dụng `pdf-lib` + `@pdf-lib/fontkit` + Roboto Regular/Bold), layout 2 cột hành chính, watermark trạng thái, bảng biểu tự động ngắt trang đa trang, sanitize HTML/XSS.
  - `StorageService` & `IStorageProvider`: Kiến trúc trừu tượng hóa lưu trữ tệp độc lập nhà cung cấp, hiện thực `LocalDiskStorageProvider` với đường dẫn server-generated nằm ngoài public web root (`apps/api/storage/`), chống path traversal triệt để, atomic write qua thư mục staging (`storage/staging`), sẵn sàng mở rộng S3.
  - `ArtifactService` & PostgreSQL `document_artifacts`: Quản lý vòng đời artifact (`PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`), tính toán `rawPdfHash` (SHA-256 nhị phân thực tế của tệp), cô lập tenant 100%, khóa tương tranh PostgreSQL Advisory Lock chống render lặp, Idempotency tuyệt đối.
  - Controller & Endpoints: `POST /api/documents/:id/render-pdf`, `GET /api/documents/:id/render-status`, `GET /api/documents/:id/pdf`, `GET /api/documents/:id/artifacts`.
  - Giới hạn nghiêm ngặt: Tuyệt đối không đánh dấu cryptographic signature, không sinh CMS/PKCS#7, không tuyên bố PAdES trong Phase 13.1.

## 2. Quyết định kỹ thuật & Kiến trúc (Key Decisions)
- **Phân tách Rạch ròi 3 Tầng Hash (3-Tier Hash Model):**
  - `formDataHash`: SHA-256 của JSON canonical form snapshot từ `DocumentVersion`.
  - `rawPdfHash`: SHA-256 tính toán trực tiếp từ byte nhị phân của tệp PDF kết xuất thô lưu trên storage. Tuyệt đối không gán `signedPdfHash = rawPdfHash`.
  - `signedPdfHash`: Dành riêng cho Phase 13.2 sau khi chèn chữ ký số mật mã PAdES CMS.
- **Quy tắc Chọn Phiên bản Biểu mẫu & Dữ liệu Bất biến:**
  - PDF luôn được kết xuất từ snapshot phiên bản gắn liền với tài liệu (`DocumentVersion`), giải quyết đúng `FormTemplateVersion` tại thời điểm tạo/sửa đổi hồ sơ, tuyệt đối không dùng template version mới nhất để render lại version cũ.
- **Bảo mật Lưu trữ & Atomic Staging:**
  - Storage key tuân thủ định dạng: `tenants/{tenantId}/documents/{documentId}/v{versionNumber}/{artifactType}_{hashPrefix}.pdf`.
  - Tệp được ghi vào `storage/staging/temp_{uuid}.tmp` trước, tính toán SHA-256 trên byte đầy đủ, sau đó `fs.renameSync` atomic sang vị trí lưu trữ chính thức.
  - Tải file nhị phân qua stream endpoint được bảo vệ RBAC và Tenant Isolation; cấm phục vụ file trực tiếp qua public static web folder.

## 3. Nhật ký thay đổi gần nhất (Recent Changes - 5 task gần nhất)
- `[2026-10-24 - Phase 13.1: PDF Rendering Engine & Secure Artifact Storage]`:
  - **Files:** `apps/api/prisma/schema.prisma`, `migrations/20261024013100_add_document_artifacts/*`, `packages/shared/src/*`, `apps/api/src/modules/artifact/*`, `apps/api/test/*`, `docs/API_CONTRACT.md`, `docs/architecture/*`.
  - **Kết quả:** 160/160 API Unit tests PASS; 113/113 PostgreSQL integration tests PASS; 60/60 Live HTTP E2E tests PASS; Shared (47/47) & Web (46/46) PASS 100%; Không có hồi quy workflow/delegation/audit. Sẵn sàng Phase 13.2.
- `[2026-10-24 - Phase 13.0: Cryptographic Signing Architecture, Threat Model & Implementation Plan]`:
  - **Files:** `docs/architecture/DIGITAL_SIGNING_ARCHITECTURE.md`, `docs/security/DIGITAL_SIGNING_THREAT_MODEL.md`, `docs/architecture/DIGITAL_SIGNING_DECISIONS.md`, `docs/architecture/DIGITAL_SIGNING_IMPLEMENTATION_PLAN.md`, `docs/API_CONTRACT.md`.
  - **Kết quả:** Hoàn thành toàn diện kiểm toán hiện trạng, thiết kế kiến trúc PAdES CMS, mô hình đe dọa 11 kịch bản, 7 ADRs, kế hoạch 4 giai đoạn 13.1–13.4, hợp đồng API ký số; Quyết định GO cho Phase 13.1.
- `[2026-10-24 - Phase 12.1.1: Delegation Security, Concurrency & Policy Correctness Audit]`:
  - **Files:** `apps/api/src/modules/delegation/*`, `apps/api/src/modules/workflow/*`, `apps/api/test/*`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 235/235 Unit tests PASS; 107/107 PostgreSQL integration tests PASS; 52/52 Live HTTP E2E tests PASS; Monorepo build PASS 100%.
- `[2026-10-23 - Phase 12.1: Delegation Policy Engine & Auditable Workflow Integration]`:
  - **Files:** `packages/shared/*`, `apps/api/prisma/schema.prisma`, `apps/api/src/modules/delegation/*`, `apps/api/src/modules/workflow/*`, `apps/web/*`, `apps/api/test/*`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 230/230 Unit tests PASS; 97/97 PostgreSQL integration tests PASS; 48/48 Live HTTP E2E tests PASS; Monorepo build PASS 100%.
- `[2026-10-23 - Phase 12.0.2: Notification Reliability Audit & Production Readiness Gate]`:
  - **Files:** `apps/api/src/modules/notification/*`, `apps/api/src/modules/workflow/sla-scheduler.*`, `apps/api/test/*`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 218/218 Unit tests PASS; 86/86 PostgreSQL integration tests PASS; 41/41 Live HTTP E2E tests PASS; Monorepo build PASS 100%.

