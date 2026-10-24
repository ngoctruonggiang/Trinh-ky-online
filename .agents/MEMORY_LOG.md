# MEMORY LOG - DỰ ÁN TRÌNH KÝ ONLINE

## 1. Trạng thái hiện tại (Current State)
- **Tình trạng dự án:** Hoàn thành xuất sắc Phase 13.2.2 — CMS/PDF Signing Engine (**ALL GATES PASSED — GO CHO PHASE 13.3**).
- **Trạng thái dịch vụ đang chạy phục vụ kiểm thử (Active Servers):**
  - **PostgreSQL Database:** Docker Container `trinh-ky-postgres-dev` (`postgres:16-alpine`) chạy healthy tại `localhost:5432`.
  - **Backend API Server (NestJS):** Đang chạy tại `http://localhost:4000`, SLA Scheduler worker (300s) và Notification Retry Worker (60s) hoạt động nền an toàn.
  - **Frontend Web App (Next.js):** Đang cấu hình kết nối trực tiếp Real API (`NEXT_PUBLIC_USE_MOCK_API=false`), không fallback sang mock.
- **Tính năng hoàn thành trong Phase 13.2.2:**
  - `CmsSignatureBuilder`: Dựng CMS Detached (RFC 5652) với ASN.1 DER `signedData`, `encapContentInfo` `id-data` (omitted `eContent`), sắp xếp từ điển `SignedAttributes` (`contentType`, `signingTime`, `messageDigest`), và ký digest 32-byte thông qua `ISigningKeyProvider.signDigest`. Xác minh thành công 100% bằng OpenSSL CLI với cờ `-binary`.
  - `PdfSignatureAdapter`: Cấp phát Signature Dictionary (`/Type /Sig`, `/Filter /Adobe.PPKLite`, `/SubFilter /adbe.pkcs7.detached`), vùng đệm `/Contents <hex>` an toàn 8192 bytes, tính toán `/ByteRange` nhị phân chính xác, bảo vệ chống tràn placeholder (Placeholder Overflow Protection).
  - `PdfSignatureVerifier`: Bộ xác minh độc lập cấu trúc ByteRange, tính lại `computedDigest`, đối soát `messageDigest` và xác minh chữ ký RSA bằng khóa công khai X.509 nhúng. Phát hiện can thiệp nhị phân cấp byte (Tamper Detection) tức thì.
  - `PdfSigningService`: Điều phối quy trình ký an toàn với PostgreSQL Advisory Lock, kiểm tra tính toàn vẹn của tệp chưa ký (`rawPdfHash`), thẩm định chứng thư số (`ACTIVE`, hạn dùng, quyền sở hữu), ký và tự xác minh fail-closed trước khi lưu storage và cập nhật bản ghi `DocumentArtifact` kiểu `SIGNED_PDF`.
  - API Endpoints: `POST /api/documents/:id/sign`, `GET /api/documents/:id/verify-signature`, `GET /api/documents/:id/signed-pdf`.
  - Ranh giới kỹ thuật: Chưa có RFC 3161 TSA, chưa có PAdES B-LTA (DSS/VRI/LTV), chưa tự động ký khi văn bản chuyển sang `APPROVED`.

## 2. Quyết định kỹ thuật & Kiến trúc (Key Decisions)
- **Chuẩn hóa 3-Tier Hash & Bảo toàn Tệp Gốc (ADR-05, ADR-10):**
  - `formDataHash`: Hash SHA-256 dữ liệu nghiệp vụ JSON.
  - `rawPdfHash`: SHA-256 của tệp PDF gốc chưa ký `OFFICIAL_UNSIGNED` (bảo toàn 100%, không bao giờ bị ghi đè).
  - `signedPdfHash`: SHA-256 của toàn bộ tệp PDF đã ký số `SIGNED_PDF`.
- **Cấu trúc CMS Detached & Phân bổ ByteRange (ADR-10, THR-13, THR-14):**
  - Chữ ký CMS Detached không chứa eContent; `messageDigest` ký trên đúng 2 đoạn byte trong `/ByteRange`.
  - Kiểm tra độ bao phủ 100% của `/ByteRange` để chống PDF Shadow Attacks (THR-13).
  - Kiểm tra kích thước placeholder trước khi ghi hex đệm để chống tràn bộ đệm (THR-14).
- **Quy trình Ký Fail-Closed & Tự Xác minh (Self-Verification):**
  - Chỉ ghi file vào Storage và commit CSDL sau khi `PdfSignatureVerifier.verify` thành công 100%. Nếu có lỗi, hủy ngay lập tức, không lưu tệp hỏng.
- **Bảo vệ Khóa Riêng & Không Xuất Khóa (ADR-08):**
  - `ISigningKeyProvider` chỉ nhận `signDigest(keyAlias, digest32Bytes)`, tuyệt đối không bao giờ xuất private key ra ngoài.

## 3. Nhật ký thay đổi gần nhất (Recent Changes - 5 task gần nhất)
- `[2026-10-24 - Phase 13.2.2: CMS/PDF Signing Engine]`:
  - **Files:** `apps/api/prisma/schema.prisma`, `migrations/20261024091838_add_signed_pdf_artifact/*`, `packages/shared/src/*`, `apps/api/src/modules/signing/*`, `apps/api/src/modules/artifact/artifact.service.ts`, `apps/api/test/*`, `docs/API_CONTRACT.md`, `docs/architecture/*`, `docs/security/*`.
  - **Kết quả:** 199/199 API Unit tests PASS; 126/126 PostgreSQL integration tests PASS; 80/80 Live HTTP E2E tests PASS (100%); Shared (47/47) & Web (46/46) PASS; OpenSSL 3.5.7 CLI CMS verification PASS; Monorepo build PASS. Sẵn sàng Phase 13.3.
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
