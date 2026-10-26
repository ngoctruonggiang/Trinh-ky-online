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

## 4. CHI TIẾT 3 READ ENDPOINTS (BỔ SUNG TẠI PHASE 9)

### ⑤ Lấy danh sách hồ sơ trình ký (Get Documents)
Truy vấn danh sách hồ sơ có phân trang, lọc và bảo vệ ranh giới tổ chức tại cấp database.

- **Endpoint:** `GET /api/documents`
- **Query Parameters:**
  - `page` (Tùy chọn, mặc định `1`): Trang số.
  - `limit` (Tùy chọn, mặc định `10`, tối đa `100`): Số lượng phần tử mỗi trang.
  - `tab` (Tùy chọn, mặc định `all`): Chế độ danh sách:
    - `pending_my_approval`: Các hồ sơ `IN_REVIEW` mà người dùng hiện tại là `APPROVER` trong bước `IN_PROGRESS` với quyết định `PENDING`.
    - `my_documents`: Hồ sơ do chính người dùng hiện tại tạo (`createdById: user.id`).
    - `all`: Toàn bộ hồ sơ trong phạm vi tổ chức của người dùng.
  - `status` (Tùy chọn): Lọc theo `DocumentStatus` (`DRAFT`, `SUBMITTED`, `IN_REVIEW`, `REVISION_REQUESTED`, `APPROVED`, `REJECTED`, `CANCELLED`).
  - `search` (Tùy chọn): Tìm kiếm từ khóa theo `title` hoặc `documentNumber` (không phân biệt hoa thường).
- **Ranh giới Phân quyền Đa tổ chức:**
  - `SUPER_ADMIN`: Có quyền truy vấn hồ sơ của toàn bộ tập đoàn.
  - `ADMIN` & `USER`: Bắt buộc bị giới hạn `organizationId: user.organizationId` ở cấp SQL truy vấn.
- **Response Thành Công (200 OK):**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "doc-001",
        "documentNumber": "TK-2026-0001",
        "title": "Giấy đề nghị tạm ứng công tác phí",
        "templateCode": "TAM_UNG",
        "templateTitle": "Giấy đề nghị tạm ứng",
        "status": "IN_REVIEW",
        "urgency": "URGENT",
        "createdById": "user-emp-01",
        "createdByName": "Trần Thị Bích",
        "organizationId": "org-hq",
        "organizationName": "VinaGroup HQ",
        "departmentName": "Phòng CNTT",
        "currentStepOrder": 1,
        "totalSteps": 2,
        "currentStepName": "Trưởng phòng thẩm tra",
        "createdAt": "2026-10-20T08:30:00.000Z",
        "updatedAt": "2026-10-20T08:30:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 1,
      "totalPages": 1
    }
  },
  "timestamp": "2026-10-21T10:15:00.000Z"
}
```

---

### ⑥ Lấy chi tiết hồ sơ trình ký (Get Document Detail)
Truy vấn toàn bộ dữ liệu hồ sơ, phiên bản biểu mẫu, tiến trình workflow, lịch sử quyết định và chữ ký số.

- **Endpoint:** `GET /api/documents/:id`
- **Quyền hạn:**
  - Người dùng thuộc cùng `organizationId` với hồ sơ hoặc `SUPER_ADMIN`.
  - Người dùng thuộc tổ chức khác bị chặn `403 FORBIDDEN`.
  - Không tìm thấy hồ sơ trả về `404 DOCUMENT_NOT_FOUND`.
- **Response Thành Công (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "doc-001",
    "documentNumber": "TK-2026-0001",
    "title": "Giấy đề nghị tạm ứng công tác phí",
    "templateCode": "TAM_UNG",
    "templateTitle": "Giấy đề nghị tạm ứng",
    "status": "IN_REVIEW",
    "urgency": "URGENT",
    "createdById": "user-emp-01",
    "createdByName": "Trần Thị Bích",
    "organizationId": "org-hq",
    "organizationName": "VinaGroup HQ",
    "departmentName": "Phòng CNTT",
    "currentStepOrder": 1,
    "totalSteps": 2,
    "currentStepName": "Trưởng phòng thẩm tra",
    "createdAt": "2026-10-20T08:30:00.000Z",
    "updatedAt": "2026-10-20T08:30:00.000Z",
    "currentVersion": 1,
    "activeVersion": {
      "id": "ver-001",
      "versionNumber": 1,
      "formData": { "advanceAmount": 15000000, "reason": "Công tác Đà Nẵng" },
      "sha256Hash": "a7c9f82d4b1e56312a0f8976bce43110294b8e3fa52c672b1d91653fa38b2910",
      "changeSummary": "Bản nộp khởi tạo ban đầu",
      "createdAt": "2026-10-20T08:30:00.000Z"
    },
    "versions": [ ... ],
    "workflow": {
      "id": "wf-001",
      "status": "RUNNING",
      "currentStepOrder": 1,
      "steps": [
        {
          "id": "step-001",
          "stepOrder": 1,
          "stepName": "Trưởng phòng thẩm tra",
          "stepType": "SEQUENTIAL",
          "completionRule": "ALL_MUST_APPROVE",
          "status": "IN_PROGRESS",
          "assignees": [
            {
              "id": "asg-001",
              "userId": "user-tp-id",
              "userName": "Nguyễn Văn An",
              "userEmail": "an.nv@vinagroup.vn",
              "role": "APPROVER",
              "decision": "PENDING"
            }
          ]
        }
      ]
    },
    "decisionHistories": [],
    "signatures": [],
    "signedPdfArtifact": {
      "id": "art-signed-001",
      "signedPdfHash": "a8f3b2c1d0e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0",
      "rawPdfHash": "1348c7f51924d979b0e123456789abcdef0123456789abcdef0123456789abcd",
      "signerName": "Con dấu Điện tử VinaGroup HQ",
      "signerSubject": "CN=Con dau Dien tu Tap doan VinaGroup, O=VinaGroup, C=VN",
      "signingTime": "2026-10-26T04:30:00.000Z",
      "hasTimestamp": true,
      "timestampGenTime": "2026-10-26T04:30:00.500Z",
      "tsaSubject": "CN=Trinh Ky Online Internal Trusted TSA, O=Trinh Ky Online PKI Lab, C=VN",
      "hasLtv": true,
      "ltvStatus": "VALID",
      "dssCertsCount": 3,
      "dssOcspsCount": 2,
      "dssCrlsCount": 0,
      "ltvEmbeddedAt": "2026-10-26T04:30:01.000Z",
      "padesLevel": "PADES_B_LT",
      "downloadUrl": "/api/documents/doc-001/pdf?type=SIGNED_PDF",
      "verifyLtvUrl": "/api/documents/doc-001/verify-ltv"
    },
    "permissions": {
      "canApprove": false,
      "canResubmit": false,
      "canCancel": false,
      "isCreator": false,
      "isAdmin": false,
      "currentStepAssigneeRole": null
    }
  },
  "timestamp": "2026-10-21T10:15:00.000Z"
}
```

---

### ⑦ Lấy thông tin người dùng hiện tại (Get Current User)
Truy vấn thông tin định danh và tổ chức của người dùng từ phiên làm việc đã xác thực.

- **Endpoint:** `GET /api/auth/me`
- **Response Thành Công (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "user-tp-id",
    "email": "an.nv@vinagroup.vn",
    "fullName": "Nguyễn Văn An",
    "role": "USER",
    "organizationId": "org-hq",
    "organizationName": "Tập đoàn VinaGroup (HQ)",
    "departmentId": "dept-it",
    "departmentName": "Phòng Công nghệ Thông tin"
  },
  "timestamp": "2026-10-21T10:15:00.000Z"
}
```
*Ghi chú bảo mật:* Tuyệt đối không trả về `passwordHash`, JWT secret hay token nhạy cảm.

---

### ⑧ Khởi tạo hồ sơ mới từ biểu mẫu động (Create Document from Dynamic Template)
Người dùng chọn biểu mẫu đã phát hành (`PUBLISHED`), điền dữ liệu động và khởi tạo hồ sơ ở trạng thái `DRAFT`.

- **Endpoint:** `POST /api/documents`
- **Quyền hạn:** Người dùng đã xác thực (mọi vai trò thuộc tổ chức).
- **Request Body DTO (`CreateDocumentDto`):**
```json
{
  "templateId": "uuid-template-id",
  "title": "Đề xuất mua sắm màn hình kỹ thuật",
  "urgency": "NORMAL",
  "dueDate": "2026-11-01T00:00:00.000Z",
  "formData": {
    "requester_name": "Nguyễn Văn An",
    "budget_requested": 15000000,
    "purpose": "Trang bị màn hình 4K cho lập trình viên",
    "device_type": "monitor"
  }
}
```
- **Xác thực Backend:**
  - Kiểm tra `templateId` có tồn tại và đang ở trạng thái `PUBLISHED`.
  - Kiểm tra tính hợp lệ của `formData` đối chiếu với phiên bản biểu mẫu phát hành gần nhất (`FormTemplateVersion`).
  - Kiểm tra tính cô lập đa tổ chức (`organizationId`).
- **Response Thành Công (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "uuid-document-id",
    "documentNumber": "TK-20261021-0001",
    "title": "Đề xuất mua sắm màn hình kỹ thuật",
    "status": "DRAFT",
    "templateId": "uuid-template-id",
    "templateVersionId": "uuid-template-version-id",
    "currentStep": 0,
    "totalSteps": 2,
    "createdAt": "2026-10-21T15:30:00.000Z"
  },
  "timestamp": "2026-10-21T15:30:00.000Z"
}
```

---

## 5. DYNAMIC FORM BUILDER & TEMPLATE ENGINE ENDPOINTS

Dành cho quản lý và biên tập biểu mẫu động (Phase 10). Mọi thao tác chỉnh sửa, phát hành và lưu trữ đều yêu cầu quyền Quản trị viên (`ADMIN` hoặc `SUPER_ADMIN`).

### 5.1. Liệt kê danh sách biểu mẫu (List Templates)
- **Endpoint:** `GET /api/templates`
- **Query Params:**
  - `status`: `DRAFT` | `PUBLISHED` | `ARCHIVED` (mặc định lấy tất cả trạng thái người dùng có quyền xem).
  - `category`: Lọc theo chuyên mục (Hành chính, Kế toán, Nhân sự, v.v.).
  - `search`: Tìm kiếm theo mã hoặc tiêu đề biểu mẫu.
  - `page`, `limit`: Phân trang dữ liệu.
- **Quyền hạn:**
  - `SUPER_ADMIN`: Xem biểu mẫu toàn hệ thống.
  - `ADMIN` & `USER`: Xem biểu mẫu thuộc tổ chức của mình hoặc biểu mẫu hệ thống dùng chung (`organizationId: null`).
