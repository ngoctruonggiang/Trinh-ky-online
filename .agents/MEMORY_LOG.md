# MEMORY LOG - DỰ ÁN TRÌNH KÝ ONLINE

## 1. Trạng thái hiện tại (Current State)
- **Tình trạng dự án:** Hoàn thành toàn diện Phase 12.1 — Delegation Policy Engine & Auditable Workflow Integration (**230 Unit tests PASS [47 shared + 137 api + 46 web], 97 PostgreSQL Integration tests PASS [11 template + 14 read-api + 7 workflow + 12 workflow-template + 18 workflow-integrity + 11 reassignment/SLA + 13 SLA scheduler/idempotency/retry + 11 delegation], 48/48 Live HTTP E2E tests PASS, `pnpm build` toàn monorepo PASS 100%**).
- **Trạng thái dịch vụ đang chạy phục vụ kiểm thử (Active Servers):**
  - **PostgreSQL Database:** Docker Container `trinh-ky-postgres-dev` (`postgres:16-alpine`) chạy healthy tại `localhost:5432`.
  - **Backend API Server (NestJS):** Đang chạy tại `http://localhost:4000`, SLA Scheduler worker (300s) và Notification Retry Worker (60s) hoạt động nền an toàn.
  - **Frontend Web App (Next.js):** Đang cấu hình kết nối trực tiếp Real API (`NEXT_PUBLIC_USE_MOCK_API=false`), không fallback sang mock.
- **Môi trường Database & Migrations:**
  - CSDL PostgreSQL thật up-to-date với 8 migrations (migration gần nhất `20261023114723_add_delegation_policy_engine`). Toàn bộ migration an toàn 100% với dữ liệu hiện hữu.
- **Tính năng hoàn tất và kiểm chứng trong Phase 12.1:**
  - **Delegation Policy Engine:** Hỗ trợ thiết lập ủy quyền có thời hạn và phạm vi (department, template, org-wide).
  - **Security & Tenant Isolation:** Chặn tuyệt đối self-delegation, cross-tenant delegation, tài khoản inactive.
  - **Directed Cycle Detection (DFS):** Ngăn chặn chu trình khép kín trực tiếp $A \rightarrow B \rightarrow A$ và gián tiếp đa cấp $A \rightarrow B \rightarrow C \rightarrow A$.
  - **Deterministic Policy Resolution:** Ưu tiên theo thang điểm cụ thể (Score 3: template+dept > Score 2: template > Score 1: dept > Score 0: org-wide), tie-break bằng `createdAt` mới nhất.
  - **Auditable Workflow Integration:** Bảo toàn `StepAssignee` gốc; FSM thực thi trên ghế duyệt của delegator; `StepDecisionHistory` lưu đầy đủ attribution (`userId = actualActorId`, `isDelegated = true`, `delegatedFromUserId`, `delegationPolicyId`); gửi notification thông báo cho delegator.

## 2. Quyết định kỹ thuật & Kiến trúc (Key Decisions)
- **Phân định rõ Delegation vs Reassignment:**
  - Reassignment: Chuyển giao trực tiếp người chịu trách nhiệm (`StepAssignee.userId`).
  - Delegation: Giữ nguyên `StepAssignee.userId`, trao thẩm quyền proxy execution có phạm vi và thời hạn cho delegatee.
- **Cycle Detection bằng thuật toán DFS trên đồ thị có hướng:**
  - Quét toàn bộ chính sách đang hoạt động có khoảng thời gian giao thoa trong cùng tổ chức để phát hiện đường đi ngược $Y \rightarrow^* X$ trước khi cho phép tạo cạnh mới $X \rightarrow Y$.
- **Deterministic Resolution & Attribution Trail:**
  - Policy Resolution giải quyết tranh chấp hoàn toàn tất định (không chọn ngẫu nhiên).
  - Lịch sử phê duyệt (`StepDecisionHistory`) phân biệt rạch ròi người được giao ban đầu, người thực tế thực hiện quyết định, và căn cứ chính sách ủy quyền.

## 3. Nhật ký thay đổi gần nhất (Recent Changes)
- `[2026-10-23 - Phase 12.1: Delegation Policy Engine & Auditable Workflow Integration]`:
  - **Files:** `packages/shared/src/enums.ts`, `packages/shared/src/types.ts`, `apps/api/prisma/schema.prisma`, migration `20261023114723`, `apps/api/src/modules/delegation/*`, `apps/api/src/modules/workflow/*`, `apps/web/src/types/document.ts`, `apps/web/src/services/api/delegation-service.ts`, `apps/web/src/components/documents/workflow-action-box.tsx`, `apps/web/src/app/documents/[id]/page.tsx`, `apps/api/test/delegation-postgresql.integration.spec.ts`, `apps/api/test/e2e-http-live.ts`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 230/230 Unit tests PASS; 97/97 PostgreSQL integration tests PASS; 48/48 Live HTTP E2E tests PASS; Monorepo build PASS 100%.
- `[2026-10-23 - Phase 12.0.2: Notification Reliability Audit & Production Readiness Gate]`:
  - **Files:** `apps/api/src/modules/notification/*`, `apps/api/src/modules/workflow/sla-scheduler.*`, `apps/api/test/sla-scheduler-idempotency-postgresql.integration.spec.ts`, `apps/api/test/e2e-http-live.ts`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 218/218 Unit tests PASS; 86/86 PostgreSQL integration tests PASS; 41/41 Live HTTP E2E tests PASS; Monorepo build PASS 100%.
- `[2026-10-23 - Phase 12.0.1: SLA Scheduler, Notification Reliability & Regression Verification]`:
  - **Files:** `apps/api/src/modules/workflow/sla-scheduler.*`, `apps/api/src/modules/notification/notification.service.ts`, `apps/api/test/sla-scheduler-idempotency-postgresql.integration.spec.ts`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 214/214 Unit tests PASS; 37/37 PostgreSQL integration tests PASS; 38/38 Live HTTP E2E tests PASS; Monorepo build PASS 100%.
- `[2026-10-23 - Phase 12: Advanced Approval Features & Exception Handling]`:
  - **Files:** `packages/shared/*`, `apps/api/prisma/schema.prisma`, `apps/api/src/modules/workflow/*`, `apps/web/*`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 200/200 Unit tests PASS; 29/29 PostgreSQL integration tests PASS; 32/32 Live HTTP E2E tests PASS; Monorepo build PASS 100%.
- `[2026-10-23 - Phase 11.1: End-to-End Verification & Workflow Integrity]`:
  - **Files:** `packages/shared/src/workflow-fsm.ts`, `apps/api/src/modules/workflow/workflow-orchestrator.service.ts`, `apps/api/test/workflow-integrity-postgresql.integration.spec.ts`, `apps/api/test/e2e-http-live.ts`, `docs/API_CONTRACT.md`.
  - **Kết quả:** 187/187 Unit tests PASS; 62/62 PostgreSQL integration tests PASS; 26/26 Live HTTP E2E tests PASS; Monorepo build PASS 100%.
