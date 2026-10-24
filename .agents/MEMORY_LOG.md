# MEMORY LOG - DỰ ÁN TRÌNH KÝ ONLINE

## 1. Trạng thái hiện tại (Current State)
- **Tình trạng dự án:** Hoàn thành toàn diện Phase 13.0 — Cryptographic Signing Architecture, Threat Model & Implementation Plan (**AUDIT & DESIGN GATE PASSED — GO CHO PHASE 13.1**).
- **Trạng thái dịch vụ đang chạy phục vụ kiểm thử (Active Servers):**
  - **PostgreSQL Database:** Docker Container `trinh-ky-postgres-dev` (`postgres:16-alpine`) chạy healthy tại `localhost:5432`.
  - **Backend API Server (NestJS):** Đang chạy tại `http://localhost:4000`, SLA Scheduler worker (300s) và Notification Retry Worker (60s) hoạt động nền an toàn.
  - **Frontend Web App (Next.js):** Đang cấu hình kết nối trực tiếp Real API (`NEXT_PUBLIC_USE_MOCK_API=false`), không fallback sang mock.
- **Tài liệu Kiến trúc & Thiết kế Bảo mật bàn giao trong Phase 13.0:**
  - `docs/architecture/DIGITAL_SIGNING_ARCHITECTURE.md`: Phân định 5 tầng chữ ký, kiến trúc kết xuất PDF, chuẩn PAdES ISO 32000 CMS ByteRange, Incremental Updates nhiều người ký, và độc lập xác minh.
  - `docs/security/DIGITAL_SIGNING_THREAT_MODEL.md`: Mô hình ranh giới tin cậy (Trust Boundaries) và ma trận đe dọa (THR-01 đến THR-11) bao phủ toàn bộ các kịch bản tấn công nhị phân, TOCTOU, race condition, và cross-tenant.
  - `docs/architecture/DIGITAL_SIGNING_DECISIONS.md`: 7 ADRs đã chốt (PAdES CMS Detached, thư viện `pdf-lib` + `@node-signpdf` + `@peculiar/x509`, `ISigningKeyProvider`, mô hình 3-Tier Hash, Advisory Lock).
  - `docs/architecture/DIGITAL_SIGNING_IMPLEMENTATION_PLAN.md`: Kế hoạch 4 chặng Phase 13.1 - 13.4, migration schema (`digital_certificates`, `document_signed_artifacts`), 10 test gates và tiêu chí GO.
  - `docs/API_CONTRACT.md`: Đã cập nhật Phần 10 quy định đầy đủ các endpoint ký, tra cứu trạng thái, tải file bảo mật và xác minh độc lập.

## 2. Quyết định kỹ thuật & Kiến trúc (Key Decisions)
- **Chuẩn Ký số Mật mã PAdES (ISO 32000 / CMS Detached):**
  - Chèn chữ ký số CMS vào trường `/Contents` và bảng `/ByteRange`, bảo đảm các trình đọc PDF tiêu chuẩn (Adobe Acrobat Reader, Foxit) tự động xác minh được tính toàn vẹn nhị phân mà không cần API nội bộ.
- **Bảo tồn Chữ ký Cũ bằng Incremental Updates:**
  - Mỗi chữ ký của cấp duyệt sau được thêm vào tệp PDF theo cơ chế Incremental Update (nối tiếp body, xref, trailer với `/Prev`), tuyệt đối không ghi đè làm hỏng bảng ByteRange của chữ ký trước.
- **Kiến trúc Nhà cung cấp Khóa (ISigningKeyProvider Adapter):**
  - Tách biệt logic ký mật mã khỏi ứng dụng: Môi trường Dev dùng `DevLocalKeystoreProvider` (PKCS#12 mã hóa AES-256); Môi trường Production sẵn sàng cắm Cloud KMS hoặc SmartCA/Remote CA của VNPT/Viettel/FPT mà không sửa code lõi. Khóa riêng không bao giờ lộ về frontend hay database.
- **Chuỗi Toàn vẹn Ba Tầng Mã Băm (3-Tier Hash Model):**
  - Tầng 1: `formDataHash` (JSON Canonical SHA-256) $\rightarrow$ Tầng 2: `rawPdfHash` (Unsigned PDF SHA-256) $\rightarrow$ Tầng 3: `signedPdfHash` (Final Signed PDF Binary SHA-256).

## 3. Nhật ký thay đổi gần nhất (Recent Changes)
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
- `[2026-10-23 - Phase 12.0.1: SLA Scheduler, Notification Reliability & Regression Verification]`:
  - **Files:** `apps/api/src/modules/workflow/sla-scheduler.*`, `apps/api/src/modules/notification/notification.service.ts`, `apps/api/test/*`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 214/214 Unit tests PASS; 37/37 PostgreSQL integration tests PASS; 38/38 Live HTTP E2E tests PASS; Monorepo build PASS 100%.