- **Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid-tmpl-1",
        "code": "TPL-EXPENSE",
        "title": "Biểu mẫu Đề nghị Thanh toán Chi phí",
        "category": "Kế toán - Tài chính",
        "status": "PUBLISHED",
        "currentVersion": 2,
        "fieldCount": 6,
        "organizationName": "Tập đoàn VinaGroup (HQ)",
        "createdAt": "2026-10-20T08:00:00.000Z",
        "updatedAt": "2026-10-21T09:00:00.000Z"
      }
    ],
    "pagination": { "page": 1, "limit": 10, "total": 1, "totalPages": 1 }
  }
}
```

### 5.2. Xem chi tiết biểu mẫu & Lịch sử phiên bản (Get Template Detail)
- **Endpoint:** `GET /api/templates/:id`
- **Response (200 OK):** Trả về đầy đủ schema trường (`fields`), layout blocks, và danh sách các phiên bản đã phát hành (`versions`).
```json
{
  "success": true,
  "data": {
    "id": "uuid-tmpl-1",
    "code": "TPL-EXPENSE",
    "title": "Biểu mẫu Đề nghị Thanh toán Chi phí",
    "status": "PUBLISHED",
    "currentVersion": 2,
    "fields": [
      {
        "key": "expense_amount",
        "label": "Số tiền thanh toán",
        "type": "currency_vnd",
        "required": true,
        "validation": { "min": 1000 }
      }
    ],
    "versions": [
      { "id": "v2-id", "versionNumber": 2, "changeSummary": "Bổ sung định dạng tiền VND", "createdAt": "2026-10-21T09:00:00.000Z", "fieldCount": 6 },
      { "id": "v1-id", "versionNumber": 1, "changeSummary": "Bản phát hành đầu tiên", "createdAt": "2026-10-20T08:00:00.000Z", "fieldCount": 5 }
    ]
  }
}
```

### 5.3. Tạo mới biểu mẫu (Create Template - DRAFT)
- **Endpoint:** `POST /api/templates`
- **Quyền hạn:** `ADMIN`, `SUPER_ADMIN`.
- **Request Body DTO (`CreateTemplateDto`):**
```json
{
  "code": "TPL-TRAVEL",
  "title": "Đề xuất Công tác & Vé máy bay",
  "description": "Dùng cho cán bộ nhân viên đăng ký công tác",
  "category": "Hành chính - Nhân sự",
  "fields": [
    { "key": "destination", "label": "Địa điểm công tác", "type": "text", "required": true },
    { "key": "from_date", "label": "Ngày đi", "type": "date", "required": true },
    { "key": "to_date", "label": "Ngày về", "type": "date", "required": true },
    { "key": "estimated_cost", "label": "Dự toán chi phí", "type": "currency_vnd", "required": false }
  ]
}
```
- **Xác thực:** Backend kiểm tra trùng mã `code`, trùng `key` giữa các trường, kiểm tra loại trường hợp lệ, và phòng chống XSS/code injection trong định nghĩa schema.
- **Response (201 Created):** Trả về thông tin biểu mẫu mới ở trạng thái `DRAFT`.

### 5.4. Chỉnh sửa biểu mẫu bản nháp (Update Template)
- **Endpoint:** `PUT /api/templates/:id`
- **Quyền hạn:** `ADMIN`, `SUPER_ADMIN`.
- **Quy tắc:** Chỉ được phép chỉnh sửa khi biểu mẫu ở trạng thái `DRAFT`. Biểu mẫu đã `PUBLISHED` hoặc `ARCHIVED` bị chặn `400 Bad Request`.

### 5.5. Quản lý bản nháp cho phiên bản tiếp theo (Draft Lifecycle for Next Version)
Sau khi biểu mẫu đã ở trạng thái `PUBLISHED`, snapshot đã phát hành là **bất biến (immutable)** và không được phép sửa trực tiếp. Để chuẩn bị phiên bản mới, Quản trị viên sử dụng bộ endpoint sau:

#### 5.5.1. Tạo bản nháp phiên bản tiếp theo (Create Draft Version)
- **Endpoint:** `POST /api/templates/:id/draft`
- **Quyền hạn:** `ADMIN`, `SUPER_ADMIN`.
- **Hành vi nghiệp vụ:** Tạo bản ghi `FormTemplateVersion` mới ở trạng thái `DRAFT` với `versionNumber = currentVersion + 1`, sao chép schema từ phiên bản hiện tại. Người dùng tạo hồ sơ vẫn tiếp tục sử dụng snapshot `PUBLISHED` hiện tại mà không bị gián đoạn.
- **Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "uuid-draft-version-id",
    "templateId": "uuid-tmpl-1",
    "versionNumber": 2,
    "title": "Biểu mẫu Đề nghị Thanh toán Chi phí",
    "status": "DRAFT"
  }
}
```

#### 5.5.2. Lấy thông tin bản nháp đang soạn thảo (Get Draft Version)
- **Endpoint:** `GET /api/templates/:id/draft`
- **Quyền hạn:** `ADMIN`, `SUPER_ADMIN`.
- **Response (200 OK):** Trả về toàn bộ schema trường, tiêu đề, mô tả đang chuẩn bị cho phiên bản tiếp theo. Nếu chưa tạo bản nháp, trả về `404 NOT_FOUND`.

#### 5.5.3. Chỉnh sửa bản nháp tiếp theo (Update Draft Version)
- **Endpoint:** `PUT /api/templates/:id/draft`
- **Quyền hạn:** `ADMIN`, `SUPER_ADMIN`.
- **Request Body:** `{ "title": "Tiêu đề mới", "fields": [ ... ] }`
- **Hành vi nghiệp vụ:** Cập nhật schema trên bản ghi `FormTemplateVersion` DRAFT mà không chạm vào phiên bản `PUBLISHED` đang hoạt động.

#### 5.5.4. Hủy bỏ bản nháp tiếp theo (Discard Draft Version)
- **Endpoint:** `DELETE /api/templates/:id/draft`
- **Quyền hạn:** `ADMIN`, `SUPER_ADMIN`.
- **Hành vi nghiệp vụ:** Xóa bỏ bản ghi `FormTemplateVersion` DRAFT dở dang. Biểu mẫu quay về trạng thái không có bản nháp. Chặn `400 Bad Request` nếu cố hủy bản nháp ban đầu của biểu mẫu chưa xuất bản lần nào.

### 5.6. Xuất bản / Phát hành phiên bản (Publish Template)
- **Endpoint:** `POST /api/templates/:id/publish`
- **Quyền hạn:** `ADMIN`, `SUPER_ADMIN`.
- **Hành vi nghiệp vụ:**
  - Nếu là bản nháp đầu tiên: chuyển trạng thái sang `PUBLISHED`, tạo bản ghi `FormTemplateVersion` snapshot (v1).
  - Nếu đã có bản nháp tiếp theo (v2, v3...): chuyển trạng thái bản nháp đó sang `PUBLISHED`, đồng thời cập nhật `template.currentVersion` lên số phiên bản mới.
  - **Xử lý xung đột đồng thời (Concurrency Conflict):** Nếu có nhiều request đồng thời cố phát hành cùng một phiên bản, cơ chế khóa giao dịch và ràng buộc Unique (`templateId`, `versionNumber`) của PostgreSQL sẽ trả về `409 CONFLICT` với thông điệp: *"Phiên bản biểu mẫu vừa được một quản trị viên khác phát hành. Vui lòng tải lại trang."*
- **Request Body:** `{ "changeSummary": "Bổ sung định dạng tiền VND và kiểm tra định mức" }`

### 5.7. Lưu trữ biểu mẫu (Archive Template)
- **Endpoint:** `POST /api/templates/:id/archive`
- **Quyền hạn:** `ADMIN`, `SUPER_ADMIN`.
- **Hành vi nghiệp vụ:** Chuyển trạng thái sang `ARCHIVED`. Ngăn không cho người dùng tạo hồ sơ mới từ biểu mẫu này (`400 Bad Request`). Hồ sơ cũ vẫn xem lại bình thường.

### 5.8. Thẩm định trước dữ liệu biểu mẫu (Validate Form Data)
- **Endpoint:** `POST /api/templates/:id/validate`
- **Request Body:** `{ "formData": { ... } }`
- **Quy tắc Thẩm định Chặt chẽ (Hardened Validation Rules):**
  1. **Trường không được khai báo (Undeclared Keys):** Bị từ chối `400 Bad Request` (`Trường "{key}" không tồn tại trong cấu hình biểu mẫu`).
  2. **Số hữu hạn (Finite Numbers):** Loại bỏ `NaN`, `Infinity`, `-Infinity`.
  3. **Tiền tệ VNĐ (`currency_vnd`):** Bắt buộc là số nguyên không âm (`Integer >= 0`).
  4. **Ngày hợp lệ theo lịch (Calendar Date Validation):** Kiểm tra chính xác ngày theo lịch dương lịch, từ chối các ngày không tồn tại (ví dụ: `2026-02-31`).
  5. **Chống ReDoS (Regular Expression Denial of Service):** Biểu thức chính quy không được dài quá 200 ký tự và không chứa nested quantifiers có nguy cơ suy thoái lũy thừa (`(a+)+`, `(a*)*`).

---

## 6. NHỮNG GIỚI HẠN & LƯU Ý KHI GHÉP GIAO DIỆN (FRONTEND GOTCHAS)

1. **Không bao giờ gửi `userId`, `organizationId` trong Body:**
   Danh tính và phạm vi tổ chức của người thực hiện thao tác được Backend tự động trích xuất từ Bearer JWT. Mọi trường hợp cố ý giả mạo `organizationId` hoặc `createdById` trong request body đều bị backend bỏ qua hoặc từ chối.
2. **Bảo vệ Biểu mẫu Toàn Hệ thống (`organizationId: null`):**
   Biểu mẫu dùng chung toàn hệ thống chỉ có `SUPER_ADMIN` mới có quyền chỉnh sửa, phát hành hoặc lưu trữ. Quản trị viên công ty thành viên (`ADMIN`) bị chặn `403 FORBIDDEN` nếu cố thao tác đột biến trên mẫu chung.
3. **Xử lý xung đột `409 CONFLICT`:**
   - Khi duyệt hồ sơ: Xung đột khi có người duyệt trước trong nhóm `ANY_CAN_APPROVE`.
   - Khi phát hành biểu mẫu: Xung đột khi nhiều quản trị viên cùng bấm phát hành đồng thời. Frontend cần hiển thị thông báo thân thiện và tải lại dữ liệu mới nhất.
4. **Toàn vẹn Dữ liệu & SHA-256 Content Hash:**
   Backend tự động chuẩn hóa thứ tự các trường dữ liệu (`canonicalizeJson`) theo chuẩn đệ quy trước khi tạo mã băm SHA-256 lưu trữ vào `DocumentVersion.contentHash`. Lưu ý: **Mã băm này là chứng thư toàn vẹn nội dung chống sửa đổi dữ liệu (tamper-evident data integrity hash), không phải chữ ký số xác thực danh tính cá nhân.**
5. **Ràng buộc khóa ngoại PostgreSQL (`ON DELETE RESTRICT`):**
   `documents.templateVersionId` được cấu hình `ON DELETE RESTRICT`. Bất kỳ hành động xóa nào đối với `FormTemplateVersion` đang được hồ sơ tham chiếu sẽ bị PostgreSQL từ chối tuyệt đối nhằm bảo vệ lịch sử hồ sơ.
6. **Phân tách Chế độ Dữ liệu (Mock vs Real API):**
   Frontend sử dụng kiến trúc Service Adapter `IDocumentService`, `ITemplateService` và `IWorkflowTemplateService` với 2 implementation song song: Mock và Http. Mặc định chạy ở chế độ Mock an toàn trong local development mà không có backend, và chuyển sang Real API khi biến môi trường `NEXT_PUBLIC_USE_MOCK_API='false'`. Không bao giờ tự động chuyển ngầm sang mock khi API thật bị lỗi mạng hay trả về lỗi 4xx/5xx.

---

## 7. QUY TRÌNH PHÊ DUYỆT ĐỘNG (WORKFLOW BUILDER & VERSIONED APPROVAL ENGINE)

### 7.1. Lấy danh sách quy trình phê duyệt (Get Workflow Templates)
- **Endpoint:** `GET /api/workflow-templates`
- **Query Params:** `status` (`PUBLISHED`, `DRAFT`, `ARCHIVED`, `ALL`), `category`, `search`, `page`, `limit`.
- **Quyền hạn:**
  - `USER`: Chỉ xem các quy trình đã `PUBLISHED` thuộc công ty mình hoặc dùng chung toàn hệ thống (`organizationId: null`).
  - `ADMIN`: Xem tất cả trạng thái quy trình thuộc công ty mình và quy trình dùng chung toàn hệ thống.
  - `SUPER_ADMIN`: Xem toàn bộ quy trình trên toàn hệ thống.

### 7.2. Lấy chi tiết quy trình phê duyệt (Get Workflow Template Detail)
- **Endpoint:** `GET /api/workflow-templates/:id`
- **Response (200 OK):** Trả về chi tiết quy trình, danh sách các bước hiện tại, thông tin bản nháp (nếu có `hasDraft: true`) và toàn bộ danh sách các phiên bản snapshot bất biến (`versions`).

