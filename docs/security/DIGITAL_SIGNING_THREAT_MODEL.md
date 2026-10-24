# THREAT MODEL & TRUST BOUNDARIES: HỆ THỐNG KÝ SỐ MẬT MÃ PDF
*Dự án: Trình Ký Online Nội Bộ Doanh Nghiệp / Tập Đoàn*  
*Giai đoạn: Phase 13.0 — Security Engineering & Threat Analysis*  
*Tiêu chuẩn tham chiếu: STRIDE, OWASP Top 10 API Security, ISO/IEC 27001, ETSI PAdES Security Guidelines*

---

## 1. MỤC TIÊU & RANH GIỚI TIN CẬY (TRUST BOUNDARIES)

Mô hình đe dọa này phân tích toàn bộ các bề mặt tấn công tiềm tàng đối với chức năng tạo, ký số, lưu trữ và xác minh tệp PDF có thể xác minh độc lập.

```mermaid
flowchart TB
    subgraph UntrustedZone [Vùng Không Tin Cậy - Internet / Client Browser]
        ClientBrowser[Trình duyệt Người dùng / Web Client]
        Attacker[Kẻ tấn công / Man-in-the-Middle]
    end

    subgraph DMZ_Boundary [Ranh giới DMZ / API Gateway / Reverse Proxy]
        TLS_Terminator[TLS Termination & WAF]
    end

    subgraph TrustBoundary1 [Ranh giới Ứng dụng Backend NestJS]
        AuthGuard[JWT Auth & Tenant Isolation Guard]
        SignController[Signing & Verification Controllers]
        WorkflowEngine[Workflow Orchestrator & FSM]
        CryptoEngine[PDF Signing & ByteRange Engine]
    end

    subgraph TrustBoundary2 [Ranh giới Khóa Mật Mã & Ký số]
        KeyStore[ISigningKeyProvider<br/>Dev Keystore / Cloud KMS / Remote CA]
    end

    subgraph TrustBoundary3 [Ranh giới Dữ liệu Bền vững]
        PostgreSQL[(PostgreSQL Database<br/>Tenant Schema, OCC, Advisory Locks)]
        ArtifactStorage[(Artifact Storage<br/>Encrypted Local Disk / S3 Object Store)]
    end

    subgraph ExternalServices [Dịch vụ Ngoài Độc lập]
        TSA[RFC 3161 Timestamp Authority Server]
        OCSP_CRL[CA OCSP / CRL Revocation Service]
    end

    ClientBrowser -->|HTTPS / Bearer JWT| TLS_Terminator
    Attacker -.->|Dò quét / Replay / Tamper| TLS_Terminator
    TLS_Terminator --> AuthGuard
    AuthGuard --> SignController
    SignController --> WorkflowEngine
    SignController --> CryptoEngine
    CryptoEngine -->|Yêu cầu băm & ký| KeyStore
    CryptoEngine -->|Gửi hash lấy dấu thời gian| TSA
    CryptoEngine -->|Lưu Signed PDF Artifact| ArtifactStorage
    SignController -->|Lưu Metadata, AuditLog| PostgreSQL
    CryptoEngine -.->|Kiểm tra chứng thư| OCSP_CRL
```

### 1.1. Bảng phân định Ranh giới Tin cậy

| Ranh giới | Thành phần bên trong | Thành phần bên ngoài | Giao thức / Kiểm soát bảo mật |
| :--- | :--- | :--- | :--- |
| **Boundary 1: Client $\rightarrow$ API** | `apps/api` (NestJS Controllers) | Trình duyệt Web, Mobile, API Consumer bên ngoài | Bắt buộc HTTPS TLS 1.3, Bearer JWT có thời hạn, Rate Limiting, Input Validation (Zod/class-validator). |
| **Boundary 2: Backend $\rightarrow$ Key Provider** | `ISigningKeyProvider` (Module Mật mã) | Ứng dụng chính NestJS | Khóa riêng không bao giờ rời khỏi Key Provider. Giao tiếp qua RAM hoặc RPC/mTLS có xác thực. |
| **Boundary 3: Backend $\rightarrow$ Persistence** | PostgreSQL, File/S3 Storage | Backend Services | PostgreSQL qua Private Network / Connection Pool xác thực mật khẩu mạnh; Storage qua IAM Role / Scoped API Keys. |
| **Boundary 4: Backend $\rightarrow$ External PKI** | TSA, OCSP/CRL Responders | Máy chủ CA công cộng / Quốc gia | Giao thức HTTP/HTTPS với cơ chế Timeout, Fallback và Circuit Breaker. |

