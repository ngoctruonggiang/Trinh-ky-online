# MEMORY LOG - DỰ ÁN TRÌNH KÝ ONLINE

## 1. Trạng thái hiện tại (Current State)
- **Tình trạng dự án:** Hoàn thành xuất sắc Phase 13.2.1 — Signing Provider, X.509 Certificate Registry & Secure Local Keystore (**ALL GATES PASSED — GO CHO PHASE 13.2.2**).
- **Trạng thái dịch vụ đang chạy phục vụ kiểm thử (Active Servers):**
  - **PostgreSQL Database:** Docker Container `trinh-ky-postgres-dev` (`postgres:16-alpine`) chạy healthy tại `localhost:5432`.
  - **Backend API Server (NestJS):** Đang chạy tại `http://localhost:4000`, SLA Scheduler worker (300s) và Notification Retry Worker (60s) hoạt động nền an toàn.
  - **Frontend Web App (Next.js):** Đang cấu hình kết nối trực tiếp Real API (`NEXT_PUBLIC_USE_MOCK_API=false`), không fallback sang mock.
- **Tính năng hoàn thành trong Phase 13.2.1:**
  - `ISigningKeyProvider` & `RemoteSigningProvider`: Interface trừu tượng hóa nhà cung cấp khóa, bảo đảm không bao giờ export private key, phân định rõ ràng ngữ nghĩa `signData` (nhận buffer thô, băm SHA-256) vs `signDigest` (nhận đúng 32-byte hash, bọc ASN.1 DigestInfo + RSA PKCS1 padding).
  - `DevLocalKeystoreProvider`: Provider phát triển nạp tệp PKCS#12 (.p12), mã hóa AES-256-CBC với passphrase lấy qua cấu hình bí mật (`DEV_SIGNING_PASSPHRASE`), lưu ngoài web root (`apps/api/storage/keystores/dev/`), chặn path traversal bằng regex, tự động kiểm tra cặp khóa tương khớp với X.509.
  - `DevKeystoreGenerator`: Tiện ích tạo keystore PKCS#12 tự ký cho môi trường Dev/Test (RFC 5280 positive integer serials, UTF-8 attribute encoding), đánh dấu rõ nhãn `DEV TEST ONLY - NOT FOR PRODUCTION`.
  - `CloudKmsSigningProvider`: Adapter interface chuẩn bị sẵn sàng kết nối AWS KMS, Google Cloud KMS, HSM FIPS 140-2 và VNPT SmartCA.
  - `CertificateRegistryService` & `CertificateController`: Quản lý danh mục chứng thư số X.509 (`DigitalCertificate`) trên PostgreSQL với migration `20261024020537_add_digital_certificates`, RBAC 3 cấp, Tenant Isolation 100%, bảo vệ quyền riêng tư cá nhân và audit log đầy đủ.
  - Endpoints: `POST /api/certificates`, `GET /api/certificates`, `GET /api/certificates/:id`, `PATCH /api/certificates/:id/status`, `POST /api/certificates/:id/test-sign`.
  - Giới hạn nghiêm ngặt: Chưa triển khai CMS/PAdES PDF signing, chưa tích hợp TSA, chưa tự động ký khi văn bản `APPROVED` (dành cho Phase 13.2.2 & 13.3).

## 2. Quyết định kỹ thuật & Kiến trúc (Key Decisions)
- **Chuẩn hóa Ngữ nghĩa Ký số & Không Export Private Key (ADR-08):**
  - Mọi thao tác ký được đóng gói bên trong provider. Không trả về private key object hay PEM plaintext.
  - `signData` và `signDigest` cho ra cùng kết quả chữ ký nhị phân RSASSA-PKCS1-v1_5 SHA-256 khớp 100% với `crypto.verify`.
- **An toàn Keystore Cục bộ & Giảm thiểu Rủi ro (ADR-03, THR-12):**
  - Keystore lưu ngoài web root, không commit lên git, không log secret/password.
  - Trong môi trường Production, bắt buộc dùng `CloudKmsSigningProvider` để khóa nằm trong phần cứng HSM thay vì filesystem.
- **Phân quyền và Ranh giới Danh mục Chứng thư (ADR-09):**
  - Chỉ `ADMIN`/`SUPER_ADMIN` mới được đăng ký và thu hồi chứng thư.
  - `USER` chỉ xem và ký thử nghiệm trên chứng thư cá nhân được gán cho chính mình (`userId === currentUser.id`).
  - Cấm cập nhật thay đổi `organizationId` hoặc `userId` trên chứng thư đã tạo để chống chiếm quyền sở hữu trái phép.

## 3. Nhật ký thay đổi gần nhất (Recent Changes - 5 task gần nhất)
- `[2026-10-24 - Phase 13.2.1: Signing Provider, X.509 Certificate Registry & Secure Local Keystore]`:
  - **Files:** `apps/api/prisma/schema.prisma`, `migrations/20261024020537_add_digital_certificates/*`, `packages/shared/src/*`, `apps/api/src/modules/signing/*`, `apps/api/test/*`, `docs/API_CONTRACT.md`, `docs/architecture/*`, `docs/security/*`.
  - **Kết quả:** 180/180 API Unit tests PASS; 119/119 PostgreSQL integration tests PASS; 70/70 Live HTTP E2E tests PASS (100%); Shared (47/47) & Web (46/46) PASS; Monorepo build PASS. Sẵn sàng Phase 13.2.2.
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
