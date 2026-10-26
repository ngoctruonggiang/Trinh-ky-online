# SỔ TAY VẬN HÀNH VÀ ỨNG PHÓ SỰ CỐ PRODUCTION (PRODUCTION OPERATIONS RUNBOOK)

> **Hệ thống:** Nền tảng Trình Ký Online — Module Chữ ký số PAdES B-LT & Workflow Auto-Sealing  
> **Phiên bản tài liệu:** 1.0 (Phase 13.4.2 Readiness)  
> **Chủ quản:** DevSecOps, SRE & Digital Signature Engineering  
> **Phân loại bảo mật:** NỘI BỘ (INTERNAL ONLY) — Tuyệt đối không lưu trữ bí mật trong tài liệu

---

## 1. GIÁM SÁT VÀ QUAN SÁT HỆ THỐNG (OBSERVABILITY & ALERTING)

### 1.1. Ma trận Chỉ số Vận hành (Metrics Matrix)

Tất cả chỉ số được thu thập theo chuẩn OpenTelemetry / Prometheus exporter tại endpoint `/metrics` (được bảo vệ nội bộ, không public):

| Tên Metric | Kiểu Metric | Nhãn (Labels) | Ý nghĩa Vận hành |
|---|---|---|---|
| `signing_requests_total` | Counter | `status="success\|failure"`, `type="seal\|user"`, `tenant_id` | Đếm tổng số lượt ký số; phát hiện bất thường tỷ lệ lỗi. |
| `signing_duration_seconds` | Histogram | `algorithm`, `has_tsa="true\|false"`, `has_ltv="true\|false"` | Đo lường độ trễ toàn trình của thao tác ký PDF và đóng dấu. |
| `tsa_requests_total` | Counter | `status="success\|timeout\|failure"`, `endpoint` | Giám sát tính sẵn sàng của máy chủ đóng dấu thời gian RFC 3161. |
| `tsa_duration_seconds` | Histogram | `endpoint` | Thời gian phản hồi của TSA (cảnh báo SLA nếu vượt 3000ms). |
| `kms_requests_total` | Counter | `provider="AWS_KMS\|GCP_KMS"`, `status="success\|throttled\|error"` | Tỷ lệ gọi Cloud KMS / HSM và lỗi phân quyền IAM. |
| `reconcile_operations_total` | Counter | `status="success\|idempotent_skip\|failure"`, `reason` | Giám sát tiến trình tự phục hồi và đối soát niêm phong số. |
| `storage_inconsistency_total` | Counter | `type="missing_physical_file\|hash_mismatch"` | **Chỉ số P0**: Cảnh báo ngay lập tức nếu tệp storage bị mất hoặc sai lệch băm. |
| `certificate_expiration_days` | Gauge | `alias`, `issuer`, `tenant_id`, `role="seal\|user"` | Số ngày còn lại trước khi chứng thư số X.509 hết hạn. |

### 1.2. Quy tắc Cảnh báo (Alerting Rules)

```yaml
groups:
  - name: digital_signing_alerts
    rules:
      - alert: SigningFailureRateHigh
        expr: rate(signing_requests_total{status="failure"}[5m]) / rate(signing_requests_total[5m]) > 0.02
        for: 2m
        labels:
          severity: P1
        annotations:
          summary: "Tỷ lệ ký số thất bại vượt quá 2% trong 5 phút"
          description: "Tenant {{ $labels.tenant_id }} đang gặp lỗi ký số bất thường."

      - alert: TsaEndpointDownOrTimingOut
        expr: rate(tsa_requests_total{status=~"timeout|failure"}[5m]) > 3
        for: 1m
        labels:
          severity: P1
        annotations:
          summary: "Máy chủ RFC 3161 TSA không phản hồi hoặc timeout"
          description: "TSA {{ $labels.endpoint }} đang làm gián đoạn luồng ký PAdES B-T/B-LT."

      - alert: StoragePhysicalFileNotFound
        expr: increase(storage_inconsistency_total{type="missing_physical_file"}[5m]) > 0
        for: 0m
        labels:
          severity: P0
        annotations:
          summary: "Phát hiện bản ghi CSDL mất tệp vật lý tương ứng trên Storage"
          description: "Mất mát dữ liệu tệp artifact. Hệ thống đã kích hoạt auto-recovery tái ký."

      - alert: CertificateExpiringSoon
        expr: certificate_expiration_days < 30
        for: 1h
        labels:
          severity: P2
        annotations:
          summary: "Chứng thư số sắp hết hạn trong vòng dưới 30 ngày"
          description: "Khóa {{ $labels.alias }} thuộc đơn vị {{ $labels.tenant_id }} cần xoay vòng chứng thư."

      - alert: CertificateExpiringCritical
        expr: certificate_expiration_days < 7
        for: 15m
        labels:
          severity: P0
        annotations:
          summary: "Chứng thư số sắp hết hạn trong vòng dưới 7 ngày"
          description: "Cần cập nhật chứng thư số mới khẩn cấp để tránh gián đoạn dịch vụ."
```

