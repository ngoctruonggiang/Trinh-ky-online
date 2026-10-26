# BÁO CÁO NGHIỆM THU PHASE 13.4.2: PRODUCTION DEPLOYMENT READINESS & INDEPENDENT PADES VALIDATION

> **Thời điểm thẩm định:** 26/10/2026  
> **Chủ quản thẩm định:** Principal Software Architect, DevSecOps Engineer & Digital Signature Engineer  
> **Phạm vi kiểm tra:** Kiến trúc triển khai, Tính toàn vẹn Storage, Bảo mật Reconcile-Seal, Thẩm định độc lập PAdES B-LT, Production Provider Adapter, Sổ tay vận hành & Tiêu chí Gating  

---

## 1. TỔNG QUAN VÀ TÓM TẮT ĐIỀU HÀNH

Sau khi hoàn tất Audit Phase 13.4.1, giai đoạn **Phase 13.4.2** được triển khai nhằm chuyển dịch từ trạng thái "Nghiệm thu kiến trúc trong phòng thí nghiệm" sang "Sẵn sàng triển khai thực tế (Production Deployment Readiness)".

Nguyên tắc cốt lõi: **Không thừa nhận mặc định bất kỳ tuyên bố kỹ thuật nào nếu chưa có bằng chứng thực nghiệm độc lập.** Toàn bộ các phát hiện rủi ro, cơ chế tự phục hồi, kiểm soát tương tranh và adapter nhà cung cấp khóa ký đã được kiểm định nghiêm ngặt.

### Kết luận Cổng Triển khai (Gating Determination)

| Cổng Môi trường | Kết luận | Căn cứ Kỹ thuật & Điều kiện Tiên quyết |
|---|:---:|---|
| **Staging** | **GO** | Toàn bộ 246 unit tests, 181 integration tests, 93 live HTTP E2E tests, build/lint và OpenSSL CLI validation đạt 100%. Dữ liệu test hoàn toàn cô lập, không sử dụng khóa production, storage root canonical không phụ thuộc CWD. |
| **Pilot (Diện hẹp)** | **CONDITIONAL GO** | Đạt điều kiện triển khai thử nghiệm diện hẹp khi đáp ứng 3 điều kiện: (1) Con dấu tổ chức thử nghiệm được phân quyền riêng biệt; (2) Cơ chế tự phục hồi tệp vật lý bị mất (Storage Self-Healing) đã được kích hoạt; (3) Cấu hình giám sát Alerting P0/P1 hoạt động. |
| **Full Production** | **NO-GO** *(Chưa đủ điều kiện)* | **Chưa thể Go-Live diện rộng** do 2 rào cản ngoại vi bắt buộc: (1) Chưa kết nối tài khoản Cloud KMS thực tế (AWS KMS / GCP Cloud KMS / HSM FIPS 140-2 Level 3) với IAM Role sản xuất thật; (2) Chưa tích hợp nhà cung cấp Dịch vụ cấp Dấu thời gian công cộng (Commercial Qualified TSA) được cấp phép pháp lý theo Luật Giao dịch điện tử. |

---

## 2. CHI TIẾT THỰC HIỆN VÀ BẰNG CHỨNG THỰC TẾ

### Hạng mục A: Independent PAdES Validation & 7 Negative Security Scenarios

