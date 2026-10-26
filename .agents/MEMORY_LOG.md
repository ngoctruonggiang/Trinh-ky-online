# MEMORY LOG - DỰ ÁN TRÌNH KÝ ONLINE

## 1. Trạng thái hiện tại (Current State)
- **Tình trạng dự án:** Hoàn thành xuất sắc toàn bộ **Phase 13.4 — Workflow Auto-Signing Integration, Multi-Signer & Production Readiness** (**ALL GATES PASSED — HỆ THỐNG KÝ SỐ ĐẠT TRẠNG THÁI PRODUCTION-READY**).
- **Trạng thái dịch vụ đang chạy phục vụ kiểm thử (Active Servers):**
  - **PostgreSQL Database:** Docker Container `trinh-ky-postgres-dev` (`postgres:16-alpine`) chạy healthy tại `localhost:5432`.
  - **Backend API Server (NestJS):** Đang chạy tại `http://localhost:4000`, SLA Scheduler worker (300s) và Notification Retry Worker (60s) hoạt động nền an toàn.
  - **Frontend Web App (Next.js):** Cấu hình Real API (`NEXT_PUBLIC_USE_MOCK_API=false`), build production hoàn tất thành công.
- **Tính năng hoàn thành trong Phase 13.4:**
  - `WorkflowOrchestratorService` & `PdfSigningService`: Tự động kích hoạt niêm phong số `autoSealApprovedDocument` khi hồ sơ chuyển sang trạng thái cuối cùng `APPROVED`.
  - Lựa chọn con dấu điện tử tổ chức (`userId: null`) hoặc chứng thư cá nhân người duyệt cuối cùng có khóa sẵn sàng trong `ISigningKeyProvider`.
  - Cưỡng bức ký với RFC 3161 Timestamp (`requireTimestamp: true`) và Document Security Store (`includeLtv: true`) để sinh artifact `SIGNED_PDF` chuẩn PAdES Baseline B-LT.
  - Cơ chế **Fail-safe / Graceful Fallback**: Nếu tổ chức chưa cấu hình chứng thư số PKI, quy trình phê duyệt vẫn hoàn tất thành công (`APPROVED`) không làm gián đoạn nghiệp vụ.
  - Liên kết ủy quyền & đa chữ ký: Kiểm toán liên kết chặt chẽ `actualActor`, `delegatorId`, `delegationPolicyId`, `stepId`, `certificateId`, phát sinh cả `DOCUMENT_SIGN_PDF` và `DOCUMENT_ADD_LTV`.
  - Phát sinh thông báo `DOCUMENT_APPROVED` kèm liên kết tải về `/api/documents/:id/pdf?type=SIGNED_PDF`.
  - Frontend Web UI: Triển khai `PadesSealCard`, `PadesBadge` (`PADES_B_LT`), và `LtvVerificationDrawer` hiển thị kết quả kiểm định 5 trụ cột thời gian thực.

## 2. Quyết định kỹ thuật & Kiến trúc (Key Decisions)
- **Tự động Niêm phong số khi Phê duyệt Hoàn tất (ADR-13):**
  - Trigger ngay sau transaction chuyển trạng thái `APPROVED` trong `processAssigneeDecision`.
  - Cưỡng bức cấp độ PAdES Baseline B-LT (RFC 3161 TSA + DSS LTV).
  - Ranh giới rõ ràng: Đạt PAdES Baseline B-LT, không tuyên bố B-LTA khi chưa có Document Timestamp định kỳ.
- **Nguyên tắc Fail-Safe / Graceful Fallback (ADR-13):**
  - Thiếu chứng thư số PKI không làm treo luồng phê duyệt của tổ chức.
- **Chuẩn hóa 3-Tier Hash & Bảo toàn Tệp Gốc (ADR-05, ADR-10):**
  - `formDataHash` (JSON) $\rightarrow$ `rawPdfHash` (PDF gốc `OFFICIAL_UNSIGNED` bất biến) $\rightarrow$ `signedPdfHash` (`SIGNED_PDF`).
- **Cấu trúc Dấu Thời Gian RFC 3161 & PAdES B-T (ADR-11, THR-15, THR-16):**
  - Dữ liệu đầu vào: `SHA-256(signatureValue)` trong `unsignedAttrs [1] IMPLICIT` (OID `1.2.840.113549.1.9.16.2.14`).