### 7.3. Tạo quy trình phê duyệt mới (Create Workflow Template)
- **Endpoint:** `POST /api/workflow-templates`
- **Quyền hạn:** `ADMIN`, `SUPER_ADMIN`.
- **Request Body:**
```json
{
  "code": "WF_EXPENSE_HQ",
  "title": "Quy trình phê duyệt chi phí & tạm ứng",
  "category": "Tài chính",
  "steps": [
    {
      "stepKey": "step_mgr",
      "stepName": "Trưởng phòng chuyên môn duyệt",
      "stepOrder": 1,
      "stepType": "SEQUENTIAL",
      "completionRule": "ALL_MUST_APPROVE",
      "approverConfig": {
        "type": "DEPARTMENT_ROLE",
        "role": "MANAGER",
        "departmentPolicy": "SAME_AS_DOCUMENT"
      },
      "reviewerUserIds": []
    },
    {
      "stepKey": "step_dir",
      "stepName": "Ban Giám đốc phê duyệt",
      "stepOrder": 2,
      "stepType": "SEQUENTIAL",
      "completionRule": "ANY_CAN_APPROVE",
      "approverConfig": {
        "type": "ORGANIZATION_ROLE",
        "role": "DIRECTOR"
      },
      "reviewerUserIds": []
    }
  ]
}
```

### 7.4. Vòng đời Phiên bản & Bản nháp (Draft Versioning Lifecycle)
1. **Tạo bản nháp cho phiên bản tiếp theo:** `POST /api/workflow-templates/:id/draft` (Tạo `WorkflowTemplateVersion` có `status: 'DRAFT'` với `versionNumber = currentVersion + 1`).
2. **Lấy thông tin bản nháp:** `GET /api/workflow-templates/:id/draft`.
3. **Cập nhật bản nháp:** `PUT /api/workflow-templates/:id/draft`.
4. **Hủy bản nháp an toàn:** `DELETE /api/workflow-templates/:id/draft` (Xóa bỏ bản nháp dở dang, bảo vệ nguyên vẹn các phiên bản đã xuất bản).
5. **Phát hành phiên bản (Publish):** `POST /api/workflow-templates/:id/publish` (Chốt bất biến snapshot phiên bản, trả về `409 CONFLICT` nếu có xung đột phát hành đồng thời).

### 7.5. Động cơ Giải quyết Người duyệt (Approver Resolution Engine)
Khi hồ sơ được tạo (`POST /api/documents`) liên kết với `workflowTemplateId` hoặc `workflowTemplateVersionId`:
1. **`SPECIFIC_USERS`:** Giải quyết trực tiếp danh sách userId; xác minh mọi user đều tồn tại và đang `isActive: true`. Nếu có user không tồn tại hoặc bị vô hiệu hóa, hệ thống từ chối `400 Bad Request` và rollback giao dịch.
2. **`DEPARTMENT_ROLE`:** Quét người dùng theo `departmentId` và `role` (`MANAGER`, `ACCOUNTANT`, `DIRECTOR`, `ADMIN`). Nếu phòng ban chưa có người giữ chức danh phù hợp, hệ thống từ chối `400 Bad Request` và rollback toàn bộ giao dịch, không tạo bước rỗng.
3. **`ORGANIZATION_ROLE`:** Quét người dùng giữ vai trò/chức danh toàn công ty. Chặn và rollback nếu không tìm thấy người phù hợp.
4. **Quy tắc hoàn thành:**
   - `ALL_MUST_APPROVE`: Mọi người duyệt được phân công phải bấm Duyệt.
   - `ANY_CAN_APPROVE`: Chỉ cần bất kỳ 1 người duyệt bấm Duyệt, bước sẽ hoàn thành và chuyển sang bước tiếp theo.
5. **Toàn vẹn khóa ngoại CSDL:** `Document.workflowTemplateVersionId` có ràng buộc `onDelete: Restrict`, ngăn chặn việc xóa bỏ snapshot phiên bản quy trình khi đang có hồ sơ lịch sử tham chiếu.

### 7.6. Đảm bảo Toàn vẹn Vận hành & Xử lý Tương tranh (Runtime & Concurrency Guarantees - Phase 11.1)
1. **Khóa Hàng Bi quan (Pessimistic Row-Level Locking):**
   Mọi giao dịch chuyển trạng thái hồ sơ (`submit`, `decision`, `resubmit`, `cancel`) đều thực thi `SELECT id FROM documents WHERE id = :id FOR UPDATE` ngay khi bắt đầu giao dịch PostgreSQL. Cơ chế này tuần tự hóa tuyệt đối các thao tác đồng thời trên cùng một hồ sơ, ngăn ngừa triệt để tình trạng stale read hoặc race condition giữa hai người duyệt bấm cùng lúc.
2. **Quy tắc Duyệt Tuần tự Bất biến (Strict Sequential Ordering):**
   Hồ sơ ở bước $N$ chỉ cho phép người duyệt của bước $N$ ra quyết định. Mọi request duyệt gửi cho bước $N+1$ khi bước $N$ chưa hoàn tất sẽ bị từ chối `403 Forbidden` / `400 Bad Request`.
3. **Chặn Thao tác Từ Tài khoản Vô hiệu hóa (Inactive Account Guard):**
   Nếu người duyệt trong bước bị vô hiệu hóa (`isActive: false`), request ra quyết định bị từ chối ngay lập tức `400 Bad Request` ("Người duyệt đã bị vô hiệu hóa").
4. **Xử lý Quyết định Muộn trong `ANY_CAN_APPROVE`:**
   Khi một người duyệt hoàn tất bước `ANY_CAN_APPROVE`, bước chuyển ngay sang `COMPLETED`. Mọi quyết định gửi muộn từ các người duyệt còn lại đều bị từ chối và rollback, tuyệt đối không làm thay đổi kết quả đã chốt hoặc tạo lịch sử trùng lặp.
5. **Kế thừa Quy trình Tự động (Form-to-Workflow Inheritance):**
   Biểu mẫu `FormTemplate` liên kết `workflowTemplateId` cho phép người dùng khởi tạo hồ sơ mà không cần truyền `workflowTemplateId` thủ công; backend tự động phân giải phiên bản đã xuất bản mới nhất (`workflowTemplateVersionId`) và tạo các bước duyệt hoàn chỉnh trong cùng một transaction.

---

## 8. TÍNH NĂNG PHÊ DUYỆT NÂNG CAO, SLA VÀ THÔNG BÁO (PHASE 12)

### 8.1. Chuyển giao Người duyệt (Reassign Approver)
Cho phép chuyển giao công việc phê duyệt tại bước đang xử lý từ người duyệt cũ sang người duyệt mới mà không mở lại bước đã hoàn tất hoặc sửa quyết định đã có.

- **Endpoint:** `POST /api/documents/:id/reassign`
- **Quyền hạn:**
  - `SUPER_ADMIN` (toàn hệ thống), `ADMIN` cùng tổ chức với hồ sơ, hoặc chính người duyệt đang chờ trong bước hiện tại (`self-reassignment`).
  - Người dùng không có quyền bị từ chối `403 Forbidden`.
- **Ràng buộc nghiệp vụ:**
  - Hồ sơ phải ở trạng thái `IN_REVIEW`. Hồ sơ đã kết thúc (`APPROVED`, `REJECTED`, `CANCELLED`) bị chặn `400 Bad Request`.
  - Bước duyệt phải là bước hiện tại (`IN_PROGRESS`). Bước đã hoàn tất (`COMPLETED`, `SKIPPED`) bị từ chối `400 Bad Request`.
  - Chỉ thay thế người duyệt cũ có `decision === 'PENDING'`. Nếu người cũ đã quyết định (`APPROVED`, `REJECTED`, `REVISION_REQUESTED`), hệ thống chặn `400 Bad Request` để bảo toàn tính bất biến của lịch sử.
  - Người duyệt mới phải thuộc cùng tổ chức (`organizationId`), tài khoản phải đang kích hoạt (`isActive: true`), không trùng với người cũ và chưa được phân công trong bước đó.
  - Tuyệt đối không tự động chuyển trạng thái hồ sơ sang `APPROVED` khi chuyển giao.
  - Áp dụng khóa bi quan PostgreSQL `SELECT id FROM documents WHERE id = :id FOR UPDATE` để chống xung đột race condition.
- **Request Body DTO (`ReassignApproverDto`):**
```json
{
  "stepId": "step-uuid-optional",
  "oldUserId": "user-old-approver-id",
  "newUserId": "user-new-approver-id",
  "reason": "Cán bộ công tác nước ngoài đột xuất, chuyển giao trưởng phòng phó duyệt thay"
}
```
- **Response Thành Công (200 OK):**
```json
{
  "success": true,
  "data": {
    "success": true,
    "message": "Chuyển giao người duyệt thành công.",
    "documentId": "doc-uuid",
    "stepId": "step-uuid",
    "oldUserId": "user-old-id",
    "newUserId": "user-new-id"
  },
  "timestamp": "2026-10-23T10:00:00.000Z"
}
```
- **Lưu vết và Nhật ký:**
  - Tạo bản ghi `StepReassignmentHistory` lưu vết đầy đủ: `stepId`, `oldUserId`, `newUserId`, `reassignedById`, `reason`, `createdAt`.
  - Ghi bản ghi `AuditLog` với action `REASSIGN_APPROVER`.
  - Tự động sinh `Notification` In-App cho người duyệt mới (`REASSIGNED_STEP`) và người duyệt cũ.

---

### 8.2. SLA & Hạn Xử lý Hồ sơ
Hệ thống tính toán thời hạn xử lý cho từng bước duyệt và tổng thể hồ sơ dựa trên cấu hình `dueDays` của từng bước trong workflow template.

- **Thời điểm tính hạn (`dueDate`):** Được tính từ thời điểm bước bắt đầu kích hoạt (`startedAt + dueDays * 24h`).
- **Phân tách trạng thái SLA khỏi trạng thái nghiệp vụ:**
  - `slaStatus`: `'ON_TRACK'` (Còn nhiều thời gian), `'NEAR_DUE'` (Còn dưới 24h), `'OVERDUE'` (Đã quá hạn chót).
  - **Quy tắc cốt lõi:** Quá hạn SLA **tuyệt đối không coi là tự động phê duyệt** (`OVERDUE !== APPROVED`). Trạng thái nghiệp vụ của hồ sơ vẫn là `IN_REVIEW`.
- **Cập nhật trong Responses:**
  - `DocumentItem` & `DocumentDetail` bổ sung:
    - `dueDate`: ISO Date String hoặc `null`.
    - `isOverdue`: `boolean`.
    - `slaStatus`: `'ON_TRACK' | 'NEAR_DUE' | 'OVERDUE' | null`.
    - `reassignmentHistories`: Danh sách lịch sử chuyển giao người duyệt.
    - `permissions.canReassign`: `boolean` (cho biết user hiện tại có quyền reassign trên hồ sơ này hay không).
  - `WorkflowStepView` bổ sung:
    - `dueDate`: ISO Date String hoặc `null`.
    - `dueDays`: `number | null`.
    - `isOverdue`: `boolean`.

---

### 8.3. Hệ thống Thông báo Trong Ứng dụng (In-App Notifications)

Hệ thống thông báo nội bộ module hóa phục vụ gửi thông báo thời gian thực khi có sự kiện duyệt hoặc cảnh báo hạn xử lý.

#### ① Lấy danh sách thông báo của người dùng
- **Endpoint:** `GET /api/notifications`
- **Query Parameters:**
  - `isRead` (Tùy chọn): `true` (lọc đã đọc), `false` (lọc chưa đọc).
  - `page` (Tùy chọn, mặc định `1`): Số trang.
  - `limit` (Tùy chọn, mặc định `20`, tối đa `100`): Số lượng mỗi trang.