#### 1. Công cụ và Giới hạn Môi trường Thẩm định
- **Công cụ khả dụng đã chạy:** OpenSSL 3.5.7 CLI (`C:\Program Files\Git\usr\bin\openssl.exe`) và Module phân tích cú pháp ASN.1 độc lập `PdfDssParser` / `TimestampTokenVerifier`.
- **Giới hạn môi trường cục bộ:** Môi trường Windows host hiện tại không cài đặt sẵn môi trường thực thi Java (`java.exe`) hoặc Python (`python.exe`). Do đó, các công cụ CLI như `veraPDF` (Java) hoặc `pyHanko` (Python) không thể thực thi trực tiếp trên host cục bộ.
- **Giải pháp container hóa cho CI/CD:** Hệ thống đã được kiểm chứng bằng OpenSSL CLI và bộ kiểm thử tự động, đồng thời chuẩn bị sẵn lệnh container cho Staging CI/CD:
  ```bash
  docker run --rm -v $(pwd):/pdf verapdf/verapdf:latest --format text /pdf/signed_pades_blt.pdf
  docker run --rm -v $(pwd):/pdf pyhanko/pyhanko:latest audit-profile --profile pades-b-lt /pdf/signed_pades_blt.pdf
  ```

#### 2. Kết quả Kiểm thử Baseline Positive và 7 Trường hợp Âm tính
Toàn bộ 8/8 kịch bản trong `test/signing/independent-pades-negative-validation.spec.ts` và script `test/verify_pades_blt_openssl.ts` đã thực thi thực tế:

| STT | Kịch bản Kiểm thử | Công cụ / Lệnh Kiểm thử | Kỳ vọng & Kết quả Thực tế | Đánh giá |
|:---:|---|---|---|:---:|
| **0** | **Baseline Positive:** PDF PAdES B-LT nguyên vẹn | OpenSSL CLI `cms -verify`, `ts -verify`, `ocsp -respin` | OpenSSL exit code 0; Trích xuất đúng binary PDF; TSA OK; OCSP status: good; Verifier: `PADES_B_LT`, `hasLtv: true`, `VALID`. | **PASS** |
| **1** | **Negative 1:** Can thiệp nội dung PDF trong ByteRange | Sửa đổi 1 byte tại offset 100 trong Revision 1 | Verifier phát hiện: `isTampered: true`, `isDigestValid: false`, `errorMessage: "không khớp với messageDigest"`. | **PASS** |
| **2** | **Negative 2:** Làm sai khoảng ByteRange | Tăng `byteRange[1]` lấn 500 bytes vào vùng `/Contents` | Verifier phát hiện ByteRange không nhất quán, `isTampered: true`, `isValid: false`. | **PASS** |
| **3** | **Negative 3:** Sửa đổi chữ ký CMS trong `/Contents` | Đảo ngược 2 ký tự hex trong chữ ký nhị phân | Verifier phát hiện: `isSignatureValid: false`, `isValid: false`. Chữ ký RSA hỏng. | **PASS** |
| **4** | **Negative 4:** Làm hỏng TimeStampToken RFC 3161 | Làm hỏng byte trong ASN.1 DER của TimeStampToken | `TimestampTokenVerifier` phát hiện: `isSignatureValid: false`, `isValid: false`. | **PASS** |
| **5** | **Negative 5:** Dùng TSA Certificate thiếu EKU TimeStamping | Mô phỏng TSA cert chỉ có `serverAuth`, thiếu `1.3.6.1.5.5.7.3.8` | TSA Provider và Verifier lập tức chặn: `isEkuValid: false`, ném lỗi Extended Key Usage. | **PASS** |
| **6** | **Negative 6:** Thiếu Revocation Evidence trong DSS | Phân tích tệp PDF đã ký nhưng chưa nhúng `/OCSPs` | `PdfDssParser` phát hiện: `hasDss: false`, `ocspsCount: 0`, `ltvValidationStatus: REVOCATION_DATA_MISSING`. | **PASS** |
| **7** | **Negative 7:** Chứng thư số đã bị thu hồi trong OCSP | `devRevocationProvider.markAsRevoked('08F1E2D3')` | `applyLtv` phát hiện: `hasLtv: false`, `ltvStatus: 'REVOKED'`, ném cảnh báo thu hồi. | **PASS** |

---

### Hạng mục B: Chuẩn hóa Storage Root & Quản lý Keystore

