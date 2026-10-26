# MEMORY LOG - DỰ ÁN TRÌNH KÝ ONLINE

## 1. Trạng thái hiện tại (Current State)
- **Tình trạng dự án:** Hoàn thành toàn diện **Phase 13.4.1 — Production Acceptance Audit: Workflow Auto-Signing, PAdES B-LT, Security & Reliability**.
- **Quyết định nghiệm thu:** **CONDITIONAL GO** cho Staging / Pre-Production Pilot (đầy đủ bằng chứng kiểm định mật mã OpenSSL 3.5.7 CLI, không còn lỗi P0, bảo vệ 100% ranh giới Tenant).
- **Hạ tầng đang hoạt động phục vụ kiểm thử:**
  - **PostgreSQL Database:** Docker Container `trinh-ky-postgres-dev` (`postgres:16-alpine`) healthy tại `localhost:5432`.
  - **Backend API Server (NestJS):** Đang chạy tại `http://localhost:4000` (task background daemon), SLA Scheduler và Notification Retry Worker hoạt động ổn định.
  - **Frontend Web App (Next.js):** Sẵn sàng giao diện con dấu số `PadesSealCard`, `PadesBadge` và `LtvVerificationDrawer`.
- **Thống kê kiểm thử nghiệm thu:**
  - **Unit Tests (@trinh-ky/api):** 232/232 PASS (100%).
  - **PostgreSQL Integration Tests:** 158/158 PASS (15 suites) bao gồm 5 bài test chuyên sâu cho Audit A, B, E, G.
  - **Live HTTP E2E Security Tests:** 93/93 PASS (100%) qua server NestJS daemon.
  - **Independent OpenSSL 3.5.7 CLI Tests:** 12/12 PASS (CMS Detached, RFC 3161 Timestamp, OCSP Structure).
  - **Shared (47/47) & Web (46/46) Suites:** PASS 100%. Tổng cộng 588/588 tests đạt trạng thái PASS.

## 2. Quyết định kỹ thuật & Kiến trúc (Key Decisions)
- **Idempotency trong Auto-Sealing (Audit A):**
  - `autoSealApprovedDocument` kiểm tra nếu đã tồn tại `SIGNED_PDF` artifact có `hasLtv: true` và `COMPLETED` thì trả về ngay, không render lại, không ký lại và không ghi trùng AuditLog.
- **Tuân thủ Chính sách Con dấu Pháp nhân (Audit B):**
  - Tuyệt đối chỉ dùng con dấu doanh nghiệp (`userId: null, status: ACTIVE`) còn hạn (`validFrom <= now <= validTo`) để niêm phong tổ chức. Không tự ý fallback sang chứng thư cá nhân của approver nếu chưa có chính sách nghiệp vụ phê duyệt rõ ràng.
- **Cơ chế Phục hồi & Tái niêm phong (Operational Recovery - Audit E):**
  - Cung cấp endpoint `POST /api/documents/:id/reconcile-seal` và hàm `reconcileUnsealedApprovedDocument` để tái xử lý hồ sơ `APPROVED` chưa được niêm phong do sự cố hạ tầng tạm thời (TSA timeout, storage glitch).
- **Monorepo Cross-CWD Fallback (Audit E):**
  - `LocalDiskStorageProvider` và `DevLocalKeystoreProvider` tự động đối soát và đồng bộ tệp nhị phân giữa các thư mục chạy của monorepo (`apps/api/storage` và `root/storage`).
- **Ranh giới PAdES Baseline B-LT (Audit C):**
  - Hệ thống đạt PAdES Baseline B-LT (CMS Detached + RFC 3161 TSA + DSS/VRI Incremental Update). Không tuyên bố B-LTA khi chưa có worker cấp Document Timestamp (DTS) định kỳ.

## 3. Nhật ký thay đổi gần nhất (Recent Changes - 5 task gần nhất)
- `[2026-10-26 - Phase 13.4.1: Production Acceptance Audit]`:
  - **Files:** `apps/api/src/modules/signing/engine/pdf-signing.service.ts`, `apps/api/src/modules/workflow/workflow-orchestrator.service.ts`, `apps/api/src/modules/workflow/document-workflow.controller.ts`, `apps/api/src/modules/signing/providers/dev-local-keystore.provider.ts`, `apps/api/src/modules/artifact/storage/local-disk-storage.provider.ts`, `apps/api/test/workflow-pades-auto-signing.integration.spec.ts`, `docs/architecture/PHASE_13_4_1_PRODUCTION_ACCEPTANCE_AUDIT.md`, `docs/architecture/DIGITAL_SIGNING_IMPLEMENTATION_PLAN.md`.
  - **Nội dung:** Khắc phục P1-01 (Idempotency), P1-02 (Expired cert filter), P1-03 (Reconciliation endpoint), đồng bộ monorepo storage/keystore; bổ sung 5 integration test chuyên sâu; chạy nghiệm thu độc lập OpenSSL 3.5.7 CLI đạt 100% PASS; lập báo cáo nghiệm thu chi tiết.
- `[2026-10-26 - Phase 13.4: Workflow Auto-Signing Integration & Production Readiness]`:
  - **Files:** `packages/shared/src/*`, `apps/api/src/modules/signing/engine/pdf-signing.service.ts`, `apps/api/src/modules/workflow/*`, `apps/web/src/*`, `apps/api/test/workflow-pades-auto-signing.integration.spec.ts`, `apps/api/test/e2e-http-live.ts`, `docs/API_CONTRACT.md`.
  - **Nội dung:** Tự động kích hoạt niêm phong PAdES B-LT khi hồ sơ đạt `APPROVED`; xây dựng UI `PadesSealCard`, `PadesBadge`, `LtvVerificationDrawer`.
- `[2026-10-26 - Phase 13.3.2: PAdES Baseline B-LT, DSS/VRI & Long-Term Validation]`:
  - **Files:** `apps/api/prisma/schema.prisma`, `packages/shared/src/*`, `apps/api/src/modules/signing/dss/*`, `apps/api/src/modules/signing/revocation/*`, `apps/api/src/modules/signing/chain/*`, `apps/api/src/modules/signing/engine/*`, `apps/api/test/*`.
  - **Nội dung:** Bổ sung DSS qua Incremental Update; kiểm chứng OpenSSL 3.5.7 CLI cho CMS, TSA, OCSP; phòng chống SSRF và PDF Shadow Attack.
- `[2026-10-24 - Phase 13.3.1: RFC 3161 Trusted Timestamping & PAdES B-T Readiness]`:
  - **Files:** `apps/api/src/modules/signing/timestamp/*`, `apps/api/src/modules/signing/engine/*`, `apps/api/test/*`.
  - **Nội dung:** Tích hợp TimeStampToken vào unsignedAttributes của CMS detached; xác minh độc lập bằng OpenSSL TS verify.
- `[2026-10-24 - Phase 13.2.2: CMS/PDF Signing Engine]`:
  - **Files:** `apps/api/src/modules/signing/*`, `apps/api/src/modules/artifact/artifact.service.ts`, `apps/api/test/*`.
  - **Nội dung:** Tạo cấu trúc ByteRange chuẩn ISO 32000; ký RSASSA-PKCS1-v1_5 SHA-256; kiểm toán bất biến `DOCUMENT_SIGN_PDF`.