- **Response Thành Công (200 OK):**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "notif-uuid-1",
        "userId": "user-uuid",
        "documentId": "doc-uuid-1",
        "documentNumber": "TK-2026-0001",
        "documentTitle": "Giấy đề nghị tạm ứng công tác phí",
        "documentStatus": "IN_REVIEW",
        "type": "REASSIGNED_STEP",
        "title": "Bạn được chuyển giao duyệt hồ sơ",
        "content": "Bạn được chuyển giao duyệt hồ sơ \"Giấy đề nghị tạm ứng công tác phí\". Lý do: Cán bộ nghỉ phép",
        "isRead": false,
        "readAt": null,
        "metadata": { "oldUserId": "user-old-id", "reason": "Cán bộ nghỉ phép" },
        "createdAt": "2026-10-23T09:30:00.000Z"
      }
    ],
    "unreadCount": 1,
    "pagination": { "page": 1, "limit": 20, "total": 1 }
  },
  "timestamp": "2026-10-23T10:00:00.000Z"
}
```

#### ② Đếm số lượng thông báo chưa đọc
- **Endpoint:** `GET /api/notifications/unread-count`
- **Response Thành Công (200 OK):**
```json
{
  "success": true,
  "data": {
    "unreadCount": 3
  },
  "timestamp": "2026-10-23T10:00:00.000Z"
}
```

#### ③ Đánh dấu một thông báo đã đọc
- **Endpoint:** `PATCH /api/notifications/:id/read`
- **Response Thành Công (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "notif-uuid-1",
    "isRead": true,
    "readAt": "2026-10-23T10:02:00.000Z"
  },
  "timestamp": "2026-10-23T10:02:00.000Z"
}
```

#### ⑤ Thử lại việc gửi thông báo lỗi (Retry Failed Notifications) - Phase 12.0.2
- **Endpoint:** `POST /api/notifications/retry-failed`
- **Quyền hạn:** `ADMIN`, `SUPER_ADMIN`. Người dùng thường bị từ chối `403 Forbidden`.
- **Hành vi nghiệp vụ:** Quét các thông báo ở trạng thái `FAILED` hoặc `PENDING` có `retryCount < maxRetries` (mặc định 3). Sử dụng cơ chế khóa hàng `FOR UPDATE SKIP LOCKED` để đảm bảo an toàn tuyệt đối khi nhiều worker chạy đồng thời, không gửi lặp thông báo đã `SENT`.
- **Response Thành Công (200 OK):**
```json
{
  "success": true,
  "data": {
    "retriedCount": 2,
    "totalFailed": 2
  },
  "timestamp": "2026-10-23T10:05:00.000Z"
}
```

---

### 8.4. SLA Scheduler & Giám sát Tự động (Phase 12.0.1 & Phase 12.0.2)

Hệ thống cung cấp service quét định kỳ (mặc định mỗi 5 phút) và endpoint kích hoạt quét hoặc giám sát thời gian thực.

#### ① Kích hoạt quét SLA thủ công / Worker
- **Endpoint:** `POST /api/workflows/sla/trigger-check`
- **Quyền hạn & Cách ly Tổ chức (Tenant Isolation):**
  - `SUPER_ADMIN`: Kích hoạt quét trên phạm vi toàn hệ thống xuyên tổ chức.
  - `ADMIN` (Tenant Admin): **Chỉ kích hoạt quét các hồ sơ thuộc tổ chức của mình** (`targetOrgId = user.organizationId`). Tuyệt đối không quét hoặc gửi thông báo cho hồ sơ thuộc tổ chức khác.
  - `USER`: Bị từ chối `403 Forbidden`.
- **Response Thành Công (200 OK):**
```json
{
  "success": true,
  "data": {
    "scannedStepsCount": 12,
    "warningsSent": 2,
    "overduesSent": 1,
    "skippedAlreadySent": 9,
    "errorsCount": 0,
    "processedAt": "2026-10-23T10:30:00.000Z",
    "details": [
      {
        "stepId": "step-uuid-1",
        "stepName": "Trưởng phòng duyệt",
        "documentId": "doc-uuid-1",
        "documentNumber": "TK-2026-001",
        "type": "SLA_WARNING",
        "userId": "user-uuid-1",
        "idempotencyKey": "SLA_WARNING:step-uuid-1:user-uuid-1",
        "status": "SENT"
      }
    ]
  },
  "timestamp": "2026-10-23T10:30:00.000Z"
}
```

#### ② Truy vấn trạng thái giám sát SLA
- **Endpoint:** `GET /api/workflows/sla/status`
- **Quyền hạn:** `ADMIN`, `SUPER_ADMIN`. Người dùng thường (`USER`) bị từ chối `403 Forbidden`.
- **Cách ly Tổ chức (Tenant Isolation):** `ADMIN` chỉ xem số liệu tổng hợp trong phạm vi tổ chức của mình; `SUPER_ADMIN` xem số liệu toàn hệ thống.
- **Response Thành Công (200 OK):**
```json
{
  "success": true,
  "data": {
    "totalInReview": 24,
    "onTrackCount": 18,
    "nearDueCount": 4,
    "overdueCount": 2,
    "checkedAt": "2026-10-23T10:30:00.000Z"
  },
  "timestamp": "2026-10-23T10:30:00.000Z"
}
```

---

### 8.5. Cơ chế Idempotency Bền vững, Multi-Instance & Notification Reliability (Phase 12.0.2)

1. **Database-backed Idempotency:**
   - Mỗi thông báo hệ thống được gán một `idempotencyKey` duy nhất có ràng buộc `@unique` tại PostgreSQL.
   - Định dạng chuẩn:
     - Nhắc nhở sắp đến hạn: `SLA_WARNING:${stepId}:${userId}`
     - Cảnh báo quá hạn: `SLA_OVERDUE:${stepId}:${userId}`
     - Phân công duyệt: `ASSIGNED_STEP:${stepId}:${userId}`
     - Chuyển giao duyệt: `REASSIGNED_TO:${stepId}:${newUserId}:${historyId}`
   - Khi chạy lặp hoặc nhiều worker chạy đồng thời, PostgreSQL ngăn chặn tuyệt đối việc chèn trùng lặp; backend bắt mã lỗi `P2002` và xử lý an toàn dưới dạng `SKIPPED_DUPLICATE`.
2. **Khóa Hàng Bi quan (Row-Level Locking) & Chống Race Condition:**
   - Quá trình quét SLA khóa bước duyệt bằng `SELECT id FROM approval_steps WHERE id = :id FOR UPDATE`.
   - Nếu bước duyệt chuyển sang `COMPLETED`, `CANCELLED` hoặc `REJECTED` trong lúc chờ khóa, scheduler tự động bỏ qua, không gửi cảnh báo cho bước đã kết thúc.
3. **Bảo vệ Đa Instance & Chống Chồng lấn (Multi-Instance Distributed Safety):**
   - **In-Instance Overlap Guard:** Sử dụng cờ `isProcessing` ngăn một instance tự chạy lặp chồng chéo nếu chu kỳ trước chưa kết thúc.
   - **Multi-Instance Advisory Lock:** Áp dụng PostgreSQL Session Advisory Lock (`pg_try_advisory_lock(88421941)`) để đảm bảo trong môi trường nhiều pod/node, chỉ có đúng 1 instance thực hiện quét toàn hệ thống trong mỗi chu kỳ.
4. **Notification Retry Worker & Khôi phục sau Restart:**
   - Worker chạy nền tự động quét định kỳ các thông báo `FAILED` hoặc `PENDING` (còn sót lại sau server restart).
   - Sử dụng `FOR UPDATE SKIP LOCKED` trong transaction PostgreSQL để các worker chạy song song không tranh chấp dữ liệu và không xử lý trùng.
   - Cập nhật số lần thử lại (`retryCount`). Khi đạt ngưỡng `maxRetries` (mặc định 3), tự động dừng retry để tránh lặp vô hạn các lỗi không thể phục hồi.
   - Thông báo đã ở trạng thái `SENT` tuyệt đối không bao giờ bị gửi lại.
5. **Bảo mật Ranh giới Thông báo (Notification Security Boundary):**
   - Người dùng chỉ được phép truy vấn và đánh dấu đã đọc (`PATCH /api/notifications/:id/read`) đối với thông báo do chính mình sở hữu. Thao tác trên thông báo của người khác bị từ chối `403 Forbidden`.
   - Thông báo không tồn tại trả về `404 Not Found`.
   - Không chứa bất kỳ dữ liệu nhạy cảm hoặc nội dung chi tiết biểu mẫu (`formData`) nào trong payload thông báo.

---

## 9. ĐỘNG CƠ ỦY QUYỀN & TÍCH HỢP QUY TRÌNH DUYỆT (DELEGATION POLICY ENGINE)

### 9.1. Khái niệm & Ranh giới Nghiệp vụ
1. **Phân biệt rạch ròi giữa Delegation và Reassignment:**
   - **Reassignment (Chuyển giao):** Thay đổi trực tiếp người được phân công trong bước duyệt (`StepAssignee.userId`). Người cũ mất quyền duyệt, người mới trở thành người chịu trách nhiệm chính.
   - **Delegation (Ủy quyền có chính sách):** Không thay đổi `StepAssignee`. Ghế duyệt ban đầu vẫn thuộc về người ủy quyền (`delegatorId`), nhưng người nhận ủy quyền (`delegateeId`) được trao thẩm quyền thực hiện quyết định thay mặt trong phạm vi và thời gian xác định.
2. **Quy tắc Kiểm soát Chặt chẽ:**
   - **Tenant Isolation:** Cả delegator và delegatee bắt buộc phải thuộc cùng một tổ chức (`organizationId`).
   - **Chặn Tự ủy quyền (Self-Delegation):** Không cho phép `delegatorId === delegateeId`.
   - **Tài khoản Hoạt động:** Cả delegator và delegatee phải ở trạng thái kích hoạt (`isActive: true`).
   - **Kiểm tra Chu trình (Directed Cycle Detection):** Áp dụng thuật toán DFS ngăn chặn chu trình trực tiếp ($A \rightarrow B \rightarrow A$) và chu trình gián tiếp đa cấp ($A \rightarrow B \rightarrow C \rightarrow A$).
   - **Ranh giới Pháp lý:** Quyết định ủy quyền ghi nhận chính xác vết kiểm toán danh tính người thực hiện (actual actor) và căn cứ chính sách; không tự động tuyên bố chữ ký đại diện có giá trị pháp lý điện tử X.509 khi chưa qua phase chứng thư số chính thức.

---

### 9.2. Chi tiết các API Endpoint

#### ① Tạo chính sách ủy quyền mới
- **Endpoint:** `POST /api/delegations`
- **Quyền hạn:**
  - `USER`: Chỉ được tạo ủy quyền cho chính mình (`delegatorId === actorId`). Nếu gửi `delegatorId` của người khác sẽ bị từ chối `403 Forbidden`.
  - `ADMIN`: Được phép tạo ủy quyền thay mặt cho cán bộ trong cùng tổ chức.
  - `SUPER_ADMIN`: Được phép tạo ủy quyền trên toàn hệ thống.
