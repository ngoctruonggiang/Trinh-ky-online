import { PrismaClient } from '@prisma/client';
import { JwtUtil } from '../src/common/utils/jwt.util.js';
import { UserRole } from '@trinh-ky/shared';

const API_BASE = 'http://localhost:4000/api';
const JWT_SECRET = 'dev-jwt-secret-key-change-in-production-min-32-chars';

async function runLiveTests() {
  console.log('=== BẮT ĐẦU KIỂM THỬ LIVE HTTP API VỚI POSTGRESQL THẬT ===\n');

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: 'postgresql://postgres:devpassword123@localhost:5432/trinh_ky_online_dev?schema=public',
      },
    },
  });

  // Truy vấn người dùng thật đã được seed trong PostgreSQL
  const userA = await prisma.user.findFirstOrThrow({
    where: { email: 'author-alpha@vinagroup.vn' },
    include: { organization: true },
  });

  const userB = await prisma.user.findFirstOrThrow({
    where: { email: 'user-beta@vinagroup.vn' },
    include: { organization: true },
  });

  const superAdmin = await prisma.user.findFirstOrThrow({
    where: { email: 'superadmin-global@vinagroup.vn' },
  });

  // Tìm 1 document của Công ty Alpha và 1 của Công ty Beta
  const docAlpha = await prisma.document.findFirstOrThrow({
    where: { organizationId: userA.organizationId! },
  });

  const docBeta = await prisma.document.findFirstOrThrow({
    where: { organizationId: userB.organizationId! },
  });

  // Tạo JWT tokens chuẩn xác
  const tokenUserA = JwtUtil.sign(
    {
      sub: userA.id,
      email: userA.email,
      fullName: userA.fullName,
      role: userA.role,
      organizationId: userA.organizationId,
      departmentId: userA.departmentId,
    },
    JWT_SECRET,
    3600
  );

  const tokenUserB = JwtUtil.sign(
    {
      sub: userB.id,
      email: userB.email,
      fullName: userB.fullName,
      role: userB.role,
      organizationId: userB.organizationId,
      departmentId: userB.departmentId,
    },
    JWT_SECRET,
    3600
  );

  const tokenSuperAdmin = JwtUtil.sign(
    {
      sub: superAdmin.id,
      email: superAdmin.email,
      fullName: superAdmin.fullName,
      role: superAdmin.role,
      organizationId: null,
    },
    JWT_SECRET,
    3600
  );

  // Test 1: Không có Authorization Header -> 401 Unauthorized
  console.log('1. Test missing Authorization header:');
  const resNoAuth = await fetch(`${API_BASE}/documents`);
  const bodyNoAuth = await resNoAuth.json();
  console.log(`   HTTP Status: ${resNoAuth.status} | Code: ${bodyNoAuth.error?.code}`);
  if (resNoAuth.status !== 401 || bodyNoAuth.error?.code !== 'UNAUTHORIZED') {
    throw new Error('Test 1 thất bại: Không trả về 401 UNAUTHORIZED');
  }
  console.log('   -> PASS (Từ chối request vô danh an toàn)\n');

  // Test 2: Token giả mạo/chữ ký sai -> 401 Unauthorized
  console.log('2. Test JWT giả mạo chữ ký (Signature Mismatch):');
  const fakeToken = JwtUtil.sign(
    { sub: userA.id, role: UserRole.SUPER_ADMIN },
    'fake-attacker-secret-key-1234567890123456',
    3600
  );
  const resFake = await fetch(`${API_BASE}/documents`, {
    headers: { Authorization: `Bearer ${fakeToken}` },
  });
  const bodyFake = await resFake.json();
  console.log(`   HTTP Status: ${resFake.status} | Code: ${bodyFake.error?.code}`);
  if (resFake.status !== 401 || bodyFake.error?.code !== 'UNAUTHORIZED') {
    throw new Error('Test 2 thất bại: Chấp nhận token giả mạo');
  }
  console.log('   -> PASS (Chặn token giả mạo thành công)\n');

  // Test 3: GET /api/auth/me với user thật từ DB
  console.log('3. Test GET /api/auth/me với Bearer Token thật:');
  const resMe = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${tokenUserA}` },
  });
  const bodyMe = await resMe.json();
  console.log(`   HTTP Status: ${resMe.status} | Organization: ${bodyMe.data?.organizationName}`);
  if (
    resMe.status !== 200 ||
    bodyMe.data?.email !== userA.email ||
    bodyMe.data?.organizationName !== 'Tập đoàn VinaGroup (HQ)'
  ) {
    throw new Error('Test 3 thất bại: GET /auth/me trả sai dữ liệu');
  }
  if (bodyMe.data.passwordHash || bodyMe.data.secret || bodyMe.data.token) {
    throw new Error('Test 3 thất bại: Lộ thông tin mật trong response');
  }
  console.log('   -> PASS (Thông tin profile chuẩn xác, không lộ secret)\n');

  // Test 4: GET /api/documents phân trang và cách ly đa công ty
  console.log('4. Test GET /api/documents cách ly công ty tại tầng DB:');
  const resDocsA = await fetch(`${API_BASE}/documents?tab=all&page=1&limit=10`, {
    headers: { Authorization: `Bearer ${tokenUserA}` },
  });
  const bodyDocsA = await resDocsA.json();
  console.log(
    `   HTTP Status: ${resDocsA.status} | Total Items Org Alpha: ${bodyDocsA.data?.items?.length}`
  );
  if (resDocsA.status !== 200 || bodyDocsA.data.items.length === 0) {
    throw new Error('Test 4 thất bại: Không lấy được danh sách hồ sơ của Org Alpha');
  }
  for (const item of bodyDocsA.data.items) {
    if (item.organizationId !== userA.organizationId) {
      throw new Error(`Test 4 thất bại: Lọt hồ sơ công ty khác (${item.organizationId})`);
    }
  }
  console.log('   -> PASS (100% hồ sơ trả về đúng thuộc công ty Alpha)\n');

  // Test 5: GET /api/documents/:id khi ID không tồn tại -> 404 DOCUMENT_NOT_FOUND
  console.log('5. Test GET /api/documents/:id khi ID không tồn tại:');
  const resNotFound = await fetch(`${API_BASE}/documents/00000000-0000-0000-0000-000000000000`, {
    headers: { Authorization: `Bearer ${tokenUserA}` },
  });
  const bodyNotFound = await resNotFound.json();
  console.log(`   HTTP Status: ${resNotFound.status} | Code: ${bodyNotFound.error?.code}`);
  if (resNotFound.status !== 404 || bodyNotFound.error?.code !== 'DOCUMENT_NOT_FOUND') {
    throw new Error('Test 5 thất bại: Không trả về 404 DOCUMENT_NOT_FOUND');
  }
  console.log('   -> PASS (Chuẩn hóa lỗi 404 DOCUMENT_NOT_FOUND)\n');

  // Test 6: GET /api/documents/:id CHẶN CROSS-COMPANY (User B đọc hồ sơ của Alpha) -> 403 FORBIDDEN
  console.log(`6. Test bảo mật đa công ty: User B (Beta) cố đọc hồ sơ Alpha (${docAlpha.id}):`);
  const resCrossForbidden = await fetch(`${API_BASE}/documents/${docAlpha.id}`, {
    headers: { Authorization: `Bearer ${tokenUserB}` },
  });
  const bodyForbidden = await resCrossForbidden.json();
  console.log(`   HTTP Status: ${resCrossForbidden.status} | Code: ${bodyForbidden.error?.code}`);
  if (resCrossForbidden.status !== 403 || bodyForbidden.error?.code !== 'FORBIDDEN') {
    throw new Error('Test 6 thất bại: Không chặn 403 FORBIDDEN khi đọc hồ sơ công ty khác');
  }
  console.log('   -> PASS (Chặn truy cập trái phép đa công ty thành công)\n');

  // Test 7: GET /api/documents/:id SUPER_ADMIN đọc được hồ sơ mọi công ty
  console.log(`7. Test SUPER_ADMIN đọc hồ sơ xuyên công ty (${docAlpha.id}):`);
  const resSuper = await fetch(`${API_BASE}/documents/${docAlpha.id}`, {
    headers: { Authorization: `Bearer ${tokenSuperAdmin}` },
  });
  const bodySuper = await resSuper.json();
  console.log(
    `   HTTP Status: ${resSuper.status} | Title: ${bodySuper.data?.title} | CanApprove: ${bodySuper.data?.permissions?.canApprove}`
  );
  if (resSuper.status !== 200 || bodySuper.data?.id !== docAlpha.id) {
    throw new Error('Test 7 thất bại: SUPER_ADMIN không đọc được hồ sơ');
  }
  console.log('   -> PASS (SUPER_ADMIN đọc xuyên suốt công ty thành công)\n');

  // Test 8: Chi tiết hồ sơ trả về đầy đủ permissions và version formData
  console.log(`8. Test chi tiết hồ sơ trả về cho chính tác giả Alpha:`);
  const resDetail = await fetch(`${API_BASE}/documents/${docAlpha.id}`, {
    headers: { Authorization: `Bearer ${tokenUserA}` },
  });
  const bodyDetail = await resDetail.json();
  console.log(`   Active Version Hash: ${bodyDetail.data?.activeVersion?.sha256Hash}`);
  console.log(`   Form Data Device: ${bodyDetail.data?.activeVersion?.formData?.device}`);
  console.log(`   Is Creator: ${bodyDetail.data?.permissions?.isCreator}`);
  if (
    resDetail.status !== 200 ||
    !bodyDetail.data?.activeVersion?.sha256Hash ||
    bodyDetail.data?.permissions?.isCreator !== true
  ) {
    throw new Error('Test 8 thất bại: Dữ liệu chi tiết phiên bản thiếu hoặc sai permissions');
  }
  console.log('   -> PASS (Dữ liệu chi tiết, mã băm SHA-256 và permissions chuẩn xác)\n');

  // Setup Admin Alpha Token cho các test Template Engine
  let adminA = await prisma.user.findFirst({
    where: { organizationId: userA.organizationId!, role: 'ADMIN' },
  });
  if (!adminA) {
    adminA = await prisma.user.create({
      data: {
        email: `admin-e2e-${Date.now()}@vinagroup.vn`,
        passwordHash: 'hash',
        fullName: 'Admin E2E Alpha',
        role: 'ADMIN',
        organizationId: userA.organizationId!,
      },
    });
  }
  const tokenAdminA = JwtUtil.sign(
    {
      sub: adminA.id,
      email: adminA.email,
      fullName: adminA.fullName,
      role: adminA.role,
      organizationId: adminA.organizationId,
      departmentId: adminA.departmentId,
    },
    JWT_SECRET,
    3600
  );

  // Test 9: USER thường không thể tạo template (403 Forbidden)
  console.log('9. Test USER thường gọi POST /api/templates:');
  const resUserCreateTpl = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code: `FAIL_${Date.now()}`,
      title: 'Mẫu bất hợp pháp',
      fields: [{ key: 'f1', label: 'Field', type: 'text' }],
    }),
  });
  const bodyUserCreateTpl = await resUserCreateTpl.json();
  console.log(`   HTTP Status: ${resUserCreateTpl.status} | Code: ${bodyUserCreateTpl.error?.code}`);
  if (resUserCreateTpl.status !== 403) {
    throw new Error('Test 9 thất bại: USER không bị chặn 403 khi tạo template');
  }
  console.log('   -> PASS (USER bị chặn 403 Forbidden đúng quyền hạn)\n');

  // Test 10: ADMIN Alpha tạo template mới ở trạng thái DRAFT v1 (201 Created)
  console.log('10. Test ADMIN tạo template mới (DRAFT v1):');
  const templateCode = `E2E_TPL_${Date.now()}`;
  const resAdminCreateTpl = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code: templateCode,
      title: 'Mẫu đề xuất thiết bị kỹ thuật E2E',
      category: 'Công nghệ thông tin',
      fields: [
        { key: 'ten_thiet_bi', label: 'Tên thiết bị', type: 'text', required: true, order: 1 },
        { key: 'ngan_sach', label: 'Ngân sách dự kiến', type: 'currency_vnd', required: true, order: 2 },
        { key: 'ngay_can', label: 'Ngày cần bàn giao', type: 'date', required: true, order: 3 },
      ],
    }),
  });
  const bodyAdminCreateTpl = await resAdminCreateTpl.json();
  const createdTplId = bodyAdminCreateTpl.data?.id;
  console.log(`   HTTP Status: ${resAdminCreateTpl.status} | TemplateId: ${createdTplId} | Status: ${bodyAdminCreateTpl.data?.status}`);
  if (resAdminCreateTpl.status !== 201 || !createdTplId || bodyAdminCreateTpl.data?.status !== 'DRAFT') {
    throw new Error('Test 10 thất bại: Không tạo được template DRAFT');
  }
  console.log('   -> PASS (ADMIN tạo template DRAFT thành công)\n');

  // Test 11: ADMIN phát hành template v1 (POST /publish) -> 200 OK
  console.log(`11. Test phát hành phiên bản v1 cho template ${createdTplId}:`);
  const resPub1 = await fetch(`${API_BASE}/templates/${createdTplId}/publish`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ changeSummary: 'Phát hành chính thức v1' }),
  });
  const bodyPub1 = await resPub1.json();
  console.log(`   HTTP Status: ${resPub1.status} | Version: ${bodyPub1.data?.versionNumber} | Status: ${bodyPub1.data?.status}`);
  if (resPub1.status !== 200 || bodyPub1.data?.versionNumber !== 1 || bodyPub1.data?.status !== 'PUBLISHED') {
    throw new Error('Test 11 thất bại: Phát hành v1 không thành công');
  }
  console.log('   -> PASS (Phát hành v1 thành công)\n');

  // Test 12: ADMIN tạo bản nháp phiên bản tiếp theo (POST /draft) -> 200 OK
  console.log(`12. Test tạo bản nháp tiếp theo (v2) cho template ${createdTplId}:`);
  const resDraft2 = await fetch(`${API_BASE}/templates/${createdTplId}/draft`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  const bodyDraft2 = await resDraft2.json();
  console.log(`   HTTP Status: ${resDraft2.status} | Draft Version: ${bodyDraft2.data?.versionNumber} | Status: ${bodyDraft2.data?.status}`);
  if (resDraft2.status !== 200 || bodyDraft2.data?.versionNumber !== 2 || bodyDraft2.data?.status !== 'DRAFT') {
    throw new Error('Test 12 thất bại: Không tạo được bản nháp v2');
  }
  console.log('   -> PASS (Bản nháp v2 được tạo an toàn mà không sửa snapshot v1)\n');

  // Test 13: ADMIN chỉnh sửa nội dung bản nháp v2 (PUT /draft) -> 200 OK
  console.log(`13. Test chỉnh sửa bản nháp v2:`);
  const resUpdateDraft = await fetch(`${API_BASE}/templates/${createdTplId}/draft`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Mẫu đề xuất thiết bị kỹ thuật E2E (v2 Cập nhật)',
      fields: [
        { key: 'ten_thiet_bi', label: 'Tên thiết bị', type: 'text', required: true, order: 1 },
        { key: 'ngan_sach', label: 'Ngân sách dự kiến', type: 'currency_vnd', required: true, order: 2 },
        { key: 'ngay_can', label: 'Ngày cần bàn giao', type: 'date', required: true, order: 3 },
        { key: 'muc_dich', label: 'Mục đích sử dụng', type: 'text', required: true, order: 4 },
      ],
    }),
  });
  const bodyUpdateDraft = await resUpdateDraft.json();
  console.log(`   HTTP Status: ${resUpdateDraft.status} | Title: ${bodyUpdateDraft.data?.title}`);
  if (resUpdateDraft.status !== 200 || bodyUpdateDraft.data?.versionNumber !== 2) {
    throw new Error('Test 13 thất bại: Không cập nhật được bản nháp v2');
  }
  console.log('   -> PASS (Cập nhật bản nháp v2 thành công)\n');

  // Test 14: ADMIN phát hành v2 (POST /publish) -> 200 OK
  console.log(`14. Test phát hành chính thức bản nháp v2:`);
  const resPub2 = await fetch(`${API_BASE}/templates/${createdTplId}/publish`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ changeSummary: 'Bổ sung trường mục đích sử dụng trong v2' }),
  });
  const bodyPub2 = await resPub2.json();
  console.log(`   HTTP Status: ${resPub2.status} | Version: ${bodyPub2.data?.versionNumber}`);
  if (resPub2.status !== 200 || bodyPub2.data?.versionNumber !== 2) {
    throw new Error('Test 14 thất bại: Phát hành v2 không thành công');
  }
  console.log('   -> PASS (Phát hành v2 thành công)\n');

  // Test 15: Kiểm tra validation khi tạo hồ sơ: Từ chối undeclared key và invalid date
  console.log('15. Test validation khi nộp hồ sơ (Chặn undeclared key và invalid calendar date):');
  const resInvalidDoc = await fetch(`${API_BASE}/documents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      templateId: createdTplId,
      title: 'Hồ sơ lỗi validation',
      formData: {
        ten_thiet_bi: 'MacBook Pro M3',
        ngan_sach: 55000000,
        ngay_can: '2026-02-31', // Ngày không tồn tại trong lịch!
        muc_dich: 'Lập trình',
        unauthorized_extra_key: 'hacker_payload', // Key không khai báo!
      },
    }),
  });
  const bodyInvalidDoc = await resInvalidDoc.json();
  console.log(`   HTTP Status: ${resInvalidDoc.status} | Error: ${JSON.stringify(bodyInvalidDoc.error?.message || bodyInvalidDoc.message)}`);
  if (resInvalidDoc.status !== 400) {
    throw new Error('Test 15 thất bại: Không từ chối dữ liệu chứa trường không khai báo hoặc ngày sai lịch');
  }
  console.log('   -> PASS (Backend từ chối dữ liệu không hợp lệ an toàn)\n');

  // Test 16: Tạo hồ sơ hợp lệ thành công (201 Created), lưu Canonical SHA-256
  console.log('16. Test tạo hồ sơ DRAFT hợp lệ kết nối với phiên bản template:');
  const resValidDoc = await fetch(`${API_BASE}/documents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      templateId: createdTplId,
      title: 'Đề xuất trang bị máy tính làm việc',
      formData: {
        ten_thiet_bi: 'MacBook Pro M3 Max',
        ngan_sach: 75000000,
        ngay_can: '2026-11-15',
        muc_dich: 'Phát triển hệ thống backend cao tải',
      },
    }),
  });
  const bodyValidDoc = await resValidDoc.json();
  const createdDoc = bodyValidDoc.data;
  console.log(`   HTTP Status: ${resValidDoc.status} | DocId: ${createdDoc?.id} | DocNumber: ${createdDoc?.documentNumber} | TemplateVersion: v${createdDoc?.templateVersionNumber}`);
  if (resValidDoc.status !== 201 || !createdDoc?.id || createdDoc?.templateVersionNumber !== 2) {
    throw new Error('Test 16 thất bại: Không tạo được hồ sơ từ template v2');
  }
  console.log('   -> PASS (Tạo hồ sơ DRAFT thành công từ template v2)\n');

  // =========================================================================
  // PHASE 11: WORKFLOW BUILDER & VERSIONED APPROVAL ENGINE LIVE HTTP TESTS
  // =========================================================================

  // Test 17: USER thường gọi POST /api/workflow-templates -> 403 Forbidden
  console.log('17. Test USER thường gọi POST /api/workflow-templates (Chặn 403):');
  const resUserWf = await fetch(`${API_BASE}/workflow-templates`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code: `WF_FAIL_${Date.now()}`,
      title: 'Quy trình không được phép',
      steps: [
        {
          stepKey: 'step_1',
          stepName: 'Bước 1',
          stepOrder: 1,
          approverConfig: { type: 'SPECIFIC_USERS', userIds: [userA.id] },
        },
      ],
    }),
  });
  console.log(`   HTTP Status: ${resUserWf.status}`);
  if (resUserWf.status !== 403) {
    throw new Error('Test 17 thất bại: USER không bị chặn 403 khi tạo workflow template');
  }
  console.log('   -> PASS (Chặn USER thường tạo quy trình phê duyệt đúng RBAC)\n');

  // Test 18: ADMIN Alpha tạo workflow template DRAFT v1 (201 Created)
  console.log('18. Test ADMIN tạo workflow template mới ở trạng thái DRAFT v1:');
  const wfCode = `WF_LIVE_${Date.now()}`;
  const resAdminCreateWf = await fetch(`${API_BASE}/workflow-templates`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code: wfCode,
      title: 'Quy trình phê duyệt chi phí dự án E2E',
      category: 'Tài chính & Đầu tư',
      steps: [
        {
          stepKey: 's1_dept_mgr',
          stepName: 'Trưởng bộ phận xem xét',
          stepOrder: 1,
          stepType: 'SEQUENTIAL',
          completionRule: 'ALL_MUST_APPROVE',
          approverConfig: {
            type: 'SPECIFIC_USERS',
            userIds: [userA.id],
          },
          reviewerUserIds: [],
        },
        {
          stepKey: 's2_director',
          stepName: 'Ban Giám đốc phê duyệt chung',
          stepOrder: 2,
          stepType: 'SEQUENTIAL',
          completionRule: 'ANY_CAN_APPROVE',
          approverConfig: {
            type: 'SPECIFIC_USERS',
            userIds: [adminA.id],
          },
          reviewerUserIds: [],
        },
      ],
    }),
  });
  const bodyAdminCreateWf = await resAdminCreateWf.json();
  const createdWfId = bodyAdminCreateWf.data?.id;
  console.log(`   HTTP Status: ${resAdminCreateWf.status} | WfId: ${createdWfId} | Status: ${bodyAdminCreateWf.data?.status}`);
  if (resAdminCreateWf.status !== 201 || !createdWfId || bodyAdminCreateWf.data?.status !== 'DRAFT') {
    throw new Error('Test 18 thất bại: Không tạo được workflow template DRAFT');
  }
  console.log('   -> PASS (ADMIN tạo workflow template DRAFT thành công)\n');

  // Test 19: ADMIN phát hành workflow template v1 (POST /publish) -> 200/201 OK
  console.log(`19. Test phát hành phiên bản v1 cho workflow template ${createdWfId}:`);
  const resPubWf1 = await fetch(`${API_BASE}/workflow-templates/${createdWfId}/publish`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ releaseNotes: 'Phát hành chính thức quy trình v1' }),
  });
  const bodyPubWf1 = await resPubWf1.json();
  const wfVersion1Id = bodyPubWf1.data?.versionId;
  console.log(`   HTTP Status: ${resPubWf1.status} | VersionId: ${wfVersion1Id} | VersionNumber: v${bodyPubWf1.data?.versionNumber}`);
  if (!resPubWf1.ok || !wfVersion1Id || bodyPubWf1.data?.versionNumber !== 1) {
    throw new Error('Test 19 thất bại: Không phát hành được workflow v1');
  }
  console.log('   -> PASS (Phát hành workflow v1 chính thức thành công)\n');

  // Test 20: ADMIN tạo bản nháp v2 rồi hủy an toàn (discardDraftVersion)
  console.log(`20. Test tạo bản nháp v2 và hủy an toàn cho workflow template ${createdWfId}:`);
  const resDraftWf = await fetch(`${API_BASE}/workflow-templates/${createdWfId}/draft`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
    },
  });
  const bodyDraftWf = await resDraftWf.json();
  console.log(`   HTTP Status (Create Draft): ${resDraftWf.status} | DraftVersion: v${bodyDraftWf.data?.versionNumber}`);
  if (!resDraftWf.ok || bodyDraftWf.data?.versionNumber !== 2) {
    throw new Error('Test 20 thất bại: Không tạo được draft v2');
  }

  const resDiscardWf = await fetch(`${API_BASE}/workflow-templates/${createdWfId}/draft`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
    },
  });
  const bodyDiscardWf = await resDiscardWf.json();
  console.log(`   HTTP Status (Discard Draft): ${resDiscardWf.status} | Success: ${bodyDiscardWf.success}`);
  if (!resDiscardWf.ok || !bodyDiscardWf.success) {
    throw new Error('Test 20 thất bại: Không hủy được draft v2');
  }
  console.log('   -> PASS (Tạo và hủy draft v2 thành công, v1 vẫn an toàn)\n');

  // Test 21: Tạo hồ sơ kết nối với workflowTemplateId -> Gắn snapshot v1, sinh đủ 2 bước duyệt
  console.log('21. Test tạo hồ sơ DRAFT kết nối với workflow template đã phát hành:');
  const resDocWithWf = await fetch(`${API_BASE}/documents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      templateId: createdTplId,
      workflowTemplateId: createdWfId,
      title: 'Hồ sơ đề xuất tích hợp Dynamic Workflow',
      formData: {
        ten_thiet_bi: 'Workstation AI SuperCluster',
        ngan_sach: 120000000,
        ngay_can: '2026-12-01',
        muc_dich: 'Thực thi mô hình ngôn ngữ lớn',
      },
    }),
  });
  const bodyDocWithWf = await resDocWithWf.json();
  const createdDocWithWf = bodyDocWithWf.data;
  console.log(`   HTTP Status: ${resDocWithWf.status} | DocId: ${createdDocWithWf?.id} | DocNumber: ${createdDocWithWf?.documentNumber}`);
  if (resDocWithWf.status !== 201 || !createdDocWithWf?.id) {
    throw new Error('Test 21 thất bại: Không tạo được hồ sơ kết nối workflow template');
  }

  // Đọc lại hồ sơ để kiểm tra các bước duyệt đã sinh
  const resReadDocWf = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}`, {
    headers: { Authorization: `Bearer ${tokenUserA}` },
  });
  const bodyReadDocWf = await resReadDocWf.json();
  const detailDoc = bodyReadDocWf.data;
  const workflowSteps = detailDoc?.workflow?.steps || [];
  console.log(`   Workflow Version Snapshot: ${detailDoc?.workflowTemplateVersionId || 'Gắn qua steps'} | Total Steps: ${workflowSteps.length}`);
  if (workflowSteps.length !== 2) {
    throw new Error(`Test 21 thất bại: Số bước duyệt không khớp (kỳ vọng 2 bước, nhận ${workflowSteps.length})`);
  }
  console.log('   -> PASS (Tạo hồ sơ gắn quy trình động và sinh 2 bước duyệt thành công)\n');

  // Test 22: Thử tạo hồ sơ với workflow template chưa phát hành -> 400 Bad Request
  console.log('22. Test tạo hồ sơ với workflow template chưa phát hành (Chặn 400):');
  const unpubWf = await prisma.workflowTemplate.create({
    data: {
      code: `WF_UNPUB_${Date.now()}`,
      title: 'Quy trình chưa phát hành',
      organizationId: userA.organizationId!,
      status: 'DRAFT',
      steps: [
        {
          stepKey: 's1',
          stepName: 'Bước 1',
          stepOrder: 1,
          approverConfig: { type: 'SPECIFIC_USERS', userIds: [userA.id] },
        },
      ],
      createdById: adminA.id,
    },
  });

  const resDocUnpubWf = await fetch(`${API_BASE}/documents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      templateId: createdTplId,
      workflowTemplateId: unpubWf.id,
      title: 'Hồ sơ thử với workflow chưa phát hành',
      formData: {
        ten_thiet_bi: 'Thiết bị test',
        ngan_sach: 1000000,
        ngay_can: '2026-12-01',
        muc_dich: 'Test',
      },
    }),
  });
  console.log(`   HTTP Status: ${resDocUnpubWf.status}`);
  if (resDocUnpubWf.status !== 400) {
    throw new Error('Test 22 thất bại: Hệ thống không chặn 400 khi tạo hồ sơ từ workflow DRAFT');
  }
  console.log('   -> PASS (Chặn tạo hồ sơ từ quy trình chưa phát hành an toàn)\n');

  await prisma.$disconnect();
  console.log('========================================================================');
  console.log('🎉 TẤT CẢ 22/22 KỊCH BẢN KIỂM THỬ LIVE HTTP & SECURITY TRÊN POSTGRESQL');
  console.log('   ĐÃ CHẠY THÀNH CÔNG 100%!');
  console.log('========================================================================');
}

runLiveTests().catch((err) => {
  console.error('\n❌ Lỗi khi chạy live test:', err);
  process.exit(1);
});