### 1.3. Chính sách Nhật ký An toàn (Sanitized Logging Policy)

> [!CAUTION]
> **Tuyệt đối cấm** ghi nhận các trường dữ liệu sau vào application log (kể cả ở mức DEBUG/TRACE):
> 1. Private Key (PEM, DER, ASN.1).
> 2. Passphrase / Mật khẩu giải mã PKCS#12 Keystore.
> 3. Cloud KMS IAM Secret Key, Session Token, Bearer Token.
> 4. Toàn bộ nội dung form data nhạy cảm của tài liệu người dùng.
> 
> **Được phép ghi log**: Key Alias, Serial Number hex, Issuer DN, Fingerprint SHA-256, Artifact ID, Document ID, Latency ms, Trạng thái HTTP status code.

---

## 2. QUY TRÌNH PHỤC HỒI DỮ LIỆU VÀ XỬ LÝ SỰ CỐ (DISASTER RECOVERY)

### 2.1. Tự Động Phục Hồi Tệp Storage Bị Mất (Missing Physical File Recovery)

Khi bản ghi CSDL ghi nhận `ArtifactStatus.COMPLETED` nhưng tệp vật lý bị mất trên Storage:
1. `PdfSigningService.autoSealApprovedDocument` tự động kiểm tra `storageService.exists(existingArtifact.storageKey)`.
2. Nếu tệp không tồn tại, hệ thống ghi nhận cảnh báo `WARN`, kích hoạt tự động:
   - Tái kết xuất tệp PDF gốc từ dữ liệu phiên bản phê duyệt (`OFFICIAL_UNSIGNED`).
   - Kiểm tra mã băm formData toàn vẹn.
   - Thực hiện ký số và đóng dấu lại (`PAdES Baseline B-LT`).
   - Lưu trữ tệp mới và cập nhật bản ghi DocumentArtifact.
3. Người quản trị có thể kích hoạt thủ công đối soát hàng loạt qua endpoint:
   `POST /api/documents/:id/reconcile-seal` (Yêu cầu quyền Document Creator, Company Admin hoặc Super Admin).

### 2.2. Dọn dẹp Tệp Artifact Mồ côi (Orphaned Artifacts Cleanup)

Chạy tác vụ định kỳ (Cronjob lúc 02:00 AM hàng ngày):
```bash
# Đối soát danh sách tệp trong storage root với bảng document_artifacts
pnpm --filter @trinh-ky/api tsx scripts/reconcile-orphaned-storage.ts --dry-run
```
- Tệp trong storage không có liên kết CSDL quá 48 giờ sẽ được di chuyển sang thư mục `storage/quarantine/` kèm bảng log SHA-256 đối soát.
- Sau 30 ngày trong `quarantine`, tệp mới được xóa vĩnh viễn theo chính sách lưu trữ.

### 2.3. Quy trình Ứng phó Lộ Khóa Bí mật hoặc Thu hồi Chứng thư (Key Compromise & Revocation)

Khi phát hiện hoặc nghi ngờ khóa ký bị lộ hoặc CA phát hành thông báo thu hồi:

```mermaid
flowchart TD
    A["Phát hiện nghi ngờ lộ khóa bí mật"] --> B["BƯỚC 1: Vô hiệu hóa khẩn cấp trong CSDL"]
    B --> C["Cập nhật DigitalCertificate status=REVOKED"]
    C --> D["BƯỚC 2: Khóa quyền truy cập Provider"]
    D --> E["AWS/GCP KMS: Disable Key / Revoke IAM Role"]
    D --> F["Keystore: Xóa cache RAM & di chuyển tệp khóa vào quarantine"]
    C --> G["BƯỚC 3: Đối soát hồ sơ đã ký"]
    G --> H["Lọc tài liệu ký TRƯỚC thời điểm Compromise -> Hợp lệ nhờ RFC 3161 TSA & LTV"]
    G --> I["Lọc tài liệu ký SAU thời điểm Compromise -> Đánh dấu INVALID, lập biên bản hủy"]
    G --> J["BƯỚC 4: Cấp phát cặp khóa và chứng thư số mới"]
    J --> K["Cập nhật cấu hình và kích hoạt lại dịch vụ niêm phong"]
```

**Lệnh khẩn cấp vô hiệu hóa khóa trong CSDL:**
```sql
UPDATE digital_certificates 
SET status = 'REVOKED', updated_at = NOW() 
WHERE key_alias = 'TARGET_KEY_ALIAS' AND status = 'ACTIVE';
```

---

## 3. QUY TRÌNH TRIỂN KHAI VÀ QUẢN TRỊ BẢO MẬT (DEPLOYMENT & SECRETS)