- **Request Body (`CreateDelegationPolicyDto`):**
```json
{
  "delegatorId": "uuid-nguoi-uy-quyen-tuy-chon",
  "delegateeId": "uuid-nguoi-nhan-uy-quyen-bat-buoc",
  "startDate": "2026-10-24T00:00:00.000Z",
  "endDate": "2026-10-31T23:59:59.000Z",
  "scopeDepartmentId": "uuid-phong-ban-tuy-chon",
  "scopeTemplateId": "uuid-bieu-mau-tuy-chon",
  "reason": "Đi công tác nước ngoài"
}
```
- **Response Thành Công (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "policy-uuid-1",
    "organizationId": "org-uuid-1",
    "delegatorId": "user-a-uuid",
    "delegatorName": "Nguyễn Văn Giám Đốc A",
    "delegatorEmail": "director.a@alpha.com",
    "delegateeId": "user-b-uuid",
    "delegateeName": "Trần Thị Phó Giám Đốc B",
    "delegateeEmail": "deputy.b@alpha.com",
    "startDate": "2026-10-24T00:00:00.000Z",
    "endDate": "2026-10-31T23:59:59.000Z",
    "scopeDepartmentId": null,
    "scopeDepartmentName": null,
    "scopeTemplateId": "tpl-payment-uuid",
    "scopeTemplateTitle": "Giấy đề nghị thanh toán",
    "reason": "Đi công tác nước ngoài",
    "isActive": true,
    "createdById": "user-a-uuid",
    "createdByName": "Nguyễn Văn Giám Đốc A",
    "revokedAt": null,
    "revokedById": null,
    "createdAt": "2026-10-23T12:00:00.000Z",
    "updatedAt": "2026-10-23T12:00:00.000Z"
  },
  "timestamp": "2026-10-23T12:00:00.000Z"
}
```

#### ② Truy vấn danh sách chính sách ủy quyền
- **Endpoint:** `GET /api/delegations`
- **Query Params:**
  - `isActive`: `true` | `false` (Lọc theo trạng thái hiệu lực)
  - `role`: `'delegator'` | `'delegatee'` | `'all'` (Mặc định: `'all'`)
  - `organizationId`: string (Chỉ có hiệu lực đối với `SUPER_ADMIN`; đối với `USER` và `ADMIN`, backend luôn khóa chặt theo `actorOrgId`, client không thể tiêm nhiễm qua query param)
  - `page`: số trang (mặc định 1)
  - `limit`: số bản ghi trên trang (mặc định 20, tối đa 100)
- **Quyền hạn & Tenant Isolation (Phase 12.1.1 Audit):**
  - `USER`: Khóa chặt vào `organizationId` của chính mình. Dù truyền `role=all` hay không truyền, backend bắt buộc lọc `OR: [{ delegatorId: actorId }, { delegateeId: actorId }]`. Tuyệt đối không thể xem policy của người khác trong cùng tổ chức.
  - `ADMIN`: Khóa chặt vào `organizationId` được phân quyền quản lý. Bỏ qua mọi tham số `organizationId` do client gửi.
  - `SUPER_ADMIN`: Quyền truy cập toàn cầu, có thể lọc theo `organizationId` nếu được chỉ định.
- **Response Thành Công (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "policy-uuid-1",
      "delegatorName": "Nguyễn Văn Giám Đốc A",
      "delegateeName": "Trần Thị Phó Giám Đốc B",
      "startDate": "2026-10-24T00:00:00.000Z",
      "endDate": "2026-10-31T23:59:59.000Z",
      "isActive": true
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  },
  "timestamp": "2026-10-23T12:00:00.000Z"
}
```

#### ③ Xem chi tiết chính sách ủy quyền
- **Endpoint:** `GET /api/delegations/:id`
- **Quyền hạn:** `delegator`, `delegatee`, `ADMIN` của tổ chức sở hữu, hoặc `SUPER_ADMIN`. Người ngoài và user khác tổ chức bị chặn `403 Forbidden`.

#### ④ Cập nhật chính sách ủy quyền
- **Endpoint:** `PATCH /api/delegations/:id`
- **Request Body (`UpdateDelegationPolicyDto`):**
```json
{
  "endDate": "2026-11-05T23:59:59.000Z",
  "reason": "Gia hạn thêm do chuyến công tác kéo dài",
  "scopeDepartmentId": null,
  "scopeTemplateId": null
}
```
- **Ràng buộc & Kiểm soát Tương tranh (Phase 12.1.1):**
  - Thực thi trong transaction với PostgreSQL Advisory Lock theo tổ chức: `pg_advisory_xact_lock(hashtext('delegation_org_' || organizationId)::bigint)`.
  - Khóa bi quan hàng policy (`FOR UPDATE`) để ngăn chặn xung đột với `revokePolicy`.
  - Chạy lại thuật toán phát hiện chu trình phụ thuộc thời gian (Temporal Cycle Detection) nếu kéo dài `endDate` hoặc thay đổi phạm vi.
  - Không được sửa chính sách đã bị thu hồi (`isActive: false`) hoặc đã quá hạn (`endDate <= now`).

#### ⑤ Thu hồi chính sách ủy quyền (Soft Revoke)
- **Endpoint:** `POST /api/delegations/:id/revoke`
- **Quyền hạn:** Delegator, Admin cùng công ty, hoặc Super Admin.
- **Request Body:** `{ "reason": "Chuyến công tác kết thúc sớm" }`
- **Cơ chế Khóa Bi quan (Pessimistic Row Lock):**
  - Thực thi trong transaction và khóa hàng policy bằng `SELECT id FROM delegation_policies WHERE id = $1 FOR UPDATE`.
  - Chuyển `isActive = false`, ghi nhận `revokedAt`, `revokedById`, ghi `AuditLog` và gửi `Notification` in-app cho người nhận ủy quyền.

---

### 9.3. Động cơ Giải quyết Chính sách (Policy Resolution Engine)
Khi người dùng gọi `POST /api/documents/:id/decision`:
1. Nếu `userId` từ JWT trùng với một `StepAssignee` đang ở trạng thái `PENDING`: Xử lý phê duyệt trực tiếp thông thường (`isDelegated: false`).
2. Nếu `userId` không phải là assignee trực tiếp:
   - Hệ thống quét các chính sách đang hiệu lực (`isActive: true`, `startDate <= now <= endDate`) trong cùng `organizationId` nối từ các pending approver tới `userId`.
   - **Quy tắc Tính Điểm Ưu tiên Cụ thể (Specificity Score):**
     - **3 điểm:** Khớp cả `scopeTemplateId` và `scopeDepartmentId`.
     - **2 điểm:** Khớp `scopeTemplateId`.
     - **1 điểm:** Khớp `scopeDepartmentId`.
     - **0 điểm:** Toàn tổ chức (cả 2 scope đều null).
   - **Deterministic Tie-breaking (Phase 12.1.1 Audit):**
     - Tiêu chí 1: Điểm Specificity Score giảm dần.
     - Tiêu chí 2: `createdAt` mới nhất.
     - Tiêu chí 3: Nếu cả `score` và `createdAt` bằng nhau tuyệt đối, tie-break bằng `id` (`b.policy.id.localeCompare(a.policy.id)`). Đảm bảo 100% tất định (không chọn ngẫu nhiên).
3. **Phối hợp Tương tranh Revoke vs Approve (Phase 12.1.1):**
   - Khi áp dụng ủy quyền, transaction phê duyệt khóa hàng policy tương ứng bằng `SELECT id, "isActive", "startDate", "endDate" FROM delegation_policies WHERE id = $1 FOR UPDATE`.
   - Nếu transaction `revokePolicy` đã đi trước và cam kết `isActive = false`: Phê duyệt bị từ chối ngay lập tức với `403 Forbidden` (`Chính sách ủy quyền đã bị thu hồi hoặc hết thời hạn hiệu lực trong quá trình xử lý.`).
   - Nếu transaction `processAssigneeDecision` đi trước: Phê duyệt được ghi nhận hợp lệ, đầy đủ attribution. Sau đó transaction `revokePolicy` mới thu hồi chính sách cho các tài liệu về sau.
   - Tránh hoàn toàn race condition và không có nguy cơ deadlock do thứ tự khóa được chuẩn hóa (Document $\rightarrow$ Policy).
4. **Attribution & Audit Trail:**
   - Cập nhật quyết định của ghế duyệt ban đầu (`targetAssignee`) trong FSM, bảo toàn hoàn toàn completion rule và transition state.
   - Bản ghi `StepDecisionHistory` lưu:
     - `userId`: ID của người thực tế bấm duyệt (actual actor).
     - `isDelegated`: `true`.
     - `delegatedFromUserId`: ID của người ủy quyền ban đầu.
     - `delegationPolicyId`: ID chính sách đã áp dụng.
   - Bản ghi `SignatureEvent` gắn chữ ký điện tử thực tế của actual actor (chữ ký ảnh / audit trail, không giả định là chữ ký số PKI cryptographic signing - tính năng ký số PKI thuộc Phase 13).
   - Bản ghi `AuditLog` lưu chi tiết ủy quyền và gửi thông báo in-app cho người ủy quyền biết hành động đã được thực hiện thay mặt mình.

---

### 9.4. Thuật toán Phát hiện Chu trình Phụ thuộc Thời gian (Temporal Cycle Detection)
- Chu trình có hướng $e_1 \rightarrow e_2 \rightarrow \ldots \rightarrow e_k$ chỉ thực sự tồn tại nếu khoảng thời gian giao thoa của toàn bộ các cạnh dọc theo chu trình là **khác rỗng**:
  $$\bigcap_{i=1}^k [start_i, end_i] \ne \emptyset \iff \max(start_i) \le \min(end_i)$$
- **Thuật toán DFS:**
  - Khởi tạo cửa sổ giao thoa ban đầu $[S_{\text{accum}}, E_{\text{accum}}] = [S_{\text{new}}, E_{\text{new}}]$ cho cạnh đề xuất $u \rightarrow v$.
  - Duyệt DFS từ $v$ tìm đường về $u$.
  - Tại mỗi cạnh $p$: Tính $[S', E'] = [\max(S_{\text{accum}}, S_p), \min(E_{\text{accum}}, E_p)]$. Nếu $S' > E'$, cắt nhánh (prune) vì không có giao thoa thời gian đồng thời.
  - Nếu đến được $u$ với $S' \le E'$, phát hiện chu trình đồng thời thực sự và từ chối `400 Bad Request`.
- **Loại trừ chính sách không tạo chu trình:**
  - Chính sách đã bị thu hồi (`isActive: false`).
  - Chính sách ngoài khoảng thời gian hiệu lực.
  - Chính sách thuộc các tổ chức khác nhau (Tenant Isolation).
  - Các đường đi khép kín nhưng có thời điểm hiệu lực rời rạc (Disjoint temporal windows) được phép tạo bình thường, không bị false positive.

---

## 10. CHUẨN API KẾT XUẤT PDF, LƯU TRỮ ARTIFACT VÀ KÝ SỐ MẬT MÃ (PHASE 13)

Phần này quy định các giao ước API phục vụ việc kết xuất PDF từ snapshot phiên bản, lưu trữ an toàn đa doanh nghiệp (Phase 13.1), và ký số mật mã PAdES CMS Detached Signature, xác minh tính toàn vẹn độc lập (Phases 13.2 - 13.4).

### 10.1. Khởi tạo kết xuất PDF Artifact từ DocumentVersion (Phase 13.1)
- **Endpoint:** `POST /api/documents/:id/render-pdf`
- **Mục đích:** Kết xuất tệp PDF A4 chuẩn tiếng Việt từ snapshot dữ liệu biểu mẫu bất biến (`DocumentVersion.formData`) kết hợp định nghĩa biểu mẫu (`FormTemplateVersion.fields`), tính toán mã băm SHA-256 trên byte nhị phân thực tế (`rawPdfHash`) và lưu trữ tệp an toàn ngoài public root.
- **Quyền hạn (Authorization):**
  - Người dùng (`USER`, `ADMIN`) thuộc cùng tổ chức (`organizationId`) có quyền xem tài liệu, hoặc `SUPER_ADMIN`.
  - Chặn `403 FORBIDDEN` nếu truy cập tài liệu thuộc tổ chức khác (Tenant Isolation).
- **Request Body (JSON):**
  ```json
  {
    "versionNumber": 1,
    "artifactType": "OFFICIAL_UNSIGNED"
  }
  ```
  *(Các trường đều là tùy chọn. Mặc định `versionNumber` là phiên bản hiện tại của tài liệu; `artifactType` là `PREVIEW` nếu tài liệu đang nháp/xét duyệt, hoặc `OFFICIAL_UNSIGNED` nếu đã `APPROVED`).*