---

## 2. DANH MỤC TÀI SẢN BẢO VỆ (ASSET INVENTORY)

| Mã | Tài sản | Định dạng / Vị trí | Mức độ nhạy cảm (C-I-A) | Hậu quả nếu bị xâm hại |
| :--- | :--- | :--- | :--- | :--- |
| **AST-01** | **Khóa riêng ký số (Private Key)** | File PKCS#12 mã hóa / Cloud KMS / HSM | **C: Tối Mật**<br/>I: Cực Cao<br/>A: Cao | Kẻ tấn công có thể giả mạo chữ ký số của tổ chức/cá nhân trên mọi tài liệu pháp lý. |
| **AST-02** | **Tệp PDF đã ký (Signed PDF Artifact)** | Nhị phân PDF lưu trong File Storage / S3 | C: Cao (Bảo mật nội bộ)<br/>**I: Tối Mật (Bất biến)**<br/>A: Cao | Văn bản bị giả mạo nội dung (sửa tiền, sửa điều khoản hợp đồng), làm sai lệch bằng chứng pháp lý. |
| **AST-03** | **Chứng thư số X.509** | X.509 ASN.1 / PEM / Database | C: Công khai<br/>**I: Rất Cao**<br/>A: Cao | Giả mạo danh tính người ký nếu chứng thư giả mạo được nhúng thành công. |
| **AST-04** | **Lịch sử Quyết định & Audit Trail** | Bảng `StepDecisionHistory`, `AuditLog` | C: Nội bộ<br/>**I: Tối Mật (Append-only)**<br/>A: Cao | Xóa vết hành vi phạm pháp, đổ vấy trách nhiệm cho người khác. |
| **AST-05** | **Chính sách Ủy quyền (Delegation Policy)** | Bảng `delegation_policies` | C: Nội bộ<br/>**I: Tối Mật**<br/>A: Cao | Chiếm đoạt quyền phê duyệt và quyền ký của lãnh đạo. |
| **AST-06** | **Dữ liệu Form & Snapshot (FormData JSON)** | Bảng `document_versions` | C: Cao<br/>**I: Tối Mật**<br/>A: Cao | Sai lệch giữa dữ liệu lưu trên giao diện web và dữ liệu trên bản in PDF. |

---

## 3. CHÂN DUNG TÁC NHÂN TẤN CÔNG (THREAT ACTOR PROFILES)

1. **Attacker Ngoài (External Anonymous Attacker):** Tin tặc trên Internet không có tài khoản, cố gắng khai thác lỗ hổng parser PDF, brute-force API, giả mạo token, hoặc nghe lén mạng.
2. **Người dùng Độc hại trong Tổ chức (Malicious Insider - Employee):** Người dùng có tài khoản hợp lệ của Công ty A, cố gắng truy cập hoặc ký hồ sơ của Công ty B (Cross-tenant attack), hoặc sửa đổi nội dung PDF sau khi sếp đã bấm duyệt.
3. **Người duyệt muốn Chối bỏ Trách nhiệm (Repudiating Approver):** Người đã thực hiện ký duyệt nhưng sau đó khi xảy ra sự cố muốn tuyên bố: *"Tôi không ký tài liệu này, hệ thống bị lỗi hoặc bị giả mạo"*.
4. **Quản trị viên Lạm quyền (Rogue Administrator):** Nhân sự IT có quyền `ADMIN` hoặc `SUPER_ADMIN`, cố gắng sửa trực tiếp database hoặc tệp tin trên disk để hợp thức hóa hồ sơ sai trái.
5. **Kẻ Tấn công Chuỗi Cung ứng (Supply Chain / Infrastructure Attacker):** Lỗ hổng trong các thư viện xử lý PDF của bên thứ ba, lỗ hổng container Docker hoặc cấu hình sai quyền storage bucket.

---

## 4. MA TRẬN ĐÁNH GIÁ ĐE DỌA CHI TIẾT (COMPREHENSIVE THREAT MATRIX)