- **PAdES Baseline B-LT & Document Security Store (ADR-12, THR-17, THR-18):**
  - Bổ sung DSS qua Incremental Update: Tuyệt đối không thay đổi ByteRange Revision 1.
  - Phòng thủ SSRF và chống PDF Shadow Attack toàn diện.
- **Bảo vệ Khóa Riêng & Không Xuất Khóa (ADR-08):**
  - `ISigningKeyProvider` chỉ nhận `signDigest(keyAlias, digest32Bytes)`.

## 3. Nhật ký thay đổi gần nhất (Recent Changes - 5 task gần nhất)
- `[2026-10-26 - Phase 13.4: Workflow Auto-Signing Integration & Production Readiness]`:
  - **Files:** `packages/shared/src/*`, `apps/api/src/modules/signing/engine/pdf-signing.service.ts`, `apps/api/src/modules/workflow/*`, `apps/web/src/*`, `apps/api/test/workflow-pades-auto-signing.integration.spec.ts`, `apps/api/test/e2e-http-live.ts`, `docs/API_CONTRACT.md`, `docs/architecture/*`.
  - **Kết quả:** 232/232 API Unit tests PASS; 153/153 PostgreSQL integration tests PASS (15 suites); 93/93 Live HTTP E2E tests PASS (100%); Shared (47/47) & Web (46/46) PASS; Monorepo build 0 lỗi. Toàn bộ Phase 13 hoàn thành xuất sắc!
- `[2026-10-26 - Phase 13.3.2: PAdES Baseline B-LT, DSS/VRI & Long-Term Validation]`:
  - **Files:** `apps/api/prisma/schema.prisma`, `migrations/20261026011944_add_ltv_to_document_artifact/*`, `packages/shared/src/*`, `apps/api/src/modules/signing/dss/*`, `apps/api/src/modules/signing/revocation/*`, `apps/api/src/modules/signing/chain/*`, `apps/api/src/modules/signing/engine/*`, `apps/api/test/*`, `docs/*`.
  - **Kết quả:** 232/232 API Unit tests PASS; 150/150 PostgreSQL integration tests PASS; 90/90 Live HTTP E2E tests PASS; OpenSSL 3.5.7 CLI CMS/TS/OCSP verify PASS 100%. Sẵn sàng Phase 13.4.
- `[2026-10-24 - Phase 13.3.1: RFC 3161 Trusted Timestamping & PAdES B-T Readiness]`:
  - **Files:** `apps/api/prisma/schema.prisma`, `migrations/20261024100131_add_timestamp_to_document_artifact/*`, `packages/shared/src/*`, `apps/api/src/modules/signing/timestamp/*`, `apps/api/src/modules/signing/engine/*`, `apps/api/src/modules/signing/dto/*`, `apps/api/test/*`, `docs/*`.
  - **Kết quả:** 215/215 API Unit tests PASS; 128/128 PostgreSQL integration tests PASS; 85/85 Live HTTP E2E tests PASS; OpenSSL 3.5.7 CLI TS verification OK. Sẵn sàng Phase 13.3.2.
- `[2026-10-24 - Phase 13.2.2: CMS/PDF Signing Engine]`:
  - **Files:** `apps/api/prisma/schema.prisma`, `migrations/20261024091838_add_signed_pdf_artifact/*`, `packages/shared/src/*`, `apps/api/src/modules/signing/*`, `apps/api/src/modules/artifact/artifact.service.ts`, `apps/api/test/*`, `docs/*`.
  - **Kết quả:** 199/199 API Unit tests PASS; 126/126 PostgreSQL integration tests PASS; 80/80 Live HTTP E2E tests PASS. Sẵn sàng Phase 13.3.
- `[2026-10-24 - Phase 13.2.1: Signing Provider, X.509 Certificate Registry & Secure Local Keystore]`:
  - **Files:** `apps/api/prisma/schema.prisma`, `migrations/20261024020537_add_digital_certificates/*`, `packages/shared/src/*`, `apps/api/src/modules/signing/*`, `apps/api/test/*`, `docs/*`.
  - **Kết quả:** 180/180 API Unit tests PASS; 119/119 PostgreSQL integration tests PASS; 70/70 Live HTTP E2E tests PASS. Sẵn sàng Phase 13.2.2.