- **Xử lý tương tranh & Idempotency:**
  - Sử dụng PostgreSQL Advisory Lock theo `documentId` để tuần tự hóa các yêu cầu kết xuất đồng thời.
  - Áp dụng unique constraint `[documentId, documentVersionId, artifactType]`. Nếu artifact của phiên bản tương ứng đã ở trạng thái `COMPLETED` và tệp nhị phân còn tồn tại trên đĩa, hệ thống trả về ngay bản ghi có sẵn mà không thực hiện kết xuất lại.
- **Response Thành công (HTTP 200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "id": "d98cb3da-7159-4d2c-8ba2-f2b95624efc7",
      "documentId": "1ef266c5-1f5d-4c62-8ee0-15ca8ea90110",
      "documentVersionId": "7a8b9c0d-1e2f-3a4b-5c6d-7e8f9a0b1c2d",
      "artifactType": "OFFICIAL_UNSIGNED",
      "status": "COMPLETED",
      "mimeType": "application/pdf",
      "sizeBytes": 1099934,
      "rawPdfHash": "b55737ce744b91ba2806faeaee85a426cc017032d9e352d543e33603f78eb5e4",
      "formDataHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "processingTimeMs": 284,
      "createdAt": "2026-10-24T01:46:00.000Z",
      "downloadUrl": "/api/documents/1ef266c5-1f5d-4c62-8ee0-15ca8ea90110/pdf?version=1&type=OFFICIAL_UNSIGNED"
    }
  }
  ```

---

### 10.2. Tra cứu trạng thái kết xuất PDF Artifact (Phase 13.1)
- **Endpoint:** `GET /api/documents/:id/render-status`
- **Query Parameters:**
  - `versionNumber` (tùy chọn): Phiên bản tài liệu muốn tra cứu (mặc định là phiên bản hiện tại).
  - `artifactType` (tùy chọn): `PREVIEW` | `OFFICIAL_UNSIGNED`
- **Quyền hạn:** Cùng tổ chức sở hữu tài liệu, hoặc `SUPER_ADMIN`.
- **Response Thành công (HTTP 200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "documentId": "1ef266c5-1f5d-4c62-8ee0-15ca8ea90110",
      "versionNumber": 1,
      "artifact": {
        "id": "d98cb3da-7159-4d2c-8ba2-f2b95624efc7",
        "artifactType": "OFFICIAL_UNSIGNED",
        "status": "COMPLETED",
        "rawPdfHash": "b55737ce744b91ba2806faeaee85a426cc017032d9e352d543e33603f78eb5e4",
        "sizeBytes": 1099934,
        "createdAt": "2026-10-24T01:46:00.000Z"
      }
    }
  }
  ```

---

### 10.3. Tải tệp PDF nhị phân bảo mật (Secure Download - Phase 13.1)
- **Endpoint:** `GET /api/documents/:id/pdf`
- **Query Parameters:**
  - `versionNumber` (tùy chọn): Phiên bản tài liệu (mặc định lấy phiên bản hiện tại).
  - `artifactType` (tùy chọn): `PREVIEW` | `OFFICIAL_UNSIGNED`
- **Quyền hạn:** Thành viên cùng tổ chức sở hữu tài liệu, hoặc `SUPER_ADMIN`.
- **Response Headers:**
  - `Content-Type: application/pdf`
  - `Content-Disposition: inline; filename="TK-2026-1059-619_v1_OFFICIAL_UNSIGNED.pdf"`
  - `Content-Length: 1099934`
  - `X-Raw-Pdf-Hash: b55737ce744b91ba2806faeaee85a426cc017032d9e352d543e33603f78eb5e4`
  - `Cache-Control: private, no-transform, max-age=1800`
- **Response Body:** Luồng nhị phân (Binary Stream) với magic bytes `%PDF-`.

---

### 10.4. Danh sách các Artifacts của tài liệu (Phase 13.1)
- **Endpoint:** `GET /api/documents/:id/artifacts`
- **Quyền hạn:** Thành viên cùng tổ chức sở hữu tài liệu, hoặc `SUPER_ADMIN`.
- **Response Thành công (HTTP 200 OK):**
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "d98cb3da-7159-4d2c-8ba2-f2b95624efc7",
        "documentId": "1ef266c5-1f5d-4c62-8ee0-15ca8ea90110",
        "documentVersionId": "7a8b9c0d-1e2f-3a4b-5c6d-7e8f9a0b1c2d",
        "versionNumber": 1,
        "artifactType": "OFFICIAL_UNSIGNED",
        "status": "COMPLETED",
        "mimeType": "application/pdf",
        "sizeBytes": 1099934,
        "rawPdfHash": "b55737ce744b91ba2806faeaee85a426cc017032d9e352d543e33603f78eb5e4",
        "formDataHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "processingTimeMs": 284,
        "createdAt": "2026-10-24T01:46:00.000Z",
        "downloadUrl": "/api/documents/1ef266c5-1f5d-4c62-8ee0-15ca8ea90110/pdf?version=1&type=OFFICIAL_UNSIGNED"
      }
    ]
  }
  ```

---

### 10.5. Khởi tạo yêu cầu ký số tài liệu (Phase 13.2 - Kế hoạch)
- **Endpoint:** `POST /api/documents/:id/sign`
- **Mục đích:** Thực hiện ký số mật mã PAdES trên tệp PDF của tài liệu.
- **Quyền hạn (Authorization):**
  - Người dùng (`USER`) hiện là người duyệt hợp lệ của bước hiện tại (`IN_PROGRESS`), HOẶC người nhận ủy quyền hợp lệ (`isDelegated = true`), HOẶC `ADMIN` cùng công ty (ký niêm phong tài liệu đã `APPROVED`).
  - Bị chặn `403 FORBIDDEN` nếu tài liệu thuộc công ty khác (`tenant isolation`).
- **Headers:**
  - `Authorization: Bearer <JWT>`
  - `Idempotency-Key: <UUID>` (Khuyến nghị để chống gửi lại yêu cầu ký)
- **Request Body:**
  ```json
  {
    "stepId": "0e1c2a3b-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
    "certificateId": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
    "signatureType": "CRYPTOGRAPHIC_PADES",
    "visualSignaturePlacement": {
      "page": 1,
      "x": 350,
      "y": 150,
      "width": 120,
      "height": 50,
      "imageUrl": "/signatures/userA.png"
    },
    "reason": "Phê duyệt tờ trình mua sắm máy tính làm việc"
  }
  ```
- **Xử lý tương tranh & Idempotency:**
  - Áp dụng PostgreSQL Transaction Advisory Lock theo `documentId` để tuần tự hóa các thao tác ký đồng thời.
  - Kiểm tra trạng thái bước và phiên bản tài liệu. Nếu tài liệu đã được ký trước đó với cùng `idempotencyKey`, trả về ngay kết quả đã lưu mà không ký lặp.
- **Response Thành công (HTTP 200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "artifactId": "9f8e7d6c-5b4a-3f2e-1d0c-9b8a7f6e5d4c",
      "documentId": "11111111-2222-3333-4444-555555555555",
      "versionNumber": 1,
      "stepId": "0e1c2a3b-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
      "signer": {
        "userId": "00000000-0000-0000-0000-000000000001",
        "fullName": "Nguyễn Văn A",
        "isDelegated": false,
        "delegatedFromUserId": null
      },
      "certificate": {
        "id": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
        "subjectDn": "CN=Nguyễn Văn A, O=Tập đoàn VinaGroup, C=VN",
        "serialNumber": "5F3A89BC1200E4"
      },
      "hashes": {
        "formDataHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "rawPdfHash": "c2b1a09876543210fedcba9876543210abcdef0123456789abcdef0123456789",
        "signedPdfHash": "a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4"
      },
      "signedAt": "2026-10-25T10:00:00.000Z",
      "downloadUrl": "/api/documents/11111111-2222-3333-4444-555555555555/signed-pdf"
    },
    "timestamp": "2026-10-25T10:00:00.500Z"
  }
  ```
- **Mã lỗi thường gặp:**
  - `400 VALIDATION_ERROR`: Chứng thư không thuộc về người dùng, chứng thư hết hạn hoặc bị thu hồi.
  - `403 FORBIDDEN`: Không có quyền duyệt bước này, hoặc ủy quyền đã bị thu hồi trong lúc xử lý.
  - `404 DOCUMENT_NOT_FOUND`: Tài liệu không tồn tại.
  - `409 CONFLICT`: Bước đã hoàn thành từ trước, hoặc tài liệu đang ở trạng thái không cho phép ký.

---

### 10.2. Tra cứu trạng thái ký số của tài liệu
- **Endpoint:** `GET /api/documents/:id/sign-status`
- **Quyền hạn:** Người dùng trong cùng tổ chức (`organizationId`), hoặc `SUPER_ADMIN`.
- **Response (HTTP 200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "documentId": "11111111-2222-3333-4444-555555555555",
      "status": "APPROVED",
      "currentVersion": 1,
      "isFullySigned": true,
      "signatures": [
        {
          "artifactId": "9f8e7d6c-5b4a-3f2e-1d0c-9b8a7f6e5d4c",
          "stepOrder": 1,
          "stepName": "Trưởng phòng xem xét",
          "signedBy": "Nguyễn Văn A",
          "isDelegated": false,
          "signedAt": "2026-10-25T09:30:00.000Z",
          "certificateSubject": "CN=Nguyễn Văn A, O=Tập đoàn VinaGroup, C=VN",
          "signedPdfHash": "a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4"
        }
      ],
      "latestSignedPdfUrl": "/api/documents/11111111-2222-3333-4444-555555555555/signed-pdf"
    }
  }
  ```

---

### 10.3. Tải tệp PDF đã ký (Secure Download)
- **Endpoint:** `GET /api/documents/:id/signed-pdf`
- **Query Parameters:**
  - `version` (tùy chọn, mặc định lấy phiên bản ký mới nhất)
- **Quyền hạn:** Mọi thành viên cùng tổ chức có quyền xem tài liệu, hoặc `SUPER_ADMIN`.
- **Response Headers:**
  - `Content-Type: application/pdf`
  - `Content-Disposition: attachment; filename="Document_001_signed.pdf"`
  - `X-Signed-Pdf-Hash: a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4`
  - `Cache-Control: private, no-transform, max-age=3600`
- **Response Body:** Nhị phân (Binary Stream) của tệp PDF.

---

### 10.4. Xác minh chữ ký số của một tệp PDF (Independent Verification)
- **Endpoint:** `POST /api/verify/pdf`
- **Quyền hạn:** Công khai (Public - Không bắt buộc Bearer Token).
- **Content-Type:** `multipart/form-data`
- **Form Field:** `file: <binary_pdf>`
- **Xử lý kỹ thuật:**
  - Backend phân tích các bảng `/ByteRange` trong tệp PDF.
  - Tính mã băm SHA-256 trên các byte nhị phân được chỉ định.
  - Trích xuất chữ ký số CMS từ `/Contents` và giải mã digest bằng khóa công khai của chứng thư số nhúng trong tệp.
  - Kiểm tra tính nguyên vẹn: So khớp digest tính toán với digest giải mã.
  - Phân tích chuỗi chứng thư số và thời hạn hiệu lực.
- **Response Thành công (HTTP 200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "fileName": "Document_001_signed.pdf",
      "fileSizeBytes": 245820,
      "sha256Hash": "a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4",
      "signaturesCount": 1,
      "isTampered": false,
      "signatures": [
        {
          "signatureName": "Signature_Step1",
          "signerSubject": "CN=Nguyễn Văn A, O=Tập đoàn VinaGroup, C=VN",
          "issuer": "CN=VinaGroup Internal Root CA, O=VinaGroup",
          "serialNumber": "5F3A89BC1200E4",
          "signingTime": "2026-10-25T10:00:00.000Z",
          "isDigestValid": true,
          "isCertificateValid": true,
          "certificateStatus": "ACTIVE",
          "hasTrustedTimestamp": false,
          "byteRange": [0, 84320, 100704, 145116]
        }
      ],
      "overallStatus": "VALID"
    }
  }
  ```
