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
  - `page`: số trang (mặc định 1)
  - `limit`: số bản ghi trên trang (mặc định 20, tối đa 100)
- **Quyền hạn & Tenant Isolation:**
  - `USER`: Chỉ xem các chính sách mà mình là người ủy quyền hoặc người nhận ủy quyền.
  - `ADMIN`: Xem tất cả chính sách trong tổ chức của mình.
  - `SUPER_ADMIN`: Xem chính sách toàn hệ thống.
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
- **Quyền hạn:** `delegator`, `delegatee`, `ADMIN` của tổ chức sở hữu, hoặc `SUPER_ADMIN`. Người ngoài bị chặn `403 Forbidden`.

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
- **Ràng buộc:** Không được sửa chính sách đã bị thu hồi (`isActive: false`) hoặc đã quá hạn (`endDate <= now`).

#### ⑤ Thu hồi chính sách ủy quyền (Soft Revoke)
- **Endpoint:** `POST /api/delegations/:id/revoke`
- **Quyền hạn:** Delegator, Admin cùng công ty, hoặc Super Admin.
- **Request Body:** `{ "reason": "Chuyến công tác kết thúc sớm" }`
- **Cơ chế:** Chuyển `isActive = false`, ghi nhận `revokedAt`, `revokedById`, ghi `AuditLog` và gửi `Notification` thông báo cho người nhận ủy quyền.

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
   - **Tie-breaking:** Nếu nhiều chính sách có cùng điểm ưu tiên, chính sách được tạo gần nhất (`createdAt` mới nhất) sẽ được áp dụng (Deterministic Resolution).
3. **Attribution & Audit Trail:**
   - Cập nhật quyết định của ghế duyệt ban đầu (`targetAssignee`) trong FSM, bảo toàn hoàn toàn completion rule và transition state.
   - Bản ghi `StepDecisionHistory` lưu:
     - `userId`: ID của người thực tế bấm duyệt (actual actor).
     - `isDelegated`: `true`.
     - `delegatedFromUserId`: ID của người ủy quyền ban đầu.
     - `delegationPolicyId`: ID chính sách đã áp dụng.
   - Bản ghi `SignatureEvent` gắn chữ ký điện tử thực tế của actual actor.
   - Bản ghi `AuditLog` lưu chi tiết ủy quyền và gửi thông báo in-app cho người ủy quyền biết hành động đã được thực hiện thay mặt mình.