### 3.1. Phân Biệt Môi Trường (Environment Matrix)

| Tiêu chí | Staging | Pilot (Thử nghiệm diện hẹp) | Full Production |
|---|---|---|---|
| **Cơ sở dữ liệu** | PostgreSQL Dedicated Staging | PostgreSQL Managed (RDS/Cloud SQL) | PostgreSQL HA Multi-AZ + Read Replica |
| **Storage Root** | Local Disk / MinIO S3 Staging | AWS S3 / GCS (Private Bucket + KMS) | AWS S3 / GCS Multi-Region + Object Lock |
| **Signing Key Provider** | `SandboxKmsSigningProvider` hoặc `DevLocalKeystore` | Cloud KMS / HSM Dedicated Sandbox Key | Hardware Security Module (FIPS 140-2 Level 3) / Commercial Cloud KMS |
| **TSA Authority** | DevTestTsa nội bộ / Free RFC 3161 | Free RFC 3161 thương mại hoặc Sandbox TSA | Nhà cung cấp Dịch vụ Cấp dấu thời gian công cộng có thẩm quyền (Root CA) |
| **Revocation Source** | Mock Dev OCSP Provider | Commercial CA OCSP / CRL | Real-time OCSP Responder + CRL Distribution Points |
| **Keystore Filesystem** | Cách ly trong thư mục `storage/keystores` | Không lưu private key trên disk | Tuyệt đối không lưu private key trên host |

### 3.2. Cấu hình Môi trường Production (.env)

```env
# Server
NODE_ENV=production
PORT=4000
API_BASE_URL=https://api.trinhky.example.com

# Database
DATABASE_URL=postgresql://app_user:SECURE_PASSWORD@postgres.internal:5432/trinh_ky_prod?sslmode=verify-full&sslrootcert=/etc/ssl/certs/rds-ca.pem

# Storage Root (Đường dẫn tuyệt đối canonical, không phụ thuộc CWD)
STORAGE_ROOT=/var/lib/trinhky/storage

# Signing Provider (AWS KMS / HSM)
SIGNING_PROVIDER_TYPE=AWS_KMS
AWS_REGION=ap-southeast-1
AWS_KMS_SIGNING_ROLE_ARN=arn:aws:iam::123456789012:role/TrinhKyProductionSigningRole

# RFC 3161 Timestamp Authority (TSA)
TSA_PROVIDER_TYPE=HTTP
TSA_SERVER_URL=https://tsa.vnpt.vn/tsa
TSA_TIMEOUT_MS=5000
TSA_MAX_RETRIES=2
TSA_POLICY_OID=1.3.6.1.4.1.61498.1.1

# Revocation & LTV
REVOCATION_PREFERRED_SOURCE=OCSP
REVOCATION_TIMEOUT_MS=4000
REVOCATION_MAX_CACHE_HOURS=24
```

### 3.3. Kiểm tra Tính Sẵn Sàng Khởi Động (Readiness & Health Checks)

Endpoint kiểm tra sức khỏe hệ thống:
- `GET /api/health`: Liveness Probe (xác nhận tiến trình Node.js đang chạy).
- `GET /api/health/ready`: Readiness Probe (kiểm tra toàn diện 4 dịch vụ phụ thuộc):
  1. Kết nối CSDL PostgreSQL (`SELECT 1`).
  2. Quyền ghi và đọc trên đường dẫn lưu trữ canonical `STORAGE_ROOT`.
  3. Tính sẵn sàng của Signing Provider (`ISigningKeyProvider.isAvailable`).
  4. Khả năng kết nối mạng tới máy chủ TSA (`ITimestampAuthorityProvider.isAvailable`).

---

## 4. KẾ HOẠCH SAO LƯU VÀ PHỤC HỒI (BACKUP & RESTORE)

### 4.1. Chính sách Sao lưu
- **CSDL PostgreSQL**:
  - Full backup snapshot: 01:00 AM mỗi ngày, lưu giữ 30 ngày.
  - WAL Archiving (Write-Ahead Logging): Liên tục mỗi 5 phút lên bucket S3 bảo mật phục vụ Point-In-Time-Recovery (RPO < 5 phút).
- **Storage Artifacts (PDF & Chữ ký số)**:
  - Bật tính năng **S3 Versioning** và **S3 Object Lock (Compliance Mode)** trên bucket lưu trữ tài liệu đã ký để chống xóa hoặc ghi đè trái phép.
  - Cross-Region Replication (CRR) sang region dự phòng.

### 4.2. Diễn tập Phục hồi (Restore Drill)
- Đội ngũ DevSecOps thực hiện diễn tập khôi phục hệ thống từ bản sao lưu định kỳ mỗi quý 1 lần trên môi trường cô lập để đảm bảo RTO < 30 phút và RPO < 5 phút.