- **Trường hợp tệp bị sửa đổi sau khi ký (Tampered File):**
  ```json
  {
    "success": true,
    "data": {
      "fileName": "Document_001_tampered.pdf",
      "signaturesCount": 1,
      "isTampered": true,
      "signatures": [
        {
          "signatureName": "Signature_Step1",
          "isDigestValid": false,
          "errorMessage": "Mã băm ByteRange không khớp với giá trị giải mã từ chữ ký số. Tệp đã bị can thiệp trái phép sau khi ký."
        }
      ],
      "overallStatus": "TAMPERED"
    }
  }
  ```

---

### 10.5. Đăng ký chứng thư số công khai (Register Digital Certificate)
- **Endpoint:** `POST /api/certificates`
- **Quyền hạn:** `ADMIN` (đăng ký cho nhân viên/tổ chức thuộc công ty mình), `SUPER_ADMIN` (toàn quyền). `USER` thường bị từ chối 403 Forbidden.
- **Request Body:**
  ```json
  {
    "userId": "00000000-0000-0000-0000-000000000001",
    "certificatePem": "-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIU...\n-----END CERTIFICATE-----",
    "keyAlias": "dev_key_alias_user_1",
    "keyStorageType": "DEV_KEYSTORE"
  }
  ```
  *(Ghi chú: `keyStorageType` có thể là `DEV_KEYSTORE`, `CLOUD_KMS`, hoặc `REMOTE_SMART_CA`. Nếu là chứng thư đại diện tổ chức thì bỏ qua `userId`).*
- **Response Thành công (HTTP 201 Created):**
  ```json
  {
    "success": true,
    "data": {
      "id": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
      "organizationId": "org-uuid-vina",
      "userId": "00000000-0000-0000-0000-000000000001",
      "userFullName": "Nguyễn Văn A",
      "fingerprintSha256": "4b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c",
      "serialNumber": "5f3a89bc1200e4",
      "subjectDn": "CN=Nguyễn Văn A, O=Tập đoàn VinaGroup, C=VN",
      "issuerDn": "CN=VinaGroup Internal Root CA, O=VinaGroup",
      "validFrom": "2026-01-01T00:00:00.000Z",
      "validTo": "2027-01-01T00:00:00.000Z",
      "status": "ACTIVE",
      "keyStorageType": "DEV_KEYSTORE",
      "keyAlias": "dev_key_alias_user_1",
      "createdAt": "2026-10-24T10:00:00.000Z",
      "updatedAt": "2026-10-24T10:00:00.000Z"
    }
  }
  ```

---

### 10.6. Tra cứu danh mục chứng thư số (List Certificates)
- **Endpoint:** `GET /api/certificates`
- **Query Parameters:**
  - `status`: `ACTIVE` | `REVOKED` | `EXPIRED` | `all` (Mặc định: `ACTIVE`)
  - `type`: `PERSONAL` | `ORGANIZATION` | `all` (Mặc định: `all`)
- **Quyền hạn:**
  - `USER`: Chỉ xem các chứng thư cá nhân gán cho chính mình (`userId === currentUser.id`) trong cùng tổ chức.
  - `ADMIN`: Xem toàn bộ chứng thư thuộc công ty mình quản lý.
  - `SUPER_ADMIN`: Xem danh mục chứng thư toàn hệ thống.
- **Response (HTTP 200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "items": [
        {
          "id": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
          "subjectDn": "CN=Nguyễn Văn A, O=Tập đoàn VinaGroup, C=VN",
          "issuerDn": "CN=VinaGroup Internal Root CA, O=VinaGroup",
          "serialNumber": "5f3a89bc1200e4",
          "fingerprintSha256": "4b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c",
          "validFrom": "2026-01-01T00:00:00.000Z",
          "validTo": "2027-01-01T00:00:00.000Z",
          "status": "ACTIVE",
          "keyStorageType": "DEV_KEYSTORE",
          "keyAlias": "dev_key_alias_user_1",
          "userId": "00000000-0000-0000-0000-000000000001",
          "userFullName": "Nguyễn Văn A"
        }
      ]
    }
  }
  ```

---

### 10.7. Xem chi tiết chứng thư số (Get Certificate Detail)
- **Endpoint:** `GET /api/certificates/:id`
- **Quyền hạn:** Tương tự danh mục (`USER` chỉ xem cert cá nhân của mình; `ADMIN` xem cert cùng tổ chức; `SUPER_ADMIN` xem toàn bộ).
- **Response (HTTP 200 OK):** Trả về đầy đủ metadata bao gồm cả `certificatePem` (khóa công khai) nhưng KHÔNG BAO GIỜ trả khóa riêng hoặc mật khẩu.

---

### 10.8. Cập nhật trạng thái / Thu hồi chứng thư số (Revoke Certificate)
- **Endpoint:** `PATCH /api/certificates/:id/status`
- **Quyền hạn:** `ADMIN` hoặc `SUPER_ADMIN`.
- **Request Body:**
  ```json
  {
    "status": "REVOKED",
    "reason": "Khóa riêng bị nghi ngờ lộ hoặc nhân viên đã thôi việc"
  }
  ```
- **Response Thành công (HTTP 200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "id": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
      "status": "REVOKED",
      "revokedReason": "Khóa riêng bị nghi ngờ lộ hoặc nhân viên đã thôi việc",
      "revokedAt": "2026-10-24T10:15:00.000Z"
    }
  }
  ```

---

### 10.9. Thử nghiệm ký số và đối soát chữ ký X.509 (Test Sign & Verify)
- **Endpoint:** `POST /api/certificates/:id/test-sign`
- **Mục đích:** Kiểm tra tính sẵn sàng hoạt động của Keystore/KMS và đối soát chữ ký tạo ra với khóa công khai trong chứng thư số. Tuyệt đối không phục vụ ký ban hành văn bản.
- **Quyền hạn:** Chỉ chính chủ sở hữu chứng thư cá nhân (`userId === currentUser.id`) hoặc `ADMIN`/`SUPER_ADMIN` đối với chứng thư tổ chức. Chặn triệt để hành vi ký mạo danh hoặc xuyên tổ chức (403 Forbidden). Chặn ký nếu chứng thư đã bị thu hồi `REVOKED` (400 Bad Request).
- **Response Thành công (HTTP 200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "certificateId": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
      "keyAlias": "dev_key_alias_user_1",
      "algorithm": "RSASSA_PKCS1_v1_5_SHA256",
      "dataSignatureLength": 256,
      "dataSignatureValid": true,
      "digestSignatureLength": 256,
      "digestSignatureValid": true,
      "message": "Kiểm thử ký dữ liệu thô và 32-byte SHA-256 digest thành công 100% với khóa công khai X.509."
    }
  }
  ```

---

### 10.10. Ký số PDF mật mã bằng CMS Detached (Phase 13.2.2 & 13.3.1 — Sign Document PDF)
- **Endpoint:** `POST /api/documents/:id/sign`
- **Mục đích:** Thực hiện quy trình ký số PDF mật mã chuẩn ISO 32000-1 / RFC 5652 / RFC 3161:
  1. Kiểm tra tài liệu và phân quyền Tenant (chặn 403 Forbidden nếu khác Tenant).
  2. Nạp bản ghi PDF chưa ký `OFFICIAL_UNSIGNED` từ hệ thống lưu trữ an toàn ngoài web root.
  3. Lấy chứng thư số hợp lệ của người ký (`ACTIVE`, còn hạn, người dùng có quyền sử dụng).
  4. Tạo cấu trúc PDF Signature Dictionary (`/Type /Sig`, `/Filter /Adobe.PPKLite`, `/SubFilter /adbe.pkcs7.detached`).
  5. Thiết lập `/ByteRange [offset1, len1, offset2, len2]` và vùng đệm nhị phân CMS DER (`/Contents <hex>`).
  6. Trích xuất chính xác 2 đoạn byte trong `/ByteRange` và băm SHA-256 (32 bytes).
  7. Dựng CMS Detached DER với `SignerInfo`, `contentType`, `signingTime`, `messageDigest` = SHA-256 của ByteRange, gọi `ISigningKeyProvider.signDigest`.
  8. Nếu `requireTimestamp: true`: Gửi SHA-256 của chữ ký người ký (`SignerInfo.signatureValue`) tới máy chủ RFC 3161 TSA, xác minh chữ ký TSA và EKU `id-kp-timeStamping`, nhúng `TimeStampToken` vào `SignerInfo.unsignedAttrs` dưới OID `1.2.840.113549.1.9.16.2.14` (`id-aa-signatureTimeStampToken`).
  9. Nhúng CMS hex vào vị trí `/Contents`, xác minh lại độc lập tính toàn vẹn, chữ ký RSA và TimeStampToken trước khi lưu trữ (Fail-closed verification).
  10. Lưu trữ tệp PDF đã ký vào Storage Service và tạo bản ghi `DocumentArtifact` kiểu `SIGNED_PDF` với `signedPdfHash`, `hasTimestamp`, `timestampGenTime`, `tsaSubject`.
  11. **Bảo toàn tệp gốc:** Bản ghi và tệp nhị phân `OFFICIAL_UNSIGNED` không bao giờ bị ghi đè.
- **Quyền hạn:** `USER` (thuộc cùng tổ chức sở hữu tài liệu), `ADMIN`, `SUPER_ADMIN`.
- **Request Body:**
  ```json
  {
    "certificateId": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
    "versionNumber": 1,
    "reason": "Phê duyệt quyết toán hợp đồng công nghệ 2026",
    "location": "Hà Nội, Việt Nam",
    "contactInfo": "nguyenvana@vinagroup.vn",
    "requireTimestamp": true
  }
  ```
- **Response Thành công (HTTP 200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "artifactId": "uuid-signed-artifact-id",
      "documentId": "uuid-document-id",
      "documentVersionId": "uuid-doc-version-id",
      "status": "COMPLETED",
      "signedPdfHash": "853ea2f977426aef...",
      "rawPdfHash": "726326844122a24b...",
      "formDataHash": "add0c77b03ccefe9...",
      "sizeBytes": 1182093,
      "byteRange": [0, 1164653, 1181039, 1052],
      "signerSubject": "CN=Nguyễn Văn A, O=Tập đoàn VinaGroup, C=VN",
      "signerIssuer": "CN=VinaGroup Internal Root CA, O=VinaGroup",
      "signingTime": "2026-10-24T09:34:12.000Z",
      "hasTimestamp": true,
      "timestampGenTime": "2026-10-24T09:34:12.500Z",
      "tsaSubject": "CN=Trinh Ky Online Trusted TSA 2026, O=Trinh Ky Online PKI Root Lab, C=VN",
      "isSignatureVerified": true,
      "downloadUrl": "/api/documents/uuid-document-id/pdf?type=SIGNED_PDF"
    },
    "timestamp": "2026-10-24T09:34:12.600Z"
  }
  ```

---

### 10.11. Xác minh độc lập chữ ký số PDF & Timestamp Token (Phase 13.2.2 & 13.3.1 — Verify PDF Signature)
- **Endpoint:** `GET /api/documents/:id/verify-signature`
- **Query Parameters:** `version` (tùy chọn, mặc định là phiên bản hiện tại).
- **Mục đích:** Đọc tệp PDF đã ký từ kho lưu trữ, phân tích cấu trúc `/ByteRange`, trích xuất CMS Signature DER, kiểm tra toàn vẹn mã băm `messageDigest` so với nội dung byte vật lý, xác minh chữ ký RSA của `SignerInfo`, và thẩm định độc lập TimeStampToken RFC 3161 trong `unsignedAttrs` (PAdES B-T verification).
- **Quyền hạn:** `USER` (cùng tổ chức), `ADMIN`, `SUPER_ADMIN`. Chặn 403 Forbidden nếu khác Tenant.
- **Response Thành công (HTTP 200 OK — Kèm Dấu thời gian tin cậy):**
  ```json
  {
    "success": true,
    "data": {
      "isValid": true,
      "isDigestValid": true,
      "isSignatureValid": true,
      "isTampered": false,
      "hasTimestamp": true,
      "isTimestampValid": true,
      "timestampGenTime": "2026-10-24T09:34:12.500Z",
      "tsaSubject": "CN=Trinh Ky Online Trusted TSA 2026, O=Trinh Ky Online PKI Root Lab, C=VN",
      "tsaIssuer": "CN=Trinh Ky Online PKI Root CA, C=VN",
      "tsaSerialNumber": "020CE31D0764846157",
      "tsaPolicyOid": "1.3.6.1.4.1.61498.1.1",
      "signerSubject": "CN=Nguyễn Văn A, O=Tập đoàn VinaGroup, C=VN",
      "signerIssuer": "CN=VinaGroup Internal Root CA, O=VinaGroup",
      "serialNumber": "5f3a89bc1200e4",
      "signingTime": "2026-10-24T09:34:12.000Z",
      "byteRange": [0, 1164653, 1181039, 1052],
      "messageDigestHex": "a1b2c3d4...",
      "computedDigestHex": "a1b2c3d4..."
    },
    "timestamp": "2026-10-24T09:34:15.000Z"
  }
  ```