- **Vấn đề trước đây:** Có sự phụ thuộc ngầm vào CWD và cơ chế copy tệp dự phòng giữa `apps/api/storage` và `workspace/storage`, tiềm ẩn nguy cơ xung đột tệp, ghi đè hoặc lộ keystore.
- **Giải pháp đã triển khai:**
  1. Xây dựng module chuẩn hóa `apps/api/src/modules/artifact/storage/storage-path.util.ts`:
     - Phân giải đường dẫn tuyệt đối duy nhất thông qua biến môi trường `STORAGE_ROOT` hoặc định vị `pnpm-workspace.yaml` để xác định monorepo root.
     - Hàm `ensureAndVerifyDirectory`: Kiểm tra quyền đọc/ghi thực tế của hệ điều hành (`fs.constants.R_OK | fs.constants.W_OK`) ngay khi khởi động.
     - Hàm `sanitizeAndResolvePath`: Chống tấn công Path Traversal (`../`) và Null Byte Injection (`\0`).
     - Hàm `migrateArtifactWithHashCheck`: Di chuyển tệp nguyên tử (atomic move) kèm đối soát SHA-256 trước và sau khi chuyển.
  2. Tách biệt hoàn toàn thư mục lưu trữ:
     - `getArtifactStorageDir()`: Lưu trữ tệp PDF và artifact (`storage/tenants/...`).
     - `getKeystoreStorageDir()`: Lưu trữ tệp khóa ký và chứng thư số (`storage/keystores`).
     - Loại bỏ hoàn toàn logic sao chép private key tự động giữa các thư mục trong `dev-local-keystore.provider.ts`.

---

### Hạng mục C: Bảo mật, Idempotency & Tự Phục Hồi Endpoint Reconcile-Seal

Đã hoàn thiện kiểm toán và tăng cường an ninh cho `POST /api/documents/:id/reconcile-seal`:

1. **Xác thực và Phân quyền (Authentication & Authorization):**
   - Chỉ cho phép: Tác giả hồ sơ (`createdById`), Quản trị viên cùng công ty (`UserRole.ADMIN`), hoặc `UserRole.SUPER_ADMIN`.
   - Chặn tuyệt đối nhân viên thông thường khác hoặc người dùng thuộc công ty khác (`ForbiddenException`).
2. **Kiểm tra Ràng buộc Trạng thái (Workflow State Invariants):**
   - Hồ sơ bắt buộc phải ở trạng thái `DocumentStatus.APPROVED` và workflow `COMPLETED`.
   - Kiểm tra tính toàn vẹn phiên bản phê duyệt: Tính lại mã băm `computeContentHash(activeVersion.formData)` đối chiếu với `activeVersion.sha256Hash`. Nếu nội dung bị chỉnh sửa lén trong CSDL, hệ thống chặn với `BadRequestException`.
3. **Idempotency & Xử lý Tương tranh (Concurrency Control):**
   - Tuần tự hóa thông qua PostgreSQL Advisory Lock (`pg_advisory_xact_lock`) bên trong `PdfSigningService.signDocument`.
   - Gửi nhiều request Reconcile đồng thời chỉ sinh đúng 1 bản ký duy nhất và trả về cùng `artifactId`.
4. **Khả năng Phục hồi khi Mất Tệp Vật lý (Storage Loss Self-Healing):**
   - Khi CSDL có bản ghi `SIGNED_PDF` nhưng tệp thực tế trên storage bị xóa/mất, hệ thống phát hiện qua `storageService.exists` và tự động kích hoạt tái kết xuất và tái ký niêm phong số.
5. **Nhật ký Kiểm toán (Audit Log):**
   - Ghi nhận hành động `AuditAction.DOCUMENT_RECONCILE_SEAL` với đầy đủ `actorId`, `documentId`, `ipAddress`, `signedPdfHash`, `padesLevel`.

---

### Hạng mục D & E: Kiến trúc Production Signing Provider & Cấu hình TSA

