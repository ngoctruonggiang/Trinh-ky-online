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