- **Response khi tệp bị can thiệp / Tampered:**
  ```json
  {
    "success": true,
    "data": {
      "isValid": false,
      "isDigestValid": false,
      "isSignatureValid": false,
      "isTampered": true,
      "hasTimestamp": false,
      "errorMessage": "Mã băm dữ liệu ByteRange không khớp với giá trị messageDigest trong chữ ký số. Tệp PDF đã bị can thiệp trái phép sau khi ký (Document Tampered)."
    }
  }
  ```

---

### 10.12. Tải tệp PDF đã ký số (Phase 13.2.2 — Download Signed PDF)
- **Endpoint:** `GET /api/documents/:id/signed-pdf`
- **Query Parameters:** `version` (tùy chọn, mặc định là phiên bản hiện tại).
- **Quyền hạn:** Kiểm soát phân quyền Tenant chặt chẽ (chặn 403 Forbidden đối với người dùng tổ chức khác).
- **Headers trả về:**
  - `Content-Type`: `application/pdf`
  - `Content-Disposition`: `inline; filename="{docNumber}_v{version}_signed.pdf"`
  - `X-Raw-Pdf-Hash`: SHA-256 của PDF gốc chưa ký
  - `X-Signed-Pdf-Hash`: SHA-256 của toàn bộ tệp PDF đã ký
  - `X-Artifact-Id`: UUID của artifact
- **Response (HTTP 200 OK):** Luồng nhị phân Buffer của tệp PDF đã ký số hoàn chỉnh.

---

### 10.13. Ranh giới Pháp lý và Chuẩn PAdES B-T Readiness
- Dấu thời gian RFC 3161 (`id-aa-signatureTimeStampToken`) chứng minh sự tồn tại của chữ ký người ký trước thời điểm `genTime`.
- Hệ thống hỗ trợ kiểm tra fail-closed: nếu `requireTimestamp: true` mà TSA không sẵn sàng hoặc token bị lỗi, giao dịch ký lập tức bị hủy bỏ, không fallback sang đồng hồ hệ thống nội bộ.
- Hệ thống KHÔNG tự động tuyên bố đạt giá trị pháp lý tương đương chữ ký số công cộng quốc gia nếu chứng thư số chưa thuộc danh mục CA tin cậy quốc gia (Bộ TT&TT).

---

### 10.14. Bổ sung thông tin xác thực dài hạn LTV (Phase 13.3.2 — Add LTV to Signed Document)
- **Endpoint:** `POST /api/documents/:id/add-ltv`
- **Quyền hạn:** `USER` (thuộc cùng tổ chức sở hữu hồ sơ), `ADMIN`, `SUPER_ADMIN`. Chặn `403 Forbidden` đối với Tenant khác.
- **Request Body (JSON, tùy chọn):**
  ```json
  {
    "versionNumber": 1
  }
  ```
- **Hành vi nghiệp vụ:**
  - Nạp bản nhị phân `SIGNED_PDF` hiện có từ Storage.
  - Tự động thẩm định tính toàn vẹn chữ ký hiện tại (Revision 1 ByteRange).
  - Trích xuất chứng thư số người ký và chứng thư TSA (nếu có).
  - Thu thập chuỗi chứng thư số tin cậy (Certificate Chain) và dữ liệu thu hồi (Revocation Info): phản hồi OCSP (RFC 6960) và danh sách thu hồi CRL (RFC 5280) với cơ chế phòng thủ SSRF nhiều lớp (chặn IP private/loopback/link-local/cloud metadata, giới hạn kích thước và timeout).
  - Đóng gói từ điển `/DSS` (Document Security Store) và `/VRI` (Validation-Related Information) vào PDF thông qua kỹ thuật **PDF Incremental Update** chuẩn ISO 32000-1 clause 12.8.4 và ETSI EN 319 142-1 clause 5.4.
  - Tuyệt đối bảo toàn nguyên vẹn byte và ByteRange của Revision 1; chữ ký ban đầu không bị vô hiệu hóa.
  - Cơ chế **Fail-Closed**: nếu phát hiện chứng thư số bị thu hồi (`REVOKED`), hệ thống lập tức từ chối nhúng DSS và không cấp chứng nhận B-LT.
  - Ghi nhật ký kiểm toán `DOCUMENT_ADD_LTV`.
- **Response Thành công (HTTP 200 OK / 201 Created):**
  ```json
  {
    "success": true,
    "data": {
      "artifactId": "d1201130-ee7e-4d5e-81a5-512deb04f505",
      "documentId": "3be537ee-6d3f-4ccb-9c23-6cc2c83c94b3",
      "documentVersionId": "f98a4031-a160-4ad8-a168-e2d6956745f2",
      "signedPdfHash": "c1f7a294b05e...",
      "sizeBytes": 1186867,
      "hasLtv": true,
      "ltvStatus": "VALID",
      "padesLevel": "PADES_B_LT",
      "dssCertsCount": 3,
      "dssOcspsCount": 2,
      "dssCrlsCount": 0,
      "embeddedAt": "2026-10-26T02:40:04.221Z",
      "downloadUrl": "/api/documents/3be537ee-6d3f-4ccb-9c23-6cc2c83c94b3/pdf?type=SIGNED_PDF"
    },
    "timestamp": "2026-10-26T02:40:05.000Z"
  }
  ```

---

### 10.15. Thẩm định chuyên biệt dữ liệu LTV / DSS (Phase 13.3.2 — Verify LTV)
- **Endpoint:** `GET /api/documents/:id/verify-ltv`
- **Query Parameters:** `version` (tùy chọn, mặc định là phiên bản hiện tại).
- **Quyền hạn:** `USER` (cùng tổ chức), `ADMIN`, `SUPER_ADMIN`. Chặn `403 Forbidden` đối với Tenant khác.
- **Hành vi nghiệp vụ:**
  - Trích xuất cấu trúc `/DSS` từ bản cập nhật bổ sung cuối cùng của tệp PDF.
  - Kiểm tra và giải mã danh sách luồng nhị phân X.509 Certificates (`/Certs`), OCSP Responses (`/OCSPs`), và CRLs (`/CRLs`).
  - Đối soát chữ ký số trên OCSP Response / CRL với khóa công khai của CA phát hành.
  - Xác nhận chứng thư của người ký có trạng thái `GOOD` tại thời điểm ký và dấu thời gian.
- **Response Thành công (HTTP 200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "hasLtv": true,
      "ltvValidationStatus": "VALID",
      "padesLevel": "PADES_B_LT",
      "revocationStatus": "GOOD",
      "dssInfo": {
        "certsCount": 3,
        "ocspsCount": 2,
        "crlsCount": 0,
        "vriEntriesCount": 1
      },
      "signatureIntegrity": true,
      "hasTimestamp": true,
      "isTimestampValid": true
    },
    "timestamp": "2026-10-26T02:40:06.000Z"
  }
  ```

---

### 10.16. Ranh giới Kỹ thuật PAdES B-LT vs PAdES B-LTA
- **PAdES Baseline B-LT (Triển khai hoàn tất trong Phase 13.3.2):**
  - Tệp PDF chứa chữ ký số (B-B), TimeStampToken RFC 3161 trên chữ ký (B-T), và toàn bộ chứng thư số trong chuỗi chứng thực cùng dữ liệu xác minh trạng thái thu hồi (OCSP Responses / CRLs) được nhúng trong từ điển Document Security Store (`/DSS`).
  - Cho phép người nhận thẩm định chữ ký trong tương lai độc lập với tính sẵn sàng của máy chủ OCSP/CRL bên ngoài tại thời điểm thẩm định.
- **PAdES Baseline B-LTA (Phạm vi tương lai):**
  - Bổ sung cơ chế **Document Timestamp** định kỳ bao trùm toàn bộ tệp PDF (bao gồm cả dữ liệu DSS hiện có) nhằm chống lại sự suy giảm thuật toán mật mã theo thời gian (cryptographic decay).
  - Không công bố đạt B-LTA khi chưa triển khai Document Timestamp bảo vệ chứng cứ dài hạn.

---

### 10.17. Tự động Niêm phong số PAdES B-LT & Tích hợp Luồng Phê duyệt (Phase 13.4)
- **Cơ chế Kích hoạt (Trigger):**
  - Khi một hồ sơ hoàn tất bước phê duyệt cuối cùng và FSM chuyển trạng thái tài liệu sang `APPROVED`, `WorkflowOrchestratorService` tự động gọi `PdfSigningService.autoSealApprovedDocument(documentId, actor)`.
  - **Lựa chọn Chứng thư số Niêm phong:**
    1. Ưu tiên con dấu điện tử chung của tổ chức (`DigitalCertificate` có `organizationId` khớp và `userId: null`, trạng thái `ACTIVE`).
    2. Nếu tổ chức chưa nạp con dấu chung, hệ thống sử dụng chứng thư cá nhân `ACTIVE` của người phê duyệt bước cuối cùng (`actor.id`).
    3. Nếu cả tổ chức và người phê duyệt đều chưa cấu hình chứng thư số PKI, hệ thống **hoạt động êm thuận (Graceful Fallback)**: giao dịch duyệt hồ sơ hoàn tất thành công (`APPROVED`), ghi nhận log cảnh báo và không ném lỗi ra ngoài client.
- **Tham số Ký số Bắt buộc:**
  - `requireTimestamp: true` (Yêu cầu dấu thời gian RFC 3161 từ TSA tin cậy).
  - `includeLtv: true` (Yêu cầu bổ sung dữ liệu xác thực dài hạn DSS / VRI / OCSP / CRL).
  - Kết quả sinh ra tệp `SIGNED_PDF` đạt chuẩn **PAdES Baseline B-LT**.
- **Liên kết Ủy quyền & Đa Chữ ký (Delegation & Multi-Signer Linkage):**
  - Khi người phê duyệt thực hiện duyệt thay mặt người khác thông qua chính sách ủy quyền (`isDelegated: true`), bản ghi kiểm toán chữ ký số `DOCUMENT_SIGN_PDF` và sự kiện `StepDecisionHistory` liên kết chặt chẽ: `userId` (người thực hiện), `delegatedFromUserId` (người ủy quyền), `delegationPolicyId` (mã chính sách ủy quyền), và `stepId`.
  - Phát sinh cả hai sự kiện kiểm toán bất biến: `DOCUMENT_SIGN_PDF` và `DOCUMENT_ADD_LTV`.
- **Thông báo Hoàn tất Niêm phong (DOCUMENT_APPROVED):**
  - Hệ thống tự động phát sinh thông báo `DOCUMENT_APPROVED` tới người tạo hồ sơ (`createdById`) và toàn bộ cán bộ tham gia các bước duyệt (`workflow.steps.assignees`).
  - Nội dung thông báo chứa `metadata.downloadUrl = /api/documents/:id/pdf?type=SIGNED_PDF`, `signedPdfHash`, và `padesLevel = PADES_B_LT`.