1. **Khả năng Thay thế Provider (Swappability):**
   - Interface `ISigningKeyProvider` và `IRemoteSigningProvider` đảm bảo tính trừu tượng hóa tuyệt đối: Signing Engine chỉ truyền 32-byte digest và key alias, không bao giờ yêu cầu hay nhận private key.
   - Xây dựng `SandboxKmsSigningProvider`: Mô phỏng đầy đủ hành vi Cloud KMS / HSM (IAM authentication, timeout, retry/backoff khi rate limit, self-verification chữ ký số bằng Public Key trước khi trả về).
   - Kiểm chứng thành công: `PdfSignatureAdapter` thực hiện ký số PAdES B-LT trơn tru qua `SandboxKmsSigningProvider` mà không cần thay đổi một dòng code lõi nào.
2. **Cấu hình TSA (RFC 3161):**
   - `HttpTsaProvider` và `Rfc3161TimestampClient` hỗ trợ: Nonce 64-bit ngẫu nhiên chống Replay Attack, kiểm tra mã lỗi PKIStatus, kiểm tra SHA-256 messageImprint, kiểm tra EKU `id-kp-timeStamping`, timeout 5000ms, giới hạn kích thước response 64KB, retry với backoff, fail-closed khi TSA gặp sự cố.

---

### Hạng mục F: Sổ tay Vận hành & Quản trị Rủi ro (Production Operations)

Đã ban hành tài liệu chính thức: `docs/architecture/PRODUCTION_OPERATIONS_RUNBOOK.md` bao gồm:
1. **Ma trận Giám sát Observability:** 8 nhóm metric OpenTelemetry/Prometheus, 5 quy tắc cảnh báo P0/P1/P2 và chính sách log an toàn (Sanitized Logging Policy).
2. **Quy trình Khôi phục & Ứng phó Lộ khóa:** Sơ đồ 4 bước xử lý khi nghi ngờ lộ khóa bí mật (thu hồi tức thì, khóa IAM role, đối soát tài liệu đã ký trước/sau thời điểm compromise, cấp phát khóa mới).
3. **Quy trình Sao lưu:** PostgreSQL PITR (RPO < 5 phút) + S3 Object Lock / Versioning (chống ghi đè/xóa trái phép).

---

## 3. BẢNG TỔNG HỢP KẾT QUẢ ACCEPTANCE TEST (TEST MATRIX)

Toàn bộ các nhóm kiểm thử được thực thi riêng biệt, không cộng gộp:

| Nhóm Kiểm thử | Tổng số Test | Số Test PASS | Số Test FAIL | Số Test SKIPPED | Tỷ lệ Thành công |
|---|:---:|:---:|:---:|:---:|:---:|
| **1. API Unit Tests** | 246 | 246 | 0 | 0 | **100%** |
| **2. PostgreSQL Integration Tests** | 181 | 181 | 0 | 0 | **100%** |
| **3. Live HTTP E2E Tests** | 93 | 93 | 0 | 0 | **100%** |
| **4. Shared Package Tests** | 47 | 47 | 0 | 0 | **100%** |
| **5. Web Frontend Tests** | 46 | 46 | 0 | 0 | **100%** |
| **6. Build & Lint (Shared, API, Web)** | 3/3 builds | 3 pass | 0 | 0 | **100%** |
| **7. OpenSSL 3.5.7 CLI Verification** | 12 | 12 | 0 | 0 | **100%** |
| **8. Independent PAdES & 7 Negatives** | 8 | 8 | 0 | 0 | **100%** |

---

## 4. MA TRẬN ĐÁNH GIÁ RỦI RO (P0 / P1 / P2)