Dưới đây là ma trận phân tích chuyên sâu cho các kịch bản đe dọa bắt buộc theo yêu cầu kiến trúc:

| ID | Tài sản mục tiêu | Kịch bản tấn công (Attack Scenario) | Tác động (Impact) | Biện pháp phòng vệ (Countermeasures) | Kiểm thử bắt buộc (Required Tests) | Rủi ro còn lại & Giả định (Residual Risk & Assumptions) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **THR-01** | **Signed PDF Artifact (AST-02)** | **Sửa tệp PDF sau khi ký:**<br/>Kẻ tấn công sửa trực tiếp nội dung văn bản (đổi số tiền từ 10 triệu thành 100 triệu) bằng công cụ chỉnh sửa PDF hoặc binary editor. | **Thảm họa:** Thất thoát tài chính, vô hiệu giá trị pháp lý của tài liệu. | **1.** Chữ ký số CMS bao phủ ByteRange từ byte 0 đến EOF.<br/>**2.** Nếu sửa 1 byte duy nhất trong phạm vi được ký, hash tính toán không khớp với hash giải mã từ chữ ký số.<br/>**3.** Mọi trình đọc PDF (Adobe Reader, verifier API) phát hiện và cảnh báo ngay lập tức. | Sửa ngẫu nhiên 1 byte trong vùng ByteRange và kiểm tra xem `pdf-verifier` cùng Adobe Acrobat có báo lỗi "Signature Invalid / Document Tampered" hay không. | *Giả định:* Thuật toán SHA-256 và RSA/ECDSA không bị bẻ gãy. Nếu kẻ tấn công ký đè Incremental Update nhưng thêm trang mới, chữ ký cũ vẫn hợp lệ nhưng verifier phải cảnh báo có sửa đổi sau ký. |
| **THR-02** | **Signed PDF Artifact (AST-02)** | **Thay tệp giữa lúc băm và lưu trữ (Time-of-Check to Time-of-Use - TOCTOU):**<br/>Tệp PDF được băm lúc 10:00:00, nhưng trước khi upload lên Storage hoặc trước khi chèn chữ ký, tệp bị thay thế bởi một tệp khác. | **Nghiêm trọng:** Ký số trên một nội dung nhưng lưu trữ tệp nội dung khác, gây sai lệch nghiêm trọng. | **1.** Toàn bộ quy trình sinh PDF, tính băm, chèn chữ ký và upload diễn ra trong bộ nhớ RAM (In-Memory Buffer), không ghi file tạm không kiểm soát ra thư mục `/tmp` công cộng.<br/>**2.** Sau khi upload lên Storage, tính lại SHA-256 nhị phân của tệp đã lưu và đối chiếu với `signedPdfHash` ghi vào DB trong cùng Transaction. | Tái hiện giả lập thao tác tiêm file khác vào giữa bước ký và bước lưu, xác nhận hệ thống rollback transaction và xóa file rác. | *Giả định:* Bộ nhớ RAM của tiến trình Node.js không bị can thiệp bởi mã độc tầng root OS. |
| **THR-03** | **Workflow & Audit (AST-04)** | **Replay request ký hoặc ký hai lần (Double Signing / Replay Attack):**<br/>Người dùng bấm nút ký nhiều lần hoặc mạng gửi lại request ký làm hệ thống ký 2 lần, sinh 2 chữ ký thừa hoặc làm hỏng cấu trúc Incremental Update. | **Trung bình - Cao:** Hỏng tệp PDF, duplicate audit event, tranh chấp trạng thái trong FSM. | **1.** Client gửi kèm `idempotencyKey` độc nhất cho mỗi thao tác ký.<br/>**2.** Sử dụng PostgreSQL Transaction Advisory Lock theo `documentId` (`pg_advisory_xact_lock`).<br/>**3.** Kiểm tra trạng thái hiện tại của bước duyệt: Nếu bước đã `COMPLETED` hoặc văn bản đã `APPROVED`, từ chối request trùng lặp ngay lập tức (`409 Conflict`). | Chạy 10 request ký đồng thời bằng Promise.all với cùng token và payload; kiểm tra chỉ duy nhất 1 request thực thi thành công, 9 request còn lại bị chặn hoặc trả về kết quả đã ký. | *Giới hạn:* Nếu client sinh mã `idempotencyKey` mới cho cùng một hành động do lỗi logic frontend, hệ thống vẫn phải dựa vào khóa FSM và Advisory Lock trong DB để chặn ký lặp. |
| **THR-04** | **Chứng thư số (AST-03)** | **Dùng chứng thư hết hạn, bị thu hồi hoặc giả mạo chủ thể:**<br/>Người dùng sử dụng chứng thư đã hết hiệu lực, hoặc chứng thư đã bị thu hồi (do lộ khóa/thôi việc), hoặc chứng thư của người khác để ký duyệt. | **Nghiêm trọng:** Chữ ký không có giá trị pháp lý, kẻ mạo danh ký thay người có thẩm quyền. | **1.** Kiểm tra tính hợp lệ về thời gian (`notBefore <= now <= notAfter`).<br/>**2.** Kiểm tra bảng `digital_certificates`: Trạng thái bắt buộc là `ACTIVE` (không phải `REVOKED` hay `EXPIRED`).<br/>**3.** Kiểm tra ánh xạ danh tính: `certificate.userId === currentUser.id` (nếu là chữ ký cá nhân) hoặc `currentUser.role === ADMIN` và thuộc đúng `organizationId` (nếu là con dấu tổ chức).<br/>**4.** Kiểm tra OCSP/CRL khi có cấu hình CA ngoài. | Kiểm thử ký bằng chứng thư hết hạn $\rightarrow$ Bị chặn `400 Bad Request`; Ký bằng chứng thư đã bị revoke $\rightarrow$ Bị chặn `403 Forbidden`; Dùng cert của User A cho User B $\rightarrow$ Bị chặn `403 Forbidden`. | *Rủi ro còn lại:* Nếu CA ngoài không khả dụng (OCSP timeout), hệ thống cần áp dụng chính sách cấu hình Soft-fail hoặc Hard-fail (xem THR-10). |
| **THR-05** | **Khóa riêng (AST-01)** | **Chiếm quyền API hoặc sử dụng khóa riêng trái phép:**<br/>Kẻ tấn công đánh cắp JWT của người duyệt hoặc khai thác lỗ hổng API để gọi endpoint ký mà không có thẩm quyền. | **Thảm họa:** Khóa riêng bị lạm dụng để ký các văn bản trái phép mà người sở hữu không hề hay biết. | **1.** Khóa riêng được cách ly trong `ISigningKeyProvider`, tuyệt đối không bao giờ trả về qua API.<br/>**2.** Endpoint ký kiểm tra đa lớp: JWT Signature $\rightarrow$ Tenant Isolation $\rightarrow$ Quyền Assignee hiện tại của bước trong FSM $\rightarrow$ Quyền sở hữu chứng thư.<br/>**3.** Đối với môi trường Production, áp dụng xác thực cấp hai (Step-up Auth / OTP) trước khi thực hiện ký. | Thử gọi API ký với token của người không thuộc danh sách người duyệt $\rightarrow$ Chặn `403 Forbidden`; Thử gọi API ký trên tài liệu đã hoàn thành $\rightarrow$ Chặn `400 Bad Request`. | *Rủi ro còn lại:* Nếu người dùng để lộ hoàn toàn JWT và mã OTP cá nhân, kẻ tấn công vẫn có thể thực hiện ký hợp pháp từ góc độ hệ thống. |
| **THR-06** | **Tài sản Đa Doanh nghiệp (AST-02, AST-03)** | **Cross-Tenant Access đến PDF, Metadata hoặc Verification:**<br/>Người dùng thuộc Công ty Alpha (Tenant A) cố tình tải tệp PDF, xem metadata chứng thư hoặc ký tài liệu thuộc Công ty Beta (Tenant B). | **Nghiêm trọng:** Vi phạm bảo mật thông tin kinh doanh, lộ bí mật thương mại giữa các công ty thành viên. | **1.** Toàn bộ truy vấn DB đều có mệnh đề lọc cứng `WHERE organizationId = user.organizationId` (áp dụng triệt để cho `Document`, `DocumentVersion`, `DigitalCertificate`).<br/>**2.** Controller tải file kiểm tra quyền sở hữu tổ chức trước khi cấp luồng đọc nhị phân từ storage.<br/>**3.** Endpoint xác minh công khai (Public Verification) chỉ trả về kết quả kiểm tra tính toàn vẹn (Hợp lệ / Bị sửa) và metadata cơ bản, tuyệt đối không trả về nội dung nhạy cảm của form nếu người gọi không có quyền truy cập tài liệu. | Thử dùng token User Công ty Alpha gọi GET file PDF của Công ty Beta $\rightarrow$ Chặn `403 Forbidden`; Thử dùng chứng thư của Beta để ký văn bản Alpha $\rightarrow$ Chặn `403 Forbidden`. | *Giả định:* Hệ thống phân quyền RBAC và Tenant Guard hoạt động đúng như đã kiểm chứng ở Phase 12.1.1. |
| **THR-07** | **Chính sách Ủy quyền (AST-05)** | **Ủy quyền bị thu hồi hoặc hết hạn trong lúc yêu cầu ký đang được xử lý (Race Condition):**<br/>Giám đốc A bấm "Thu hồi ủy quyền" đối với Phó giám đốc B đúng lúc Phó giám đốc B đang gửi request ký số tài liệu. | **Cao:** Tài liệu được ký bởi người đã bị tước quyền, dẫn đến tranh chấp pháp lý nội bộ. | **1.** Kế thừa cơ chế Pessimistic Locking từ Phase 12.1.1: Transaction ký số thực hiện `SELECT id, "isActive", "startDate", "endDate" FROM delegation_policies WHERE id = $1 FOR UPDATE`.<br/>**2.** Nếu transaction revoke đã commit trước: Request ký bị từ chối ngay lập tức `403 Forbidden`.<br/>**3.** Nếu transaction ký số đi trước: Chữ ký được hoàn tất và ghi nhận hợp lệ; transaction revoke sau đó thu hồi hiệu lực cho các văn bản tiếp theo. | Tái hiện 2 request đồng thời (Revoke Policy vs Sign with Delegation) và kiểm tra tính nhất quán tuyệt đối của DB và tệp PDF. | *Giả định:* Cơ chế khóa PostgreSQL FOR UPDATE hoạt động nhất quán trên cùng một connection transaction. |
| **THR-08** | **Audit Trail (AST-04)** | **Quản trị viên sửa metadata hoặc xóa bằng chứng audit:**<br/>Một quản trị viên biến chất truy cập trực tiếp vào DB để sửa người ký hoặc xóa bản ghi log nhằm xóa dấu vết. | **Nghiêm trọng:** Mất khả năng giải trình và kiểm toán pháp lý độc lập. | **1.** Chữ ký số nằm trong tệp PDF nhị phân độc lập với DB: Việc sửa DB không làm thay đổi thông tin người ký và chứng thư số đã đóng băng vĩnh viễn trong cấu trúc CMS của PDF.<br/>**2.** Kiểm tra tính độc lập: Khi kiểm toán, dùng công cụ độc lập mở tệp PDF để đọc Subject DN của chứng thư đã ký, không dựa đơn thuần vào bảng `SignatureEvent`.<br/>**3.** Cơ chế AuditLog append-only (chỉ INSERT, không cho phép UPDATE/DELETE). | Kiểm tra việc sửa đổi tên người ký trong bảng `SignatureEvent` không ảnh hưởng đến kết quả xác minh nhị phân của tệp PDF. | *Rủi ro còn lại:* Nếu quản trị viên có quyền can thiệp cả DB và thay đổi toàn bộ tệp tin trên Storage bằng tệp mới, cần áp dụng S3 Object Lock (WORM - Write Once Read Many) cho môi trường Production. |
| **THR-09** | **Hệ thống & Động cơ PDF** | **PDF Parser Bombs, Malformed PDF và Lỗ hổng Thư viện:**<br/>Kẻ tấn công tải lên file PDF giả mạo cấu trúc, chứa đệ quy vô hạn (Billion Laughs / Zip Bomb), hoặc PDF độc hại gây tràn bộ đệm thư viện parser. | **Cao:** Treo hệ thống (Denial of Service), cạn kiệt tài nguyên CPU/RAM, sập tiến trình Node.js API. | **1.** Giới hạn dung lượng tệp tối đa (ví dụ: tối đa 20MB cho mỗi tệp PDF).<br/>**2.** Thiết lập timeout nghiêm ngặt cho tiến trình render và ký (ví dụ: timeout 15 giây).<br/>**3.** Xử lý ngoại lệ an toàn bọc quanh toàn bộ các hàm phân tích PDF; không để lỗi parser làm crash process Node.js.<br/>**4.** Cập nhật thường xuyên các bản vá bảo mật của thư viện xử lý PDF. | Tải lên file PDF bị cắt cụt (truncated EOF), file kích thước vượt ngưỡng cho phép, và file cấu trúc vòng đệ quy; kiểm tra API trả về mã lỗi 400 có kiểm soát mà không crash server. | *Rủi ro còn lại:* Lỗ hổng zero-day trong các thư viện C++ biên dịch nhúng (nếu có). |
| **THR-10** | **Dịch vụ Ngoài (TSA / OCSP)** | **Máy chủ Timestamp (TSA) hoặc OCSP/CRL không thể truy cập được:**<br/>Mạng Internet gặp sự cố, dịch vụ TSA của nhà mạng bị downtime làm request ký số bị nghẽn hoặc thất bại. | **Trung bình:** Làm gián đoạn quy trình phê duyệt khẩn cấp của doanh nghiệp. | **1.** Thiết lập timeout ngắn (ví dụ: 3 giây) khi kết nối tới TSA/OCSP ngoài.<br/>**2.** Cấu hình chính sách xử lý linh hoạt theo cấp bậc tài liệu:<br/>- *Chế độ Bắt buộc (Strict/Hard-fail)*: Cho các hợp đồng tài chính giá trị lớn $\rightarrow$ Báo lỗi và dừng ký nếu TSA không phản hồi.<br/>- *Chế độ Linh hoạt (Soft-fail / Local Fallback)*: Cho các tờ trình nội bộ thông thường $\rightarrow$ Tạm thời ký số không nhúng timestamp của TSA ngoài (ký theo chuẩn PAdES B-B với thời gian hệ thống nội bộ đã đồng bộ NTP). | Giả lập ngắt kết nối mạng tới TSA server; kiểm tra hành vi ứng xử tương ứng theo cấu hình strict/fallback. | *Giới hạn:* Nếu chọn soft-fail, văn bản ký trong giai đoạn này sẽ không có chứng nhận thời gian từ bên thứ ba độc lập. |
| **THR-11** | **Bảo đảm Toàn vẹn (AST-02, AST-04)** | **Lỗi giữa các bước ký, lưu file, cập nhật DB và ghi audit (Partial Failure):**<br/>File đã ký được upload lên storage nhưng server mất điện hoặc DB timeout trước khi kịp lưu thông tin vào PostgreSQL. | **Nghiêm trọng:** Dữ liệu bất nhất (Inconsistency); file mồ côi chiếm dụng bộ nhớ; người dùng nghĩ ký thất bại nên ký lại nhiều lần. | **1.** Thực thi theo mô hình Two-Phase Commit có cơ chế đền bù (Compensating Transaction):<br/>- Tạo bản ghi trạng thái `SIGNING_IN_PROGRESS` trước khi gửi lệnh ký.<br/>- Nếu upload thành công nhưng DB commit thất bại $\rightarrow$ Background job định kỳ phát hiện các tệp mồ côi (Orphan Cleanup Worker) hoặc hoàn tất việc đồng bộ.<br/>**2.** Lưu trữ tệp với đường dẫn định danh có chứa mã hash nội dung (Content-Addressable Storage pattern) để tránh ghi đè. | Giả lập ngắt kết nối DB ngay sau khi upload file lên Storage; kiểm tra cơ chế rollback và cleanup. | *Giả định:* Cơ chế worker dọn dẹp chạy định kỳ và có quyền truy cập dọn dẹp storage. |
| **THR-12** | **Khóa riêng & Keystore (AST-01)** | **Xâm nhập máy chủ và lộ mật khẩu giải mã Keystore (Host Compromise & Secret Disclosure):**<br/>Kẻ tấn công chiếm quyền truy cập filesystem máy chủ backend (`storage/keystores/dev/`) đồng thời đọc được biến môi trường `DEV_SIGNING_PASSPHRASE`. | **Thảm họa:** Toàn bộ khóa riêng PKCS#12 bị trích xuất, kẻ tấn công có thể tạo chữ ký giả mạo ngoài hệ thống. | **1.** Chỉ cho phép dùng `DevLocalKeystoreProvider` trong môi trường Development / CI/CD với chứng thư gắn nhãn "DEV TEST ONLY".<br/>**2.** Trong môi trường Production, **BẮT BUỘC** chuyển sang `CloudKmsSigningProvider` hoặc `SmartCaSigningProvider` (AWS KMS, Google Cloud KMS, Azure Key Vault, HSM FIPS 140-2 Level 3, VNPT SmartCA). Khi đó khóa riêng được sinh và bảo vệ vĩnh viễn trong phần cứng cryptographic hardware, không bao giờ xuất hiện trên filesystem máy chủ backend.<br/>**3.** Chặn đứng Path Traversal, không bao giờ ghi log mật khẩu hoặc keystore bytes. | Kiểm tra unit test và integration test xác nhận không có bất kỳ log hay error message nào in ra mật khẩu giải mã hoặc PEM private key. | *Giới hạn của Local Keystore:* PKCS#12 được mã hóa bằng AES-256-CBC chỉ bảo vệ khóa khi tệp bị đánh cắp độc lập với mật khẩu. Nếu server và biến môi trường cùng bị lộ, mã hóa phần mềm không thể thay thế HSM phần cứng. |

