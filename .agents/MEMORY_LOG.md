# MEMORY LOG - DỰ ÁN TRÌNH KÝ ONLINE

## 1. Trạng thái hiện tại (Current State)
- **Tình trạng dự án:** Hoàn thành **Phase 13.4.2 — Production Deployment Readiness & Independent PAdES Validation**.
- **Quyết định Gating:**
  - **Staging:** **GO** (100% test pass, storage canonical, môi trường test cô lập, không dùng khóa thật).
  - **Pilot (Diện hẹp):** **CONDITIONAL GO** (Chỉ ký nội bộ, dùng Sandbox KMS / Test HSM, bật alert P0/P1).
  - **Full Production:** **NO-GO** (Gated: Chưa kết nối Cloud KMS / HSM thật và chưa có Qualified TSA thương mại).
- **Hạ tầng kiểm thử:**
  - **PostgreSQL:** Docker Container `trinh-ky-postgres-dev` healthy tại `localhost:5432`.
  - **NestJS Server:** Dev server daemon tại `http://localhost:4000`.
  - **Frontend:** Next.js 15.1.7 (`apps/web`) build production 18 routes thành công.
- **Thống kê kiểm thử Phase 13.4.2:**
  - **API Unit Tests:** 246/246 PASS (26 files, 100%).
  - **PostgreSQL Integration Tests:** 181/181 PASS (18 files, 100%).
  - **Live HTTP E2E Tests:** 93/93 PASS (100%).
  - **Shared (47/47) & Web (46/46) Tests:** PASS 100%.
  - **OpenSSL 3.5.7 CLI Verification:** 12/12 PASS (CMS verify, TS verify, OCSP parse).
  - **Independent PAdES & 7 Negatives:** 8/8 PASS (Baseline + 7 trường hợp âm tính).
  - **Toàn hệ thống:** 633/633 tests PASS (100%).

## 2. Quyết định kỹ thuật & Kiến trúc (Key Decisions)
- **Chuẩn hóa Storage Root & Keystore (Hạng mục B):**
  - Xây dựng `storage-path.util.ts`: Phân giải đường dẫn tuyệt đối canonical duy nhất qua `STORAGE_ROOT` hoặc monorepo root. Kiểm tra quyền `R_OK | W_OK` của OS khi khởi động.
  - Tách biệt `storage/tenants/...` và `storage/keystores`. Loại bỏ hoàn toàn cơ chế tự copy private key giữa các thư mục.
- **Bảo mật Reconcile-Seal & Tự phục hồi tệp mất (Hạng mục C):**
  - Chặn người dùng không có quyền (chỉ Creator, Company Admin, Super Admin được phép).
  - Kiểm tra trạng thái `APPROVED` & `COMPLETED`, đối soát mã băm formData toàn vẹn chống sửa lén CSDL.
  - Tự động phát hiện khi tệp vật lý bị mất trên storage và tái tạo/tái ký phục hồi an toàn.
  - Tuần tự hóa bằng PostgreSQL Advisory Lock chống race condition khi gửi nhiều request đồng thời.
- **Production Signing Provider Adapter (Hạng mục D):**
  - `ISigningKeyProvider` swappable: Engine ký chỉ nhận digest 32-byte và key alias.
  - Xây dựng `SandboxKmsSigningProvider`: Giả lập Cloud KMS với IAM auth, retry/backoff, và self-verification chữ ký số bằng Public Key trước khi trả về.
- **Thẩm định độc lập PAdES & Kịch bản âm tính (Hạng mục A):**
  - Kiểm chứng độc lập bằng OpenSSL 3.5.7 CLI và bộ test 7 kịch bản âm tính: Phát hiện can thiệp ByteRange, làm sai ByteRange, đổi CMS signature, làm hỏng Timestamp token, thiếu EKU timeStamping, thiếu revocation evidence trong DSS, và chứng thư bị thu hồi trong OCSP.

## 3. Nhật ký thay đổi gần nhất (Recent Changes - 5 task gần nhất)
- `[2026-10-26 - Phase 13.4.2: Production Deployment Readiness & Independent PAdES Validation]`:
  - **Files:** `apps/api/src/modules/artifact/storage/storage-path.util.ts`, `apps/api/src/modules/artifact/storage/local-disk-storage.provider.ts`, `apps/api/src/modules/signing/providers/dev-local-keystore.provider.ts`, `apps/api/src/modules/signing/providers/sandbox-kms-signing.provider.ts`, `apps/api/src/modules/signing/engine/pdf-signing.service.ts`, `apps/api/src/modules/workflow/workflow-orchestrator.service.ts`, `apps/api/src/modules/workflow/document-workflow.controller.ts`, `packages/shared/src/enums.ts`, `apps/api/test/signing/reconcile-seal-security.integration.spec.ts`, `apps/api/test/signing/production-provider-architecture.spec.ts`, `apps/api/test/signing/independent-pades-negative-validation.spec.ts`, `docs/architecture/PRODUCTION_OPERATIONS_RUNBOOK.md`, `docs/architecture/PHASE_13_4_2_PRODUCTION_READINESS_REPORT.md`.
  - **Nội dung:** Chuẩn hóa canonical storage root; bảo mật và phục hồi cho `reconcile-seal`; phát triển Sandbox KMS adapter; kiểm thử 7 kịch bản âm tính PAdES B-LT; ban hành Sổ tay vận hành (Runbook) và Báo cáo sẵn sàng triển khai; 633/633 tests PASS (100%).
- `[2026-10-26 - Phase 13.4.1: Production Acceptance Audit]`:
  - **Files:** `apps/api/src/modules/signing/engine/pdf-signing.service.ts`, `apps/api/src/modules/workflow/*`, `docs/architecture/PHASE_13_4_1_PRODUCTION_ACCEPTANCE_AUDIT.md`.
  - **Nội dung:** Khắc phục P1-01 (Idempotency), P1-02 (Expired cert filter), P1-03 (Reconciliation endpoint); nghiệm thu OpenSSL 3.5.7 CLI đạt 100% PASS.
- `[2026-10-26 - Phase 13.4: Workflow Auto-Signing Integration & Production Readiness]`:
  - **Files:** `packages/shared/src/*`, `apps/api/src/modules/signing/engine/pdf-signing.service.ts`, `apps/api/src/modules/workflow/*`, `apps/web/src/*`.
  - **Nội dung:** Tự động niêm phong PAdES B-LT khi hồ sơ đạt `APPROVED`; xây dựng UI `PadesSealCard`, `PadesBadge`, `LtvVerificationDrawer`.
- `[2026-10-26 - Phase 13.3.2: PAdES Baseline B-LT, DSS/VRI & Long-Term Validation]`:
  - **Files:** `apps/api/prisma/schema.prisma`, `packages/shared/src/*`, `apps/api/src/modules/signing/dss/*`, `apps/api/src/modules/signing/revocation/*`.
  - **Nội dung:** Bổ sung DSS qua Incremental Update; kiểm chứng OpenSSL 3.5.7 CLI; chống SSRF và PDF Shadow Attack.
- `[2026-10-24 - Phase 13.3.1: RFC 3161 Trusted Timestamping & PAdES B-T Readiness]`:
  - **Files:** `apps/api/src/modules/signing/timestamp/*`, `apps/api/src/modules/signing/engine/*`.
  - **Nội dung:** Tích hợp TimeStampToken vào unsignedAttributes của CMS detached; xác minh độc lập bằng OpenSSL TS verify.