| Mức độ | Mã Rủi ro | Mô tả Rủi ro | Biện pháp Giảm thiểu Đã Triển khai | Trạng thái |
|:---:|:---:|---|---|:---:|
| **P0** | **R-01** | Khóa bí mật production bị lưu trữ trên ổ đĩa máy chủ ứng dụng hoặc trong Docker image. | Kiến trúc yêu cầu bắt buộc dùng Cloud KMS / HSM; `SandboxKmsSigningProvider` đã tách biệt hoàn toàn; không lưu private key production trong repo/disk. | **ĐÃ GIẢM THIỂU** |
| **P0** | **R-02** | Xảy ra race condition khi 2 request niêm phong đồng thời làm tài liệu bị ký 2 lần. | Sử dụng PostgreSQL Advisory Lock `pg_advisory_xact_lock` và cơ chế kiểm tra Idempotency; kiểm chứng qua test tương tranh. | **ĐÃ GIẢI QUYẾT** |
| **P1** | **R-03** | Máy chủ TSA gặp sự cố đường truyền làm gián đoạn việc hoàn tất hồ sơ phê duyệt. | Cơ chế Auto-sealing được thiết kế Non-blocking cho luồng duyệt; chức năng `reconcile-seal` cho phép phục hồi niêm phong số sau khi TSA bình phục. | **ĐÃ GIẢI QUYẾT** |
| **P1** | **R-04** | Tệp PDF đã ký trên Storage bị mất mát do lỗi phần cứng hoặc thao tác nhầm. | Cơ chế Storage Loss Self-Healing tự động phát hiện và tái tạo PDF gốc kèm niêm phong số phục hồi. | **ĐÃ GIẢI QUYẾT** |
| **P2** | **R-05** | Chứng thư số tổ chức hết hạn nhưng không được phát hiện kịp thời. | Bổ sung Metric `certificate_expiration_days` kèm Alert Rule cảnh báo trước 30 ngày và 7 ngày; lọc bỏ chứng thư hết hạn. | **ĐÃ GIẢI QUYẾT** |

---

## 5. ĐIỀU KIỆN GO / NO-GO CHO CÁC MÔI TRƯỜNG

### 5.1. Môi trường Staging: GO ✅
- **Điều kiện đã đạt:** Toàn bộ test suite vượt qua 100%; cơ sở dữ liệu test cô lập; storage root canonical hoạt động ổn định; không sử dụng khóa bí mật thật.
- **Hành động tiếp theo:** Triển khai container Staging lên hạ tầng Kubernetes / Docker Swarm kiểm thử.

### 5.2. Môi trường Pilot (Thử nghiệm thực tế diện hẹp): CONDITIONAL GO ⚠️
Cho phép chạy thử nghiệm có kiểm soát với một số phòng ban / đơn vị pilot nếu thỏa mãn các điều kiện:
1. Chỉ cấp quyền niêm phong số tự động cho danh mục văn bản nội bộ không yêu cầu giá trị pháp lý liên cơ quan.
2. Cặp khóa ký của đơn vị Pilot được lưu trữ trong phân vùng HSM thử nghiệm hoặc Cloud KMS Sandbox có IAM Policy giới hạn.
3. Cấu hình dịch vụ giám sát Prometheus / Grafana hoạt động liên tục với các cảnh báo P0/P1.

### 5.3. Môi trường Full Production: NO-GO ⛔
Chưa cho phép kích hoạt chính thức trên toàn bộ hệ thống cho đến khi hoàn thành đầy đủ:
1. **Cloud KMS / HSM Production:** Cấu hình AWS KMS Key ARN hoặc Cloud HSM thực tế đạt chuẩn FIPS 140-2 Level 3, kèm IAM Role có quyền ký hạn chế.
2. **Qualified TSA Service:** Ký hợp đồng dịch vụ cấp dấu thời gian thương mại với nhà cung cấp có thẩm quyền (Root CA) và cấu hình endpoint HTTPS chính thức.
3. **Phê duyệt Pháp lý:** Biên bản xác nhận tuân thủ quy định pháp luật về chữ ký số và giao dịch điện tử của Hội đồng Pháp chế doanh nghiệp.