---

## 5. ĐÁNH GIÁ RỦI RO CÒN LẠI (RESIDUAL RISK SUMMARY)

Không có hệ thống nào an toàn 100%. Dưới đây là bảng đánh giá rủi ro còn lại sau khi đã áp dụng đầy đủ các biện pháp thiết kế kiến trúc:

| Rủi ro còn lại | Mức độ sau kiểm soát | Biện pháp giảm thiểu bổ sung trong vận hành thực tế |
| :--- | :--- | :--- |
| **Mất cắp thiết bị / Khóa truy cập của Quản trị viên cấp cao** | Thấp | Bắt buộc bật xác thực đa yếu tố (MFA/FIDO2) cho toàn bộ tài khoản `SUPER_ADMIN`; áp dụng mô hình phân tách nhiệm vụ (Separation of Duties). |
| **Lỗ hổng zero-day trong thư viện PDF/Cryptographic bên thứ ba** | Trung bình | Định kỳ chạy kiểm tra lỗ hổng phụ thuộc (`pnpm audit`), quét bảo mật tự động bằng Snyk/Dependabot, cô lập tiến trình render PDF trong sandbox. |
| **Gian lận thông đồng (Collusion) giữa Người ủy quyền và Người nhận ủy quyền** | Thấp | Nhật ký kiểm toán bất biến (Immutable Audit Trail) ghi nhận đầy đủ IP, UserAgent, thời gian và chính sách ủy quyền phục vụ điều tra hình sự/pháp lý. |
| **Tranh chấp về thời gian ký khi không có dấu thời gian TSA** | Trung bình | Đối với các hợp đồng kinh tế và văn bản đối ngoại quan trọng, cấu hình bắt buộc áp dụng tiêu chuẩn PAdES B-T với dịch vụ TSA được cấp phép. |
| **Rủi ro lưu giữ khóa cục bộ (Local Keystore Custody Risk)** | Đã kiểm soát (Dev) / Nghiêm cấm (Prod) | Trong Phase 13.2.1, Local Keystore chỉ phục vụ phát triển/test. Trong môi trường Production, bắt buộc áp dụng Cloud KMS / HSM qua adapter `CloudKmsSigningProvider`. |

---

## 6. KẾT LUẬN THREAT MODEL

Mô hình bảo mật của Phase 13 xác lập các nguyên tắc cốt lõi:
1. **Kiểm tra Mật mã thay vì tin tưởng Metadata**: Tính hợp lệ của tài liệu được quyết định bởi chữ ký toán học nhúng trong tệp PDF chứ không chỉ dựa vào cờ `isValid` trong PostgreSQL.
2. **Cách ly tuyệt đối Khóa riêng**: Khóa riêng không bao giờ xuất hiện ở frontend, không bao giờ ghi log, không lưu dạng plaintext, và không bao giờ export ra khỏi Provider interface.
3. **Phòng thủ đa lớp (Defense in Depth)**: Kết hợp RBAC, Tenant Isolation, Advisory Locks, Incremental Updates, và Independent Verification để vô hiệu hóa các vector tấn công từ ngoài lẫn nội bộ.
