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
    "permissions": {
      "canApprove": true,
      "canResubmit": false,
      "canCancel": false,
      "isCreator": false,
      "isAdmin": false,
      "currentStepAssigneeRole": "APPROVER"
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

### 5.5. Xuất bản / Phát hành phiên bản mới (Publish Template)
- **Endpoint:** `POST /api/templates/:id/publish`
- **Quyền hạn:** `ADMIN`, `SUPER_ADMIN`.
- **Hành vi nghiệp vụ:**
  - Nếu là bản nháp đầu tiên: chuyển trạng thái sang `PUBLISHED`, tạo bản ghi `FormTemplateVersion` snapshot (v1).
  - Nếu đã phát hành trước đó: tăng `currentVersion` lên `currentVersion + 1`, tạo snapshot phiên bản mới mà **không sửa đổi snapshot cũ** nhằm bảo toàn tính toàn vẹn của các hồ sơ lịch sử đã tham chiếu.
- **Request Body:** `{ "changeSummary": "Cập nhật trường ngày đi và ghi chú hạn chế chi phí" }`
- **Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "uuid-tmpl-1",
    "versionNumber": 2,
    "versionId": "uuid-version-2-id",
    "message": "Phát hành phiên bản 2 thành công."
  }
}
```

### 5.6. Lưu trữ biểu mẫu (Archive Template)
- **Endpoint:** `POST /api/templates/:id/archive`
- **Quyền hạn:** `ADMIN`, `SUPER_ADMIN`.
- **Hành vi nghiệp vụ:** Chuyển trạng thái sang `ARCHIVED`. Ngăn không cho người dùng tạo hồ sơ mới từ biểu mẫu này. Hồ sơ cũ vẫn xem lại bình thường.

### 5.7. Thẩm định trước dữ liệu biểu mẫu (Validate Form Data)
- **Endpoint:** `POST /api/templates/:id/validate`
- **Request Body:** `{ "formData": { ... } }`
- **Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "valid": false,
    "errors": {
      "destination": "Trường này là bắt buộc",
      "from_date": "Định dạng ngày không hợp lệ"
    }
  }
}
```

---

## 6. NHỮNG GIỚI HẠN & LƯU Ý KHI GHÉP GIAO DIỆN (FRONTEND GOTCHAS)

1. **Không bao giờ gửi `userId` trong Body:**
   Danh tính của người thực hiện thao tác được Backend tự động trích xuất từ Bearer JWT. Frontend không cần (và không được phép) truyền `userId` vào Body JSON.
2. **Xử lý xung đột `409 CONCURRENCY_CONFLICT`:**
   Trong các bước song song (`ANY_CAN_APPROVE`), khi một người đồng cấp khác vừa bấm duyệt trước, người dùng bấm sau sẽ nhận mã lỗi 409. Frontend cần hiển thị thông báo thân thiện: *"Bước duyệt này đã được một người duyệt khác xử lý trước đó. Đang tải lại trạng thái hồ sơ..."* và tự động refresh dữ liệu trang.
3. **Chữ ký cá nhân:**
   Hiện tại `signatureImageUrl` là URL ảnh (PNG/SVG nền trong suốt). Frontend có thể tích hợp canvas vẽ chữ ký tay hoặc tải ảnh lên để lấy URL trước khi gọi endpoint `POST /decision`.
4. **Phân tách Chế độ Dữ liệu (Mock vs Real API):**
   Frontend sử dụng kiến trúc Service Adapter `IDocumentService` và `ITemplateService` với 2 implementation song song: `MockDocumentService` / `HttpDocumentService`, `MockTemplateService` / `HttpTemplateService`. Mặc định chạy ở chế độ Mock an toàn trong local development mà không có backend, và chuyển sang Real API khi biến môi trường `NEXT_PUBLIC_USE_MOCK_API='false'`. Không bao giờ tự động chuyển ngầm sang mock khi API thật bị lỗi mạng hay trả về lỗi 4xx/5xx.
5. **Bảo toàn Phiên bản Biểu mẫu Lịch sử (Immutable Form Snapshots):**
   Hồ sơ khi tạo được gán `templateVersionId` chỉ định trực tiếp đến snapshot tại thời điểm khởi tạo. Dù Admin có cập nhật, thêm bớt trường hay phát hành v2, v3, thì hồ sơ v1 vẫn mở lại và dựng lại form theo đúng phiên bản v1 ban đầu.


