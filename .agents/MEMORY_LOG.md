# MEMORY LOG - DỰ ÁN TRÌNH KÝ ONLINE

## 1. Trạng thái hiện tại (Current State)
- **Tình trạng dự án:** Hoàn thành xuất sắc Phase 13.3.1 — RFC 3161 Trusted Timestamping & PAdES B-T Readiness (**ALL GATES PASSED — GO CHO PHASE 13.3.2**).
- **Trạng thái dịch vụ đang chạy phục vụ kiểm thử (Active Servers):**
  - **PostgreSQL Database:** Docker Container `trinh-ky-postgres-dev` (`postgres:16-alpine`) chạy healthy tại `localhost:5432`.
  - **Backend API Server (NestJS):** Đang chạy tại `http://localhost:4000`, SLA Scheduler worker (300s) và Notification Retry Worker (60s) hoạt động nền an toàn.
  - **Frontend Web App (Next.js):** Đang cấu hình kết nối trực tiếp Real API (`NEXT_PUBLIC_USE_MOCK_API=false`), không fallback sang mock.
- **Tính năng hoàn thành trong Phase 13.3.1:**
  - `Rfc3161TimestampClient`: Đóng gói ASN.1 DER `TimeStampReq` với `messageImprint` = SHA-256(`signatureValue`), nonce 64-bit ngẫu nhiên, `certReq: true`. Gọi HTTP/HTTPS TSA với timeout, giới hạn kích thước response và retry logic.
  - `TimestampTokenVerifier`: Xác minh độc lập `TimeStampToken` (TSTInfo OID `1.2.840.113549.1.9.16.1.4`), kiểm tra `messageImprint`, đối soát nonce, thẩm định chứng thư số TSA (EKU `id-kp-timeStamping`, thời hạn hiệu lực), và xác minh chữ ký số RSA của TSA qua TSTInfo + SignedAttrs (`signingCertificateV2`).
  - `DevTestTsaProvider`: Triển khai offline TSA provider chuẩn RFC 3161 phục vụ unit/integration/E2E test, sinh cặp khóa RSA 2048-bit, X.509 cert với EKU Timestamping, đầy đủ ESS `signingCertificateV2` đạt chuẩn OpenSSL 3.5.7 CLI.
  - `CmsSignatureBuilder`: Nhúng verified `TimeStampToken` vào CMS `SignerInfo.unsignedAttrs [1] IMPLICIT` dưới OID `1.2.840.113549.1.9.16.2.14` (`id-aa-signatureTimeStampToken`), giữ nguyên 100% `signedAttrs` và chữ ký của signer.
  - `PdfSignatureVerifier`: Tự động phân tích `unsignedAttrs`, trích xuất `id-aa-signatureTimeStampToken`, kiểm tra tính toàn vẹn và phát hiện can thiệp nhị phân cấp byte (Tamper Detection).
  - `PdfSigningService`: Tích hợp cờ `requireTimestamp`, thực thi cơ chế fail-closed khi TSA lỗi, lưu trữ siêu dữ liệu TSA vào `DocumentArtifact` qua migration `20261024100131_add_timestamp_to_document_artifact`.
  - Xác minh độc lập bằng OpenSSL 3.5.7 CLI: Cả `openssl cms -verify` và `openssl ts -verify -token_in` đều trả về `Verification: OK`.
  - Ranh giới kỹ thuật: Đạt PAdES Baseline B-T readiness; chưa có LTV/DSS/VRI/B-LT/B-LTA (thuộc Phase 13.3.2); chưa tự động ký khi văn bản `APPROVED` (thuộc Phase 13.4).

## 2. Quyết định kỹ thuật & Kiến trúc (Key Decisions)
- **Chuẩn hóa 3-Tier Hash & Bảo toàn Tệp Gốc (ADR-05, ADR-10):**
  - `formDataHash`: Hash SHA-256 dữ liệu nghiệp vụ JSON.
  - `rawPdfHash`: SHA-256 của tệp PDF gốc chưa ký `OFFICIAL_UNSIGNED` (bảo toàn 100%, không bao giờ bị ghi đè).
  - `signedPdfHash`: SHA-256 của toàn bộ tệp PDF đã ký số `SIGNED_PDF`.
- **Cấu trúc Dấu Thời Gian RFC 3161 & PAdES B-T (ADR-11, THR-15, THR-16):**
  - Dữ liệu đầu vào của TimeStampToken: Bắt buộc là `SHA-256(signatureValue)` của `SignerInfo` (theo ETSI EN 319 142-1 Clause 5.3), KHÔNG băm trên PDF ByteRange digest.
  - Vị trí nhúng: Đặt trong `unsignedAttrs [1] IMPLICIT` của `SignerInfo` với OID `1.2.840.113549.1.9.16.2.14`. Không làm thay đổi `signedAttrs` của signer.
  - Thẩm định TSA Certificate: Bắt buộc kiểm tra Extended Key Usage `id-kp-timeStamping` (`1.3.6.1.5.5.7.3.8`) và kiểm tra `notBefore <= genTime <= notAfter`.
  - Tuân thủ OpenSSL 3.5.7 ESS Check: TSA `signedAttrs` bắt buộc chứa ESS `signingCertificateV2` (OID `1.2.840.113549.1.9.16.2.47`).
- **Quy trình Ký Fail-Closed & Tự Xác minh (Self-Verification):**
  - Nếu `requireTimestamp: true` và TSA thất bại (network timeout, invalid status, unverified token), quá trình ký bị từ chối ngay lập tức, không lưu tệp hỏng.
- **Bảo vệ Khóa Riêng & Không Xuất Khóa (ADR-08):**
  - `ISigningKeyProvider` chỉ nhận `signDigest(keyAlias, digest32Bytes)`, tuyệt đối không bao giờ xuất private key ra ngoài RAM.

## 3. Nhật ký thay đổi gần nhất (Recent Changes - 5 task gần nhất)
- `[2026-10-24 - Phase 13.3.1: RFC 3161 Trusted Timestamping & PAdES B-T Readiness]`:
  - **Files:** `apps/api/prisma/schema.prisma`, `migrations/20261024100131_add_timestamp_to_document_artifact/*`, `packages/shared/src/*`, `apps/api/src/modules/signing/timestamp/*`, `apps/api/src/modules/signing/engine/*`, `apps/api/src/modules/signing/dto/*`, `apps/api/test/*`, `docs/API_CONTRACT.md`, `docs/architecture/*`, `docs/security/*`.
  - **Kết quả:** 215/215 API Unit tests PASS; 128/128 PostgreSQL integration tests PASS; 85/85 Live HTTP E2E tests PASS (100%); Shared (47/47) & Web (46/46) PASS; OpenSSL 3.5.7 CLI TS verification `Verification: OK`; Monorepo build PASS. Sẵn sàng Phase 13.3.2.
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
