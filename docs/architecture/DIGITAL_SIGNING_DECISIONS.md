# BẢN GHI QUYẾT ĐỊNH KIẾN TRÚC (ARCHITECTURAL DECISION RECORDS - ADR)
*Dự án: Trình Ký Online Nội Bộ Doanh Nghiệp / Tập Đoàn*  
*Giai đoạn: Phase 13.0 — Cryptographic Signing Decisions*  
*Trạng thái: APPROVED FOR PHASE 13 IMPLEMENTATION*

---

## MỤC LỤC CÁC QUYẾT ĐỊNH (ADR LIST)

- [ADR-01: Lựa chọn Định dạng Ký số PDF (PAdES CMS Detached Signature)](#adr-01-lựa-chọn-định-dạng-ký-số-pdf-pades-cms-detached-signature)
- [ADR-02: Lựa chọn Thư viện Xử lý PDF và Mật mã X.509/PKI](#adr-02-lựa-chọn-thư-viện-xử-lý-pdf-và-mật-mã-x509pki)
- [ADR-03: Kiến trúc Quản lý Khóa Riêng theo Mô hình Provider Adapter](#adr-03-kiến-trúc-quản-lý-khóa-riêng-theo-mô-hình-provider-adapter)
- [ADR-04: Thời điểm và Điều kiện Kích hoạt Ký số trong Workflow](#adr-04-thời-điểm-và-điều-kiện-kích-hoạt-ký-số-trong-workflow)
- [ADR-05: Chiến lược Lưu trữ Bất biến và Mô hình Ba Tầng Mã Băm (3-Tier Hash)](#adr-05-chiến-lược-lưu-trữ-bất-biến-và-mô-hình-ba-tầng-mã-băm-3-tier-hash)
- [ADR-06: Phương án Xác minh Độc lập Đa Nền tảng (Independent Verification)](#adr-06-phương-án-xác-minh-độc-lập-đa-nền-tảng-independent-verification)
- [ADR-07: Cơ chế Chống Ký Lặp và Xử lý Tương tranh (Concurrency & Idempotency)](#adr-07-cơ-chế-chống-ký-lặp-và-xử-lý-tương-tranh-concurrency--idempotency)

---

## ADR-01: LỰA CHỌN ĐỊNH DẠNG KÝ SỐ PDF (PADES CMS DETACHED SIGNATURE)

### Bối cảnh & Vấn đề
Hệ thống cần cung cấp chữ ký số có khả năng gắn kết trực tiếp vào văn bản xuất ra để người dùng có thể gửi tài liệu cho đối tác, khách hàng hoặc nộp cơ quan quản lý. Có 3 lựa chọn chính:
1. **PAdES (PDF Advanced Electronic Signatures - ETSI EN 319 142 / ISO 32000):** Chữ ký CMS/PKCS#7 nhúng trực tiếp vào cấu trúc nhị phân của tệp PDF tại trường `/Contents` và bảng `/ByteRange`.
2. **XMLDSig (XML Digital Signature):** Ký số trên dữ liệu XML (thường dùng trong Hóa đơn điện tử e-Invoice tại Việt Nam).
3. **JWS / JSON Web Signature:** Ký số trên JSON payload (RFC 7515).

### Quyết định
**CHỌN PAdES (ISO 32000-1/2 với CMS Detached Signature).**

### Lý do lựa chọn
1. **Tương thích toàn cầu**: Mọi trình đọc PDF chuẩn (Adobe Acrobat Reader, Foxit Reader, trình duyệt Edge/Chrome) đều tự động nhận diện và hiển thị thanh trạng thái chữ ký (Signature Panel) mà không cần cài đặt thêm phần mềm chuyên dụng.
2. **Bảo toàn hình thức văn bản**: Nội dung visual (chữ, bảng biểu, ảnh con dấu) và chữ ký mật mã nằm trong cùng một tệp `.pdf` duy nhất. Không bị tách rời như mô hình tệp đính kèm chữ ký riêng biệt (`.p7s` hoặc `.sig`).
3. **Hỗ trợ Incremental Updates**: Chuẩn PDF cho phép nhiều người ký nối tiếp nhau trên cùng một tài liệu mà không làm hỏng tính toàn vẹn của các chữ ký trước đó.

### Phương án bị loại trừ
- *XMLDSig*: Chỉ phù hợp cho dữ liệu cấu trúc máy đọc (máy tính trao đổi với máy tính như hóa đơn thuế XML); không phù hợp cho văn bản trình ký doanh nghiệp đa dạng (tờ trình, hợp đồng, quyết định nội bộ) cần người đọc trực quan.
- *JWS*: Không có chuẩn hiển thị trực quan văn bản và không được công nhận bởi các phần mềm đọc PDF tiêu chuẩn.

---

## ADR-02: LỰA CHỌN THƯ VIỆN XỬ LÝ PDF VÀ MẬT MÃ X.509/PKI

### Bối cảnh & Vấn đề
Môi trường backend là Node.js (NestJS / TypeScript). Việc tự viết bộ parser PDF hoặc tự giải mã ASN.1/DER/PKCS#7 từ đầu là cực kỳ nguy hiểm, dễ mắc lỗi bảo mật và vi phạm nguyên tắc *"Never roll your own crypto"*. Do đó, cần chọn lọc các thư viện mã nguồn mở uy tín, được kiểm chứng và duy trì tích cực.

### Đánh giá các ứng viên

| Thư viện | Vai trò | Điểm mạnh | Điểm yếu / Hạn chế | Đánh giá |
| :--- | :--- | :--- | :--- | :--- |
| **`pdf-lib`** | Xử lý cấu trúc PDF nhị phân | Thuần TypeScript/JS, cực nhẹ, an toàn bộ nhớ, không phụ thuộc native C++, hỗ trợ chỉnh sửa PDF và giữ incremental update. | Không có sẵn hàm ký mật mã CMS/PKCS#7. | **ĐƯỢC CHỌN** (Làm lõi thao tác PDF) |
| **`@node-signpdf/signpdf` & `@node-signpdf/placeholder-pdf-lib`** | Tạo placeholder và chèn chữ ký ByteRange | Chuyên biệt cho chuẩn PDF signature, tính ByteRange tự động, hỗ trợ cơ chế signer tách biệt. | Tài liệu hạn chế, cần kiểm thử kỹ với các file PDF nhiều trang. | **ĐƯỢC CHỌN** (Làm cầu nối ByteRange) |
| **`@peculiar/x509` & `@peculiar/asn1-cms`** | Xử lý Chứng thư X.509 và cấu trúc CMS | Viết bằng TypeScript hiện đại, tuân thủ nghiêm ngặt chuẩn RFC 5280 và RFC 5652, được tin cậy trong các dự án WebCrypto/PKI lớn. | Cần kiến thức chuẩn ASN.1 để tùy biến sâu. | **ĐƯỢC CHỌN** (Làm lõi X.509/CMS) |
| **`node-forge`** | Tiện ích mật mã tổng hợp | Rất phổ biến, hỗ trợ PKCS#12, PKCS#7, RSA, X.509 phong phú. | Kích thước bundle lớn, mã nguồn cũ theo phong cách JavaScript ES5, hiệu năng băm chậm hơn Native Node.js `crypto`. | **CHỌN HẠN CHẾ** (Chỉ dùng để parse file PKCS#12 `.p12` trong môi trường Dev) |
| **`puppeteer` / `playwright`** | Kết xuất HTML sang PDF | Render bố cục tiếng Việt và CSS hoàn hảo 100% giống giao diện web. | Tốn nhiều RAM và CPU, kích thước tệp tải lớn. | **ĐƯỢC CHỌN CHO BƯỚC RENDER** (Có cơ chế giới hạn concurrency pool) |

### Quyết định
- **Kết xuất PDF gốc**: Sử dụng Headless Chromium (Puppeteer) kết hợp template HTML đã vệ sinh an toàn.
- **Thao tác chèn ByteRange & Signature Container**: Sử dụng `pdf-lib` kết hợp `@node-signpdf/signpdf`.
- **Mật mã & Cấu trúc Chứng thư**: Sử dụng Native Node.js `crypto` (hiệu năng cao C++ OpenSSL) cho các phép băm SHA-256 và ký RSA/ECDSA, kết hợp `@peculiar/x509` cho việc quản lý cấu trúc ASN.1/X.509.

---

## ADR-03: KIẾN TRÚC QUẢN LÝ KHÓA RIÊNG THEO MÔ HÌNH PROVIDER ADAPTER

### Bối cảnh & Vấn đề
Trong môi trường phát triển (Local Development) và CI/CD tự động, nhóm phát triển không thể có sẵn thiết bị phần cứng HSM đắt đỏ hoặc tài khoản CA công cộng (VNPT SmartCA, Viettel-CA). Tuy nhiên, nếu viết code ký số gắn chặt (hardcode) với khóa lưu cục bộ, hệ thống sẽ không thể chuyển đổi sang môi trường Production của doanh nghiệp.

### Quyết định
**Áp dụng mẫu thiết kế Adapter Pattern với Interface trừu tượng `ISigningKeyProvider`.**

```typescript
export interface ISigningKeyProvider {
  /**
   * Ký số mật mã trên mã băm digest (SHA-256)
   */
  signDigest(
    certificateId: string,
    digest: Buffer,
    algorithm?: 'RSA-SHA256' | 'ECDSA-SHA256'
  ): Promise<Buffer>;

  /**
   * Lấy chuỗi chứng thư công khai X.509 (Leaf, Intermediate, Root)
   */
  getCertificateChain(certificateId: string): Promise<string[]>; // Mảng PEM strings

  /**
   * Kiểm tra tình trạng kết nối và sức khỏe của khóa
   */
  validateHealth(certificateId: string): Promise<boolean>;
}
```

### Các triển khai cụ thể:
1. **`DevLocalKeystoreProvider` (Hoàn thành trong Phase 13):**
   - Đọc các tệp PKCS#12 (`.p12` / `.pfx`) được tạo sẵn trong thư mục bảo mật `storage/keystores/dev/`.
   - Passphrase giải mã được cấp qua biến môi trường `DEV_SIGNING_PASSPHRASE`.
   - Khóa riêng được giải mã và lưu giữ an toàn trong bộ nhớ RAM của tiến trình, **tuyệt đối không ghi ra file tạm hay database**.
2. **`CloudKmsSigningProvider` (Sẵn sàng cho Private Cloud / AWS / Azure):**
   - Gửi `digest` lên dịch vụ AWS KMS / Azure Key Vault qua API `kms.sign()`.
   - Khóa riêng nằm vĩnh viễn trong module phần cứng HSM FIPS 140-2 Level 3 của nhà cung cấp điện toán đám mây.
3. **`RemoteCaSigningProvider` (Sẵn sàng cho Chữ ký số Công cộng Việt Nam):**
   - Kết nối với cổng API Remote Signing theo chuẩn CSC (Cloud Signature Consortium) của VNPT/Viettel/FPT.
   - Hỗ trợ luồng xác thực 2 bước (Push Notification / OTP về điện thoại người ký).

---

## ADR-04: THỜI ĐIỂM VÀ ĐIỀU KIỆN KÍCH HOẠT KÝ SỐ TRONG WORKFLOW

### Bối cảnh & Vấn đề
Một quy trình phê duyệt tài liệu trải qua nhiều bước: `DRAFT` $\rightarrow$ `SUBMITTED` $\rightarrow$ `IN_REVIEW` (Bước 1, Bước 2...) $\rightarrow$ `APPROVED` hoặc `REJECTED` / `REVISION_REQUESTED`. Cần quyết định khi nào tệp PDF được sinh ra và khi nào thực hiện ký số mật mã.

### Quyết định
Hệ thống hỗ trợ 2 chế độ cấu hình linh hoạt theo từng mẫu quy trình (`WorkflowTemplate`):

1. **Chế độ Mặc định: Ký số Niêm phong Hoàn tất (Final Archival Sealing)**
   - *Thời điểm*: Khi quy trình chuyển sang trạng thái `COMPLETED` (tài liệu đạt `APPROVED`).
   - *Hành vi*: Hệ thống tự động tổng hợp toàn bộ lịch sử phê duyệt, hình ảnh chữ ký của các cấp duyệt vào các khung định sẵn trên PDF, sau đó dùng **Con dấu số Tổ chức (Organization Digital Certificate)** hoặc Chữ ký số của Thẩm quyền Cao nhất để ký niêm phong tệp PDF.
   - *Ưu điểm*: Tối ưu tài nguyên hệ thống, tệp PDF chỉ cần ký một lần duy nhất, cấu trúc file đơn giản, tương thích tối đa với lưu trữ văn thư điện tử.

2. **Chế độ Nâng cao: Ký số Từng bước (Per-Step Incremental Signing)**
   - *Thời điểm*: Khi một Assignee có quyền ký duyệt bấm nút "Phê duyệt" tại bước được cấu hình `requiresCryptographicSignature: true`.
   - *Hành vi*: Hệ thống mở tệp PDF của phiên bản trước đó, áp dụng cơ chế **Incremental Update** để bổ sung chữ ký số mới của người vừa duyệt vào cuối tệp.
   - *Ràng buộc*: Nếu sau đó có một cấp duyệt khác yêu cầu sửa đổi (`REVISION_REQUESTED`), toàn bộ tệp PDF đã ký dở dang sẽ bị đóng dấu lưu trữ lịch sử kiểm toán (`ARCHIVED_REVISED`), và một chu trình mới bắt đầu lại từ `DocumentVersion` kế tiếp.

---

## ADR-05: CHIẾN LƯỢC LƯU TRỮ BẤT BIẾN VÀ MÔ HÌNH BA TẦNG MÃ BĂM (3-TIER HASH)

### Bối cảnh & Vấn đề
Một câu hỏi lớn trong kiểm toán bảo mật: *"Làm sao chứng minh được rằng tệp PDF đã ký lưu trong kho lưu trữ phản ánh trung thực dữ liệu form mà người dùng đã nhập và xem trên màn hình web?"*.

### Quyết định
**Thiết lập Chuỗi Toàn vẹn Ba Tầng Mã Băm (3-Tier Hash Model):**

1. **Tầng 1 - Dữ liệu Biểu mẫu (FormData JSON):**
   - Tính `DocumentVersion.sha256Hash = SHA256(canonicalizeJson(formData))`.
   - Lưu trữ bất biến trong PostgreSQL.
2. **Tầng 2 - Tệp PDF Gốc Chưa Ký (Unsigned PDF Binary):**
   - Sau khi kết xuất PDF từ template và formData, tính `rawPdfHash = SHA256(unsignedPdfBuffer)`.
   - Nhúng `DocumentVersion.sha256Hash` vào siêu dữ liệu (XMP Metadata) của PDF gốc.
3. **Tầng 3 - Tệp PDF Đã Ký (Signed PDF Binary Artifact):**
   - Sau khi chèn chữ ký CMS vào ByteRange, tính `signedPdfHash = SHA256(signedPdfBuffer)`.
   - Lưu tệp nhị phân vào Storage với đường dẫn định danh:
     `storage/tenants/{tenantId}/documents/{docId}/v{versionNumber}/signed_{signedPdfHash.slice(0, 16)}.pdf`
   - Bảng `document_signed_artifacts` ghi nhận cả 3 mã băm cùng liên kết quan hệ 1-1 với `DocumentVersion` và `SignatureEvent`.

---

## ADR-06: PHƯƠNG ÁN XÁC MINH ĐỘC LẬP ĐA NỀN TẢNG (INDEPENDENT VERIFICATION)

### Bối cảnh & Vấn đề
Nếu việc xác minh tính toàn vẹn của tệp PDF chỉ có thể thực hiện thông qua API của chính phần mềm Trình ký Online, hệ thống sẽ bị đặt dấu hỏi về tính khách quan (tự chấm điểm cho chính mình).

### Quyết định
**Tuân thủ 100% chuẩn kiểm tra độc lập:**
1. **Kiểm tra bằng Adobe Acrobat Reader / Foxit Reader (Thực tế người dùng):**
   - Khi người dùng tải file về và mở bằng Adobe Acrobat Reader, phần mềm sẽ hiển thị huy hiệu chữ ký màu xanh (Signature Valid), hiển thị đúng danh tính Subject DN của chứng thư và hiển thị thông báo: *"Document has not been modified since this signature was applied"*.
2. **Kiểm tra bằng Công cụ Dòng lệnh Chuẩn (OpenSSL / Python / PDF-Lib Verifier):**
   - Trích xuất ByteRange và kiểm tra hàm băm SHA-256 bằng OpenSSL:
     ```bash
     openssl cms -verify -inform DER -in signature.der -content signed_bytes.bin -noverify
     ```
3. **Cung cấp API Xác minh Server-side Không Cần Đăng nhập (Public Verification Portal):**
   - Cung cấp endpoint `POST /api/verify/pdf` cho phép người nhận bên ngoài tải tệp PDF lên để backend phân tích cú pháp ByteRange, trích xuất chứng thư số, và trả về báo cáo chi tiết về tính toàn vẹn nhị phân mà không cần tài khoản đăng nhập.

---

## ADR-07: CƠ CHẾ CHỐNG KÝ LẶP VÀ XỬ LÝ TƯƠNG TRANH (CONCURRENCY & IDEMPOTENCY)

### Bối cảnh & Vấn đề
Hai yêu cầu ký gửi lên cùng một lúc (người dùng double click, mạng giật gửi lại) có thể gây ra:
- Ký 2 lần trên cùng một tệp PDF, làm hỏng cấu trúc ByteRange.
- Tạo ra 2 bản ghi `SignatureEvent` trùng lặp trong cơ sở dữ liệu.

### Quyết định
1. **Khóa Transaction Cấp CSDL (PostgreSQL Advisory Lock):**
   - Trước khi bắt đầu tiến trình sinh PDF và ký, backend gọi lệnh:
     `SELECT pg_advisory_xact_lock(hashtext('doc_signing_' || documentId)::bigint);`
   - Lock này tự động giải phóng khi transaction kết thúc (commit hoặc rollback), bảo đảm chỉ có duy nhất 1 tiến trình ký được chạy trên 1 tài liệu tại một thời điểm.
2. **Khóa Lạc quan FSM (Optimistic Concurrency Control):**
   - Sử dụng trường `version` trong bảng `approval_steps` và `approval_workflows`. Chỉ bước nào đang ở `IN_PROGRESS` mới được thực hiện ký. Request thứ hai đến sẽ thấy bước đã chuyển sang `COMPLETED` và trả về ngay kết quả đã ký từ trước mà không thực hiện ký lại.
3. **Idempotency Key:**
---

## ADR-08: NGỮ NGHĨA KÝ SỐ VÀ KHÔNG XUẤT KHÓA RIÊNG (SIGNING INPUT SEMANTICS & NO PRIVATE KEY EXPORT)

### Bối cảnh & Vấn đề
Nhiều hệ thống ký số gặp lỗi khi tích hợp Remote HSM/KMS do API ký không phân định rõ đầu vào là dữ liệu thô, pre-computed digest hay ASN.1 DigestInfo, dẫn đến băm 2 lần (Double Hashing) hoặc định dạng chữ ký không tương thích với RFC 3447 (RSASSA-PKCS1-v1_5). Ngoài ra, nếu interface trả về private key object, rủi ro lộ khóa trên tầng ứng dụng là rất cao.

### Quyết định
1. **Tuyệt đối không export Private Key**: Interface `ISigningKeyProvider` không cung cấp bất kỳ hàm nào trả về `KeyObject`, `Buffer` hay chuỗi PEM của khóa riêng.
2. **Chuẩn hóa Ngữ nghĩa Đầu vào (Input Semantics)**:
   - `signData(keyAlias, rawData)`: Nhận dữ liệu thô bất kỳ $\rightarrow$ Băm SHA-256 $\rightarrow$ Ký RSASSA-PKCS1-v1_5.
   - `signDigest(keyAlias, digest32Bytes)`: Nhận đúng 32-byte SHA-256 hash $\rightarrow$ Bọc ASN.1 `DigestInfo` tiền tố SHA-256 (`3031300d060960864801650304020105000420`) $\rightarrow$ Mã hóa khóa riêng với `RSA_PKCS1_PADDING`.
   - Cả hai phương thức tạo ra chữ ký có cùng định dạng, tương thích 100% với `crypto.verify('sha256', ...)`.
3. **Sẵn sàng cho Remote KMS/HSM**: Khi chuyển sang AWS KMS hoặc Google Cloud KMS, phương thức `signDigest` chỉ cần chuyển tiếp 32 byte băm lên KMS API với tham số `MessageType: 'DIGEST'` và `SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256'`, không cần tải tệp PDF dung lượng lớn lên cloud.

---

## ADR-09: QUẢN LÝ DANH MỤC CHỨNG THƯ X.509 VÀ PHÂN QUYỀN SỞ HỮU

### Bối cảnh & Vấn đề
Nếu không có bảng quản lý chứng thư tập trung, hệ thống khó theo dõi trạng thái thu hồi, phân định giữa chứng thư cá nhân và chứng thư đại diện tổ chức, hoặc dễ bị lỗ hổng khi client tự gửi keyAlias hoặc cert ID của tổ chức khác.

### Quyết định
1. **Mô hình Dữ liệu `DigitalCertificate`**:
   - Lưu trữ fingerprint SHA-256 (unique), serial number, subject/issuer DN, validFrom, validTo, status (`ACTIVE`, `REVOKED`, `EXPIRED`), keyStorageType, keyAlias, và certificatePem công khai.
   - Không lưu khóa riêng hay mật khẩu keystore trong bảng này.
2. **Phân quyền và Ranh giới Sở hữu**:
   - Chỉ `ADMIN` và `SUPER_ADMIN` mới được phép đăng ký (`POST /api/certificates`) hoặc thu hồi (`PATCH /api/certificates/:id/status`).
   - `USER` chỉ được xem và ký thử nghiệm trên chứng thư cá nhân gán cho chính mình (`userId === currentUser.id`).
   - Cấm hoàn toàn việc thay đổi `organizationId` hoặc `userId` sau khi chứng thư đã tạo.

---

---

## ADR-10: CẤU TRÚC CMS DETACHED VÀ PHÂN BỔ /BYTERANGE CHO CHỮ KÝ SỐ PDF (PHASE 13.2.2)

### Bối cảnh & Vấn đề
Để nhúng chữ ký số vào tệp PDF theo tiêu chuẩn ISO 32000-1 và RFC 5652 mà không làm sai lệch mã băm của chính tệp PDF:
1. Chữ ký mật mã không thể ký trên toàn bộ tệp PDF (vì tệp PDF phải chứa chính chuỗi chữ ký đó $\rightarrow$ nghịch lý tự tham chiếu).
2. Chuẩn PDF giải quyết nghịch lý này bằng mảng `/ByteRange [offset1, len1, offset2, len2]` loại trừ chính xác vùng chứa chữ ký `/Contents <hex>`.
3. Chữ ký CMS phải ở chế độ Detached (tức là không chứa nội dung byte PDF bên trong `eContent`), nhưng trong thuộc tính ký `SignedAttributes` bắt buộc phải có `messageDigest` bằng đúng giá trị SHA-256 của các byte trong `/ByteRange`.
4. Nếu kích thước chuỗi DER của CMS vượt quá dung lượng byte đệm đã cấp phát trong `/Contents`, việc ghi đè sẽ làm dịch chuyển vị trí các object phía sau và làm hỏng toàn bộ cấu trúc xref của PDF.

### Quyết định
1. **Dựng CMS Detached bằng `node-forge` ASN.1 DER**:
   - `ContentInfo` type `signedData`, `encapContentInfo` type `id-data` với `eContent` omitted (detached mode).
   - Thuộc tính ký (`SignedAttributes`) chứa `contentType` (`id-data`), `signingTime` (UTC Time), và `messageDigest` (32 bytes SHA-256 của ByteRange).
   - Sắp xếp từ điển (Lexicographical order) các thuộc tính ký theo quy tắc DER trước khi mã hóa thành ASN.1 SET (0x31).
   - Chuyển 32-byte digest của SignedAttributes cho `ISigningKeyProvider.signDigest`. Private key không bao giờ rời khỏi provider.
2. **Cấp phát ByteRange & Vùng đệm chữ ký với `pdf-lib`**:
   - Signature Dictionary được bổ sung vào PDF: `/Type /Sig`, `/Filter /Adobe.PPKLite`, `/SubFilter /adbe.pkcs7.detached`.
   - Cấp phát vùng đệm `/Contents` dạng hex với kích thước an toàn 8192 bytes (16384 ký tự hex).
   - Quét vị trí byte nhị phân của `/Contents <` và `>` để xác định chính xác `offset1`, `len1`, `offset2`, `len2`.
   - **Chống tràn vùng đệm (Placeholder Overflow Protection)**: Kiểm tra nghiêm ngặt `cmsDer.length <= placeholderByteLength`. Nếu CMS vượt quá dung lượng, hệ thống lập tức ném ngoại lệ fail-safe thay vì ghi đè làm hỏng PDF.
3. **Quy trình Xác minh Fail-Closed (Self-Verification)**:
   - Trước khi lưu tệp PDF đã ký vào Storage và trước khi commit transaction CSDL, `PdfSigningService` bắt buộc gọi `PdfSignatureVerifier.verify(signedPdfBuffer)`.
   - Verifier tính lại `computedDigest` trên đúng 2 đoạn byte trong `/ByteRange`, trích xuất `messageDigest` từ CMS, và đối soát chữ ký RSA bằng khóa công khai X.509 trích xuất từ chính CMS.
   - Nếu bất kỳ bước kiểm tra nào thất bại, tệp bị hủy ngay lập tức và ném lỗi nghiệp vụ. Không bao giờ lưu tệp ký hỏng vào hệ thống.
4. **Đối soát độc lập với OpenSSL**:
   - Chữ ký CMS Detached được kiểm chứng độc lập bằng lệnh `openssl cms -verify -inform DER -in sig.der -content content.bin -CAfile cert.pem -binary` đạt kết quả `CMS Verification successful` 100%.

---

## BẢNG TỔNG HỢP CÁC QUYẾT ĐỊNH

| Mã ADR | Chủ đề | Lựa chọn chính | Trạng thái |
| :--- | :--- | :--- | :--- |
| **ADR-01** | Định dạng chữ ký | PAdES ISO 32000 CMS Detached Signature | **APPROVED** |
| **ADR-02** | Thư viện mật mã | `pdf-lib` + `node-forge` ASN.1 DER + Native Node.js `crypto` + `ISigningKeyProvider` | **APPROVED** |
| **ADR-03** | Quản lý khóa | `ISigningKeyProvider` (Dev Keystore $\rightarrow$ Cloud KMS $\rightarrow$ Remote SmartCA) | **APPROVED** |
| **ADR-04** | Điểm kích hoạt ký | Final Archival Sealing (Default) & Per-Step Incremental Signing (Configurable) | **APPROVED** |
| **ADR-05** | Lưu trữ & Toàn vẹn | Chuỗi 3-Tier Hash (`formData` $\rightarrow$ `rawPdf` $\rightarrow$ `signedPdf`) | **APPROVED** |
| **ADR-06** | Xác minh độc lập | Tương thích Adobe Acrobat Reader + Independent CLI + Public Verify API | **APPROVED** |
| **ADR-07** | Chống ký lặp | Advisory Locks + OCC + Idempotency Keys | **APPROVED** |
| **ADR-08** | Ngữ nghĩa Ký số | Không export Private Key, chuẩn hóa `signData` vs `signDigest` | **APPROVED** |
| **ADR-09** | Danh mục Chứng thư | Phân quyền Tenant/User, bất biến quyền sở hữu, kiểm soát thu hồi | **APPROVED** |
| **ADR-10** | CMS/ByteRange Engine| CMS Detached, cấp phát ByteRange, chống tràn placeholder, Fail-closed self-verify | **APPROVED** |
