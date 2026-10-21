# HỢP ĐỒNG API (API CONTRACT) DÀNH CHO FRONTEND
*Phiên bản: 1.0.0 — Hệ thống Trình Ký Online Nội Bộ Tập Đoàn*

---

## 1. TIÊU CHUẨN GIAO THỨC CHUNG
- **Base URL:** `http://localhost:4000/api` (Môi trường Dev)
- **Content-Type:** `application/json; charset=utf-8`
- **Cơ chế Xác thực (Authentication):**
  Mọi request đều bắt buộc gửi kèm JSON Web Token trong HTTP Header:
  ```http
  Authorization: Bearer <JWT_TOKEN>
  ```
  - Backend sử dụng thuật toán HMAC-SHA256 để giải mã UserPrincipal:
    ```typescript
    interface UserPrincipal {
      id: string;             // UUID người dùng
      email: string;
      fullName: string;
      role: 'SUPER_ADMIN' | 'ADMIN' | 'USER';
      organizationId: string | null;
      departmentId: string | null;
    }
    ```
- **Ranh giới Phân quyền Đa tổ chức (Multi-Company Authorization):**
  - `SUPER_ADMIN`: Quản trị toàn tập đoàn, có quyền thao tác trên mọi hồ sơ của tất cả công ty thành viên.
  - `ADMIN`: Giới hạn trong công ty của mình (`document.organizationId === user.organizationId`). Bị chặn 403 nếu thao tác trên hồ sơ công ty khác.
  - `USER`: Chỉ được submit, resubmit, cancel trên hồ sơ do chính mình tạo trong cùng tổ chức.

---

## 2. CHUẨN ĐỊNH DẠNG RESPONSE & MÃ LỖI

### 2.1. Response Thành Công (HTTP 200 OK)
```json
{
  "success": true,
  "data": { ... },
  "timestamp": "2026-10-21T10:15:00.000Z"
}
```

### 2.2. Response Lỗi Chuẩn (Đã vệ sinh qua WorkflowExceptionFilter)
```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Nội dung mô tả lỗi bằng tiếng Việt dành cho người dùng",
    "timestamp": "2026-10-21T10:15:00.000Z"
  }
}
```

### 2.3. Bảng Tra Cứu Mã Lỗi (Error Codes)
| HTTP Status | Error Code | Ý nghĩa / Trường hợp xảy ra |
| :--- | :--- | :--- |
| `400` | `VALIDATION_ERROR` | Dữ liệu body gửi lên không đúng định dạng (thiếu trường bắt buộc, sai type, payload rỗng). |
| `401` | `UNAUTHORIZED` | Không có header Authorization, token sai định dạng, token hết hạn hoặc chữ ký bị giả mạo. |
| `403` | `FORBIDDEN` | Không thuộc công ty sở hữu hồ sơ, không phải tác giả, không được phân công trong bước hiện tại, hoặc là `REVIEWER`. |
| `404` | `DOCUMENT_NOT_FOUND` | Không tìm thấy hồ sơ hoặc quy trình duyệt với `id` được cung cấp. |
| `409` | `CONCURRENCY_CONFLICT` | Xung đột tương tranh: Bước duyệt đã được người khác hoàn tất trước trong chế độ `ANY_CAN_APPROVE`, hoặc người dùng gửi trùng request duyệt. |
| `422` | `INVALID_STATE_TRANSITION` | Thao tác không hợp lệ đối với trạng thái hiện tại của hồ sơ (Ví dụ: nộp lại hồ sơ khi đang `IN_REVIEW`, hoặc hủy hồ sơ đã `APPROVED`). |
| `500` | `INTERNAL_ERROR` | Lỗi máy chủ nội bộ. Toàn bộ stack trace và chi tiết database bị che giấu an toàn. |

---

## 3. CHI TIẾT 4 WORKFLOW ENDPOINTS

### ① Gửi duyệt hồ sơ (Submit Document)
Khởi động quy trình duyệt từ trạng thái nháp, kích hoạt Bước 1 sang `IN_PROGRESS`.

- **Endpoint:** `POST /api/documents/:id/submit`
- **Quyền hạn:** Tác giả hồ sơ (`createdById`) hoặc Admin công ty sở hữu hồ sơ.
- **Trạng thái Document hợp lệ:** `DRAFT`
- **Request Body:** Không yêu cầu (rỗng `{}`)
- **Response Thành Công (200 OK):**
```json
{
  "success": true,
  "data": {
    "success": true,
    "documentStatus": "IN_REVIEW",
    "workflowStatus": "RUNNING",
    "shouldNotifyUserIds": ["user-approver-step1-id"]
  },
  "timestamp": "2026-10-21T10:15:00.000Z"
}
```

---

### ② Ra quyết định phê duyệt (Process Assignee Decision)
Người duyệt được phân công đưa ra quyết định tại bước hiện tại.

- **Endpoint:** `POST /api/documents/:id/decision`
- **Quyền hạn:** Người dùng có phân công trong bước hiện tại (`role: APPROVER`). Người có role `REVIEWER` chỉ có quyền xem, bị chặn 403 nếu gửi request.
- **Trạng thái Document hợp lệ:** `IN_REVIEW`
- **Request Body DTO (`ProcessDecisionDto`):**
```json
{
  "decision": "APPROVED",
  "decisionComment": "Đồng ý phê duyệt đề xuất chi phí công tác",
  "signatureImageUrl": "https://cdn.company.com/signatures/user-tp.png"
}
```
*Ghi chú các trường:*
- `decision` (Bắt buộc): `APPROVED` | `REJECTED` | `REVISION_REQUESTED`.
- `decisionComment` (Không bắt buộc): Tối đa 1000 ký tự.
- `signatureImageUrl` (Không bắt buộc): URL ảnh chữ ký cá nhân (khi `decision === 'APPROVED'`).

- **Response Thành Công (200 OK):**
```json
{
  "success": true,
  "data": {
    "success": true,
    "documentStatus": "IN_REVIEW",
    "workflowStatus": "RUNNING",
    "shouldNotifyUserIds": ["user-approver-step2-id"]
  },
  "timestamp": "2026-10-21T10:15:00.000Z"
}
```
*Quy tắc chuyển trạng thái của FSM:*
- Nếu `decision: "APPROVED"` và là bước cuối cùng -> `documentStatus: "APPROVED"`, `workflowStatus: "COMPLETED"`.
- Nếu `decision: "REJECTED"` -> `documentStatus: "REJECTED"`, `workflowStatus: "REJECTED"`, các bước sau tự động `CANCELLED`.
- Nếu `decision: "REVISION_REQUESTED"` -> `documentStatus: "REVISION_REQUESTED"`, bước duyệt chuyển sang `REVISION_REQUESTED`, toàn bộ chữ ký cũ của version hiện tại bị vô hiệu hóa (`isValid: false`).

---

### ③ Nộp lại hồ sơ sau chỉnh sửa (Resubmit Document)
Sau khi có cấp duyệt yêu cầu sửa, tác giả cập nhật dữ liệu biểu mẫu mới và gửi nộp lại.

- **Endpoint:** `POST /api/documents/:id/resubmit`
- **Quyền hạn:** Tác giả hồ sơ hoặc Admin công ty sở hữu.
- **Trạng thái Document hợp lệ:** `REVISION_REQUESTED`
- **Request Body DTO (`ResubmitDocumentDto`):**
```json
{
  "formData": {
    "amount": 7500000,
    "reason": "Tạm ứng công tác Hà Nội (đã giảm bớt phụ phí theo yêu cầu Trưởng phòng)",
    "department": "Phòng Kế toán",
    "advanceItems": [
      { "item": "Vé máy bay khứ hồi", "cost": 4500000 },
      { "item": "Khách sạn 3 đêm", "cost": 3000000 }
    ]
  },
  "changeSummary": "Bổ sung bảng kê chi phí chi tiết theo yêu cầu của cấp duyệt"
}
```
*Ghi chú các trường:*
- `formData` (Bắt buộc): JSON Object chứa dữ liệu người dùng điền theo schema của biểu mẫu.
- `changeSummary` (Không bắt buộc): Tối đa 500 ký tự tóm tắt điểm mới so với phiên bản trước.

- **Response Thành Công (200 OK):**
```json
{
  "success": true,
  "data": {
    "success": true,
    "newVersionNumber": 2,
    "contentHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "documentStatus": "IN_REVIEW",
    "workflowStatus": "RUNNING",
    "shouldNotifyUserIds": ["user-approver-step1-id"]
  },
  "timestamp": "2026-10-21T10:15:00.000Z"
}
```
*Quy chuẩn hoạt động của Resubmit:*
- Tự động tạo bản ghi mới trong bảng `document_versions` với `versionNumber: 2`, SHA-256 mới.
- Bảo toàn nguyên vẹn bản ghi `versionNumber: 1` cùng lịch sử phê duyệt của nó trong DB.
- Quy trình duyệt chạy lại từ Bước 1 (`currentStepOrder: 1`), bước 1 chuyển về `IN_PROGRESS`, các bước sau về `WAITING`, quyết định của assignees được reset về `PENDING`.

---

### ④ Hủy hồ sơ trình ký (Cancel Document)
Chủ động dừng hồ sơ không tiếp tục xử lý.

- **Endpoint:** `POST /api/documents/:id/cancel`
- **Quyền hạn:** Tác giả hồ sơ, Admin công ty sở hữu hoặc `SUPER_ADMIN` tập đoàn.
- **Trạng thái Document hợp lệ:** `DRAFT`, `SUBMITTED`, `IN_REVIEW`, `REVISION_REQUESTED`.
- **Chặn tuyệt đối:** Không được phép hủy khi hồ sơ đã ở trạng thái kết thúc (`APPROVED` hoặc `REJECTED`).
- **Request Body DTO (`CancelDocumentDto`):**
```json
{
  "cancelReason": "Dự án đã tạm hoãn theo quyết định của ban lãnh đạo"
}
```

- **Response Thành Công (200 OK):**
```json
{
  "success": true,
  "data": {
    "success": true,
    "documentStatus": "CANCELLED",
    "workflowStatus": "CANCELLED",
    "shouldNotifyUserIds": []
  },
  "timestamp": "2026-10-21T10:15:00.000Z"
}
```
*Hành vi hệ thống:*
- Trạng thái `document.status` và `approvalWorkflow.status` chuyển thành `CANCELLED`.
- Toàn bộ các bước chưa hoàn tất (`IN_PROGRESS`, `WAITING`, `REVISION_REQUESTED`) tự động chuyển thành `CANCELLED`.
- Ghi nhận `AuditLog` với action `CANCEL_DOCUMENT`.

---

## 4. NHỮNG GIỚI HẠN & LƯU Ý KHI GHÉP GIAO DIỆN (FRONTEND GOTCHAS)

1. **Không bao giờ gửi `userId` trong Body:**
   Danh tính của người thực hiện thao tác được Backend tự động trích xuất từ Bearer JWT. Frontend không cần (và không được phép) truyền `userId` vào Body JSON.
2. **Xử lý xung đột `409 CONCURRENCY_CONFLICT`:**
   Trong các bước song song (`ANY_CAN_APPROVE`), khi một người đồng cấp khác vừa bấm duyệt trước, người dùng bấm sau sẽ nhận mã lỗi 409. Frontend cần hiển thị thông báo thân thiện: *"Bước duyệt này đã được một người duyệt khác xử lý trước đó. Đang tải lại trạng thái hồ sơ..."* và tự động refresh dữ liệu trang.
3. **Chữ ký cá nhân:**
   Hiện tại `signatureImageUrl` là URL ảnh (PNG/SVG nền trong suốt). Frontend có thể tích hợp canvas vẽ chữ ký tay hoặc tải ảnh lên để lấy URL trước khi gọi endpoint `POST /decision`.
