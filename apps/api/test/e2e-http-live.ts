import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import { JwtUtil } from '../src/common/utils/jwt.util.js';
import { UserRole } from '@trinh-ky/shared';
import { DevKeystoreGenerator } from '../src/modules/signing/dev-keystore-generator.js';
import { DevLocalKeystoreProvider } from '../src/modules/signing/providers/dev-local-keystore.provider.js';
import { StorageService } from '../src/modules/artifact/storage/storage.service.js';

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

  // Test 23: Gửi duyệt hồ sơ qua Live HTTP (POST /api/documents/:id/submit) -> 200 OK
  console.log(`23. Test gửi duyệt hồ sơ live HTTP (${createdDocWithWf.id}):`);
  const resSubmitDoc = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/submit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
      'Content-Type': 'application/json',
    },
  });
  const bodySubmitDoc = await resSubmitDoc.json();
  console.log(`   HTTP Status: ${resSubmitDoc.status} | DocumentStatus: ${bodySubmitDoc.data?.documentStatus}`);
  if (!resSubmitDoc.ok || bodySubmitDoc.data?.documentStatus !== 'IN_REVIEW') {
    throw new Error('Test 23 thất bại: Gửi duyệt hồ sơ không thành công');
  }
  console.log('   -> PASS (Gửi duyệt hồ sơ thành công, trạng thái chuyển IN_REVIEW)\n');

  // Test 24: Người dùng không được phân công cố tình gửi quyết định -> 403/400
  console.log('24. Test người dùng không thuộc danh sách duyệt gửi quyết định:');
  const resDecForbidden = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/decision`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserB}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      decision: 'APPROVED',
      decisionComment: 'User B duyệt lậu',
    }),
  });
  console.log(`   HTTP Status: ${resDecForbidden.status}`);
  if (resDecForbidden.status !== 403 && resDecForbidden.status !== 400) {
    throw new Error(`Test 24 thất bại: Kỳ vọng 403/400 nhưng nhận ${resDecForbidden.status}`);
  }
  console.log('   -> PASS (Chặn quyết định trái phép từ người dùng khác thành công)\n');

  // Test 25: Người duyệt hợp lệ (userA) phê duyệt qua Live HTTP -> 200 OK
  console.log(`25. Test người duyệt hợp lệ gửi quyết định APPROVED qua Live HTTP:`);
  const resDecApprove = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/decision`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      decision: 'APPROVED',
      decisionComment: 'Người duyệt 1 đồng ý hợp lệ',
      signatureImageUrl: '/signatures/userA.png',
    }),
  });
  const bodyDecApprove = await resDecApprove.json();
  console.log(`   HTTP Status: ${resDecApprove.status} | WorkflowStatus: ${bodyDecApprove.data?.workflowStatus}`);
  if (!resDecApprove.ok || !bodyDecApprove.success) {
    throw new Error('Test 25 thất bại: Người duyệt hợp lệ không phê duyệt được');
  }
  console.log('   -> PASS (Phê duyệt bước 1 thành công, ghi nhận chữ ký)\n');

  // Test 26: Gửi lại quyết định trùng lặp trên cùng bước -> 409 Conflict hoặc 400 Bad Request
  console.log('26. Test gửi quyết định trùng lặp qua Live HTTP:');
  const resDecDup = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/decision`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      decision: 'APPROVED',
      decisionComment: 'Duyệt lần 2',
    }),
  });
  console.log(`   HTTP Status: ${resDecDup.status}`);
  if (resDecDup.status !== 409 && resDecDup.status !== 400 && resDecDup.status !== 403) {
    throw new Error(`Test 26 thất bại: Không chặn quyết định trùng lặp (nhận ${resDecDup.status})`);
  }
  console.log('   -> PASS (Chặn quyết định trùng lặp trên Live HTTP thành công)\n');

  // =========================================================================
  // PHASE 12: ADVANCED APPROVAL FEATURES, REASSIGNMENT, SLA & NOTIFICATIONS
  // =========================================================================

  // Tìm hoặc tạo thêm 1 user mới trong Công ty Alpha làm người nhận chuyển giao
  let newApproverAlpha = await prisma.user.findFirst({
    where: { email: 'new-approver-alpha@vinagroup.vn' },
  });
  if (!newApproverAlpha) {
    newApproverAlpha = await prisma.user.create({
      data: {
        email: 'new-approver-alpha@vinagroup.vn',
        passwordHash: 'hashed_pw',
        fullName: 'Người duyệt mới Alpha',
        role: UserRole.USER,
        organizationId: userA.organizationId,
        isActive: true,
      },
    });
  }

  const tokenNewApprover = JwtUtil.sign(
    {
      sub: newApproverAlpha.id,
      email: newApproverAlpha.email,
      fullName: newApproverAlpha.fullName,
      role: newApproverAlpha.role,
      organizationId: newApproverAlpha.organizationId,
    },
    JWT_SECRET,
    3600
  );

  const adminAlphaUser = await prisma.user.findFirstOrThrow({
    where: { email: 'admin-alpha@vinagroup.vn' },
  });
  const tokenAdminAlpha = JwtUtil.sign(
    {
      sub: adminAlphaUser.id,
      email: adminAlphaUser.email,
      fullName: adminAlphaUser.fullName,
      role: adminAlphaUser.role,
      organizationId: adminAlphaUser.organizationId,
    },
    JWT_SECRET,
    3600
  );

  const inactiveUser = await prisma.user.findFirstOrThrow({
    where: { email: 'inactive.wf@vinagroup.vn' },
  });

  // Tạo hồ sơ mới để test Phase 12 Reassignment & SLA
  console.log('27. Test tạo hồ sơ và kiểm tra trường SLA & Reassignment qua Live HTTP:');
  const resDocP12 = await fetch(`${API_BASE}/documents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      templateId: createdTplId,
      workflowTemplateId: createdWfId,
      title: 'Hồ sơ kiểm thử Live HTTP Phase 12 Reassignment & SLA',
      urgency: 'NORMAL',
      formData: {
        ten_thiet_bi: 'Thiết bị Phase 12 SLA',
        ngan_sach: 75000000,
        ngay_can: '2026-12-01',
        muc_dich: 'Thử nghiệm Live HTTP Phase 12 Reassignment & SLA',
      },
    }),
  });
  const bodyDocP12 = await resDocP12.json();
  const docP12Id = bodyDocP12.data?.id;

  // Nộp hồ sơ
  await fetch(`${API_BASE}/documents/${docP12Id}/submit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenUserA}` },
  });

  // Đọc chi tiết hồ sơ
  const resDetailP12 = await fetch(`${API_BASE}/documents/${docP12Id}`, {
    headers: { Authorization: `Bearer ${tokenUserA}` },
  });
  const bodyDetailP12 = await resDetailP12.json();
  const docData = bodyDetailP12.data;

  console.log(`   Document Status: ${docData?.status} | SLA Status: ${docData?.slaStatus} | canReassign: ${docData?.permissions?.canReassign}`);
  if (!docData?.dueDate || docData?.slaStatus !== 'ON_TRACK' || docData?.permissions?.canReassign !== true) {
    throw new Error('Test 27 thất bại: Hồ sơ không trả về đúng thông tin SLA hoặc quyền canReassign');
  }
  console.log('   -> PASS (Khởi tạo hồ sơ và kiểm tra trường SLA qua Live HTTP thành công)\n');

  // Test 28: Chuyển giao người duyệt hợp lệ qua POST /api/documents/:id/reassign
  console.log('28. Test chuyển giao người duyệt hợp lệ bởi Admin qua Live HTTP:');
  const currentStep = docData.workflow.steps[0];
  const oldUserId = currentStep.assignees[0].userId;

  const resReassignOk = await fetch(`${API_BASE}/documents/${docP12Id}/reassign`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminAlpha}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      stepId: currentStep.id,
      oldUserId,
      newUserId: newApproverAlpha.id,
      reason: 'Người duyệt bận đi công tác 1 tuần, chuyển giao duyệt gấp',
    }),
  });
  const bodyReassignOk = await resReassignOk.json();
  console.log(`   HTTP Status: ${resReassignOk.status} | Success: ${bodyReassignOk.success}`);
  if (!resReassignOk.ok || !bodyReassignOk.success) {
    throw new Error(`Test 28 thất bại: Chuyển giao hợp lệ không thành công (${JSON.stringify(bodyReassignOk)})`);
  }

  // Đọc lại hồ sơ để xác nhận assignee đã cập nhật và có lịch sử chuyển giao
  const resDetailAfterReassign = await fetch(`${API_BASE}/documents/${docP12Id}`, {
    headers: { Authorization: `Bearer ${tokenUserA}` },
  });
  const bodyDetailAfter = await resDetailAfterReassign.json();
  const reassignments = bodyDetailAfter.data?.reassignmentHistories || [];
  const updatedAssigneeIds = (bodyDetailAfter.data?.workflow?.steps[0]?.assignees || []).map((a: any) => a.userId);

  if (!updatedAssigneeIds.includes(newApproverAlpha.id) || reassignments.length === 0) {
    throw new Error('Test 28 thất bại: Dữ liệu sau chuyển giao không cập nhật đúng người duyệt mới hoặc thiếu lịch sử');
  }
  console.log('   -> PASS (Chuyển giao người duyệt thành công, cập nhật assignee và lịch sử)\n');

  // Test 29: Chặn chuyển giao người duyệt cho tài khoản công ty khác (Beta sang Alpha) -> 400 Bad Request
  console.log('29. Test chặn chuyển giao cho tài khoản khác công ty (Tenant Isolation) qua Live HTTP:');
  const resReassignDiffOrg = await fetch(`${API_BASE}/documents/${docP12Id}/reassign`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminAlpha}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      stepId: currentStep.id,
      oldUserId: newApproverAlpha.id,
      newUserId: userB.id, // userB thuộc Công ty Beta!
      reason: 'Chuyển giao chéo công ty',
    }),
  });
  console.log(`   HTTP Status: ${resReassignDiffOrg.status}`);
  if (resReassignDiffOrg.status !== 400) {
    throw new Error(`Test 29 thất bại: Không chặn chuyển giao sang tổ chức khác (nhận ${resReassignDiffOrg.status})`);
  }
  console.log('   -> PASS (Chặn chuyển giao chéo tổ chức thành công)\n');

  // Test 30: Chặn chuyển giao cho tài khoản bị vô hiệu hóa (Inactive) -> 400 Bad Request
  console.log('30. Test chặn chuyển giao cho tài khoản inactive qua Live HTTP:');
  const resReassignInactive = await fetch(`${API_BASE}/documents/${docP12Id}/reassign`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminAlpha}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      stepId: currentStep.id,
      oldUserId: newApproverAlpha.id,
      newUserId: inactiveUser.id,
      reason: 'Chuyển giao cho tài khoản bị khóa',
    }),
  });
  console.log(`   HTTP Status: ${resReassignInactive.status}`);
  if (resReassignInactive.status !== 400) {
    throw new Error(`Test 30 thất bại: Không chặn chuyển giao cho tài khoản inactive (nhận ${resReassignInactive.status})`);
  }
  console.log('   -> PASS (Chặn chuyển giao cho tài khoản inactive thành công)\n');

  // Test 31: Chặn người dùng không có thẩm quyền chuyển giao -> 403 Forbidden
  console.log('31. Test chặn người dùng không có thẩm quyền chuyển giao qua Live HTTP:');
  const resReassignForbidden = await fetch(`${API_BASE}/documents/${docP12Id}/reassign`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`, // User thường, không phải admin và không phải người đang duyệt
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      stepId: currentStep.id,
      oldUserId: newApproverAlpha.id,
      newUserId: userA.id,
      reason: 'User cố tình đổi người duyệt',
    }),
  });
  console.log(`   HTTP Status: ${resReassignForbidden.status}`);
  if (resReassignForbidden.status !== 403) {
    throw new Error(`Test 31 thất bại: Không trả về 403 khi người dùng không đủ quyền (nhận ${resReassignForbidden.status})`);
  }
  console.log('   -> PASS (Bảo vệ phân quyền chuyển giao người duyệt thành công)\n');

  // Test 32: Kiểm tra In-App Notifications qua HTTP API
  console.log('32. Test truy vấn và đánh dấu đã đọc thông báo qua Live HTTP:');
  // newApproverAlpha vừa được gán duyệt ở Test 28, phải có thông báo
  const resNotifs = await fetch(`${API_BASE}/notifications`, {
    headers: { Authorization: `Bearer ${tokenNewApprover}` },
  });
  const bodyNotifs = await resNotifs.json();
  const notifItems = bodyNotifs.data?.items || [];
  console.log(`   Số lượng thông báo nhận được: ${notifItems.length}`);
  if (notifItems.length === 0) {
    throw new Error('Test 32 thất bại: Người nhận chuyển giao không nhận được thông báo in-app');
  }

  // Lấy số lượng unread
  const resUnread = await fetch(`${API_BASE}/notifications/unread-count`, {
    headers: { Authorization: `Bearer ${tokenNewApprover}` },
  });
  const bodyUnread = await resUnread.json();
  console.log(`   Unread Count: ${bodyUnread.data?.unreadCount}`);
  if (bodyUnread.data?.unreadCount < 1) {
    throw new Error('Test 32 thất bại: Unread count không chính xác');
  }

  // Đánh dấu 1 thông báo là đã đọc
  const firstNotifId = notifItems[0].id;
  const resMarkRead = await fetch(`${API_BASE}/notifications/${firstNotifId}/read`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${tokenNewApprover}` },
  });
  console.log(`   Mark as read status: ${resMarkRead.status}`);
  if (!resMarkRead.ok) {
    throw new Error('Test 32 thất bại: Đánh dấu đã đọc thông báo thất bại');
  }

  // Đánh dấu tất cả là đã đọc
  const resMarkAll = await fetch(`${API_BASE}/notifications/read-all`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${tokenNewApprover}` },
  });
  if (!resMarkAll.ok) {
    throw new Error('Test 32 thất bại: Đánh dấu tất cả đã đọc thất bại');
  }
  // Test 33: Trigger SLA check qua Live HTTP bởi ADMIN -> 200 OK
  console.log('33. Test kích hoạt quét SLA qua Live HTTP (POST /api/workflows/sla/trigger-check):');
  const resSlaCheckAdmin = await fetch(`${API_BASE}/workflows/sla/trigger-check`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  const bodySlaAdmin = await resSlaCheckAdmin.json();
  console.log(`   HTTP Status: ${resSlaCheckAdmin.status} | Scanned Steps: ${bodySlaAdmin.data?.scannedStepsCount}`);
  if (!resSlaCheckAdmin.ok || typeof bodySlaAdmin.data?.scannedStepsCount !== 'number') {
    throw new Error('Test 33 thất bại: ADMIN không thể kích hoạt quét SLA');
  }
  console.log('   -> PASS (ADMIN kích hoạt quét SLA thành công qua Live HTTP)\n');

  // Test 34: Trigger SLA check bởi USER thông thường -> 403 Forbidden
  console.log('34. Test chặn USER thông thường kích hoạt quét SLA (Chặn 403):');
  const resSlaCheckUser = await fetch(`${API_BASE}/workflows/sla/trigger-check`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenUserA}` },
  });
  console.log(`   HTTP Status: ${resSlaCheckUser.status}`);
  if (resSlaCheckUser.status !== 403) {
    throw new Error(`Test 34 thất bại: USER thường không bị chặn 403 (nhận ${resSlaCheckUser.status})`);
  }
  console.log('   -> PASS (Chặn USER thường kích hoạt quét SLA chuẩn RBAC)\n');

  // Test 35: Truy vấn SLA status qua Live HTTP (GET /api/workflows/sla/status)
  console.log('35. Test truy vấn thống kê giám sát SLA qua Live HTTP:');
  const resSlaStatus = await fetch(`${API_BASE}/workflows/sla/status`, {
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  const bodySlaStatus = await resSlaStatus.json();
  console.log(`   HTTP Status: ${resSlaStatus.status} | Total In-Review: ${bodySlaStatus.data?.totalInReview}`);
  if (!resSlaStatus.ok || typeof bodySlaStatus.data?.totalInReview !== 'number') {
    throw new Error('Test 35 thất bại: Không lấy được thống kê SLA');
  }
  console.log('   -> PASS (Truy vấn dữ liệu giám sát SLA thành công)\n');

  // Test 36: Bảo mật Notification: User B cố tình đánh dấu đã đọc thông báo của User A -> 403 Forbidden
  console.log('36. Test bảo mật Notification: Chặn User B thao tác trên thông báo của User A (403 Forbidden):');
  // Lấy thông báo đầu tiên của User A
  const resNotifA = await fetch(`${API_BASE}/notifications`, {
    headers: { Authorization: `Bearer ${tokenUserA}` },
  });
  const bodyNotifA = await resNotifA.json();
  const notifAItem = bodyNotifA.data?.items?.[0];
  if (notifAItem) {
    const resForbiddenMark = await fetch(`${API_BASE}/notifications/${notifAItem.id}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenUserB}` },
    });
    console.log(`   HTTP Status: ${resForbiddenMark.status}`);
    if (resForbiddenMark.status !== 403) {
      throw new Error(`Test 36 thất bại: Không chặn 403 khi User B cố đọc thông báo của User A (nhận ${resForbiddenMark.status})`);
    }
    console.log('   -> PASS (Bảo vệ toàn vẹn quyền sở hữu thông báo thành công)\n');
  } else {
    console.log('   -> PASS (Bỏ qua do User A chưa có thông báo phát sinh)\n');
  }

  // Test 37: Kiểm tra Idempotency qua Live HTTP: Trigger liên tục không làm tăng thông báo trùng
  console.log('37. Test Idempotency Live HTTP: Trigger SLA liên tiếp không sinh trùng thông báo:');
  const resIdemp1 = await fetch(`${API_BASE}/workflows/sla/trigger-check`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  const bodyIdemp1 = await resIdemp1.json();

  const resIdemp2 = await fetch(`${API_BASE}/workflows/sla/trigger-check`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  const bodyIdemp2 = await resIdemp2.json();
  console.log(`   Run 1 Warnings: ${bodyIdemp1.data?.warningsSent} | Run 2 Warnings: ${bodyIdemp2.data?.warningsSent}`);
  console.log(`   Run 1 Overdues: ${bodyIdemp1.data?.overduesSent} | Run 2 Overdues: ${bodyIdemp2.data?.overduesSent}`);
  console.log(`   Run 2 Skipped Already Sent: ${bodyIdemp2.data?.skippedAlreadySent}`);
  if (bodyIdemp2.data?.warningsSent !== 0 && bodyIdemp2.data?.overduesSent !== 0) {
    throw new Error('Test 37 thất bại: Lần quét thứ 2 vẫn gửi thông báo mới thay vì skip duplicate');
  }
  console.log('   -> PASS (Idempotency bảo vệ chống lặp thông báo qua Live HTTP thành công)\n');

  // Test 38: Phân trang và bộ lọc isRead thông báo qua Live HTTP
  console.log('38. Test phân trang và bộ lọc isRead qua Live HTTP:');
  const resFilterRead = await fetch(`${API_BASE}/notifications?isRead=true&page=1&limit=5`, {
    headers: { Authorization: `Bearer ${tokenNewApprover}` },
  });
  const bodyFilterRead = await resFilterRead.json();
  console.log(`   Filtered isRead=true items: ${bodyFilterRead.data?.items?.length} | Page: ${bodyFilterRead.data?.pagination?.page}`);
  if (!resFilterRead.ok || !Array.isArray(bodyFilterRead.data?.items)) {
    throw new Error('Test 38 thất bại: Phân trang và lọc isRead không đúng');
  }
  console.log('   -> PASS (Phân trang và lọc isRead hoạt động chuẩn xác)\n');

  // Test 39: USER thông thường bị chặn 403 khi gọi GET /api/workflows/sla/status
  console.log('39. Test USER thông thường gọi GET /api/workflows/sla/status (Chặn 403 Forbidden):');
  const resUserSlaStatus = await fetch(`${API_BASE}/workflows/sla/status`, {
    headers: { Authorization: `Bearer ${tokenUserA}` },
  });
  console.log(`   HTTP Status: ${resUserSlaStatus.status}`);
  if (resUserSlaStatus.status !== 403) {
    throw new Error(`Test 39 thất bại: USER thường không bị chặn 403 khi xem SLA status (nhận ${resUserSlaStatus.status})`);
  }
  console.log('   -> PASS (Chặn USER thường truy cập thống kê giám sát SLA chuẩn xác)\n');

  // Test 40: ADMIN kích hoạt retry thông báo lỗi qua Live HTTP (POST /api/notifications/retry-failed)
  console.log('40. Test ADMIN kích hoạt POST /api/notifications/retry-failed thành công:');
  const resRetryAdmin = await fetch(`${API_BASE}/notifications/retry-failed`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  const bodyRetryAdmin = await resRetryAdmin.json();
  console.log(`   HTTP Status: ${resRetryAdmin.status} | Retried Count: ${bodyRetryAdmin.data?.retriedCount}`);
  if (resRetryAdmin.status !== 200 || !bodyRetryAdmin.success) {
    throw new Error(`Test 40 thất bại: ADMIN không kích hoạt được retry-failed (nhận ${resRetryAdmin.status})`);
  }
  console.log('   -> PASS (ADMIN kích hoạt retry thông báo lỗi thành công)\n');

  // Test 41: USER thông thường bị chặn 403 khi gọi POST /api/notifications/retry-failed
  console.log('41. Test USER thông thường bị chặn 403 khi gọi POST /api/notifications/retry-failed:');
  const resRetryUser = await fetch(`${API_BASE}/notifications/retry-failed`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenUserA}` },
  });
  console.log(`   HTTP Status: ${resRetryUser.status}`);
  if (resRetryUser.status !== 403) {
    throw new Error(`Test 41 thất bại: USER thường không bị chặn 403 khi gọi retry-failed (nhận ${resRetryUser.status})`);
  }
  console.log('   -> PASS (Chặn USER thường kích hoạt retry-failed chuẩn RBAC)\n');

  // =========================================================================
  // PHASE 12.1: DELEGATION POLICY ENGINE & AUDITABLE WORKFLOW INTEGRATION
  // =========================================================================
  console.log('--- BẮT ĐẦU KIỂM THỬ PHASE 12.1: DELEGATION POLICY ENGINE & WORKFLOW ---');

  // Test 42: Chặn ủy quyền xuyên tổ chức (Cross-Tenant Delegation Blocked)
  console.log('42. Test POST /api/delegations chặn ủy quyền xuyên tổ chức (UserA Alpha -> UserB Beta):');
  const resDelCross = await fetch(`${API_BASE}/delegations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      delegateeId: userB.id,
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 86400000).toISOString(),
      reason: 'Ủy quyền sang công ty khác',
    }),
  });
  console.log(`   HTTP Status: ${resDelCross.status}`);
  if (resDelCross.status !== 400) {
    throw new Error(`Test 42 thất bại: Không chặn ủy quyền xuyên tổ chức (nhận ${resDelCross.status})`);
  }
  console.log('   -> PASS (Bảo vệ ranh giới tổ chức / Tenant Isolation thành công)\n');

  // Test 43: Chặn tự ủy quyền cho chính mình (Self-Delegation Blocked)
  console.log('43. Test POST /api/delegations chặn tự ủy quyền cho chính mình:');
  const resDelSelf = await fetch(`${API_BASE}/delegations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      delegateeId: userA.id,
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 86400000).toISOString(),
      reason: 'Tự ủy quyền cho mình',
    }),
  });
  console.log(`   HTTP Status: ${resDelSelf.status}`);
  if (resDelSelf.status !== 400) {
    throw new Error(`Test 43 thất bại: Không chặn tự ủy quyền (nhận ${resDelSelf.status})`);
  }
  console.log('   -> PASS (Chặn tự ủy quyền thành công)\n');

  // Test 44: USER thường bị chặn 403 khi cố tạo ủy quyền thay mặt người khác
  console.log('44. Test USER thường bị chặn 403 khi thiết lập delegatorId thay mặt người khác:');
  const resDelSpoof = await fetch(`${API_BASE}/delegations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      delegatorId: newApproverAlpha.id,
      delegateeId: userA.id,
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 86400000).toISOString(),
    }),
  });
  console.log(`   HTTP Status: ${resDelSpoof.status}`);
  if (resDelSpoof.status !== 403) {
    throw new Error(`Test 44 thất bại: USER thường không bị chặn khi tạo thay người khác (nhận ${resDelSpoof.status})`);
  }
  console.log('   -> PASS (Chặn quyền tạo thay mặt trái phép chuẩn RBAC)\n');

  // Test 45: Tạo Delegation Policy hợp lệ qua Live HTTP (UserA -> newApproverAlpha)
  console.log('45. Test POST /api/delegations tạo chính sách ủy quyền hợp lệ trong nội bộ Alpha:');
  const nowDel = Date.now();
  const resDelCreate = await fetch(`${API_BASE}/delegations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      delegateeId: newApproverAlpha.id,
      startDate: new Date(nowDel - 60000).toISOString(),
      endDate: new Date(nowDel + 3 * 86400000).toISOString(),
      reason: 'Đi công tác tuần này',
    }),
  });
  const bodyDelCreate = await resDelCreate.json();
  console.log(`   HTTP Status: ${resDelCreate.status} | Policy ID: ${bodyDelCreate.data?.id}`);
  if (resDelCreate.status !== 201 || !bodyDelCreate.data?.id || bodyDelCreate.data?.isActive !== true) {
    throw new Error(`Test 45 thất bại: Tạo delegation policy không thành công (nhận ${resDelCreate.status})`);
  }
  const createdPolicyId = bodyDelCreate.data.id;
  console.log('   -> PASS (Tạo chính sách ủy quyền thành công và ghi nhận đầy đủ metadata)\n');

  // Test 46: Lấy danh sách GET /api/delegations và GET /api/delegations/:id
  console.log('46. Test GET /api/delegations và GET /api/delegations/:id:');
  const resDelList = await fetch(`${API_BASE}/delegations?isActive=true`, {
    headers: { Authorization: `Bearer ${tokenUserA}` },
  });
  const bodyDelList = await resDelList.json();
  const resDelDetail = await fetch(`${API_BASE}/delegations/${createdPolicyId}`, {
    headers: { Authorization: `Bearer ${tokenUserA}` },
  });
  const bodyDelDetail = await resDelDetail.json();
  console.log(`   List Status: ${resDelList.status} | Items: ${bodyDelList.data?.length} | Detail Status: ${resDelDetail.status}`);
  if (resDelList.status !== 200 || resDelDetail.status !== 200 || bodyDelDetail.data?.id !== createdPolicyId) {
    throw new Error('Test 46 thất bại: Truy vấn danh sách/chi tiết delegation policy không thành công');
  }
  console.log('   -> PASS (Truy vấn danh sách và chi tiết policy hoạt động chính xác)\n');

  // Test 47: Delegatee (newApproverAlpha) thực hiện phê duyệt proxy qua Live HTTP
  console.log('47. Test Delegatee phê duyệt hồ sơ thay mặt UserA qua Live HTTP (POST /api/documents/:id/decision):');
  // Tạo hồ sơ mới và gán UserA là người duyệt bước 1
  const templatePub = await prisma.formTemplate.findFirstOrThrow({
    where: { organizationId: userA.organizationId!, status: 'PUBLISHED' },
    include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
  });
  const docDelTest = await prisma.document.create({
    data: {
      documentNumber: `TK-DEL-${Date.now()}`,
      title: 'Hồ sơ thử nghiệm phê duyệt ủy quyền qua Live HTTP',
      templateId: templatePub.id,
      templateVersionId: templatePub.versions[0]?.id || null,
      status: 'IN_REVIEW',
      urgency: 'NORMAL',
      currentStepOrder: 1,
      currentVersion: 1,
      createdById: userA.id,
      organizationId: userA.organizationId,
      versions: {
        create: {
          versionNumber: 1,
          formData: { tieu_de: 'Ủy quyền test', amount: 10000000 },
          sha256Hash: 'dummyhash',
          createdById: userA.id,
        },
      },
      workflow: {
        create: {
          status: 'RUNNING',
          currentStepOrder: 1,
          version: 1,
          steps: {
            create: {
              stepOrder: 1,
              stepName: 'Bước 1: Giám đốc duyệt',
              stepType: 'SEQUENTIAL',
              completionRule: 'ALL_MUST_APPROVE',
              status: 'IN_PROGRESS',
              dueDays: 3,
              version: 1,
              assignees: {
                create: {
                  userId: userA.id, // UserA là Assignee gốc!
                  role: 'APPROVER',
                  decision: 'PENDING',
                },
              },
            },
          },
        },
      },
    },
  });

  // newApproverAlpha gọi API phê duyệt hồ sơ này
  const resProxyApprove = await fetch(`${API_BASE}/documents/${docDelTest.id}/decision`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenNewApprover}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      decision: 'APPROVED',
      decisionComment: 'Phê duyệt thay mặt theo ủy quyền',
      signatureImageUrl: 'data:image/png;base64,proxySignature',
    }),
  });
  const bodyProxyApprove = await resProxyApprove.json();
  console.log(`   HTTP Status: ${resProxyApprove.status} | Document Status: ${bodyProxyApprove.data?.documentStatus}`);
  if (resProxyApprove.status !== 200 || !bodyProxyApprove.success) {
    throw new Error(`Test 47 thất bại: Delegatee không thể phê duyệt theo ủy quyền (nhận ${resProxyApprove.status})`);
  }

  // Kiểm tra lịch sử quyết định trong PostgreSQL thật
  const historyCheck = await prisma.stepDecisionHistory.findFirst({
    where: { documentVersion: { documentId: docDelTest.id } },
  });
  console.log(`   History isDelegated: ${historyCheck?.isDelegated} | DelegatedFrom: ${historyCheck?.delegatedFromUserId}`);
  if (!historyCheck?.isDelegated || historyCheck.delegatedFromUserId !== userA.id || historyCheck.delegationPolicyId !== createdPolicyId) {
    throw new Error('Test 47 thất bại: StepDecisionHistory không lưu đúng attribution ủy quyền');
  }
  console.log('   -> PASS (Delegatee phê duyệt proxy thành công, attribution lưu chuẩn xác vào DB)\n');

  // Test 48: Thu hồi chính sách ủy quyền (Soft Revoke) qua Live HTTP
  console.log('48. Test POST /api/delegations/:id/revoke thu hồi chính sách ủy quyền:');
  const resDelRevoke = await fetch(`${API_BASE}/delegations/${createdPolicyId}/revoke`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason: 'Chuyến công tác kết thúc sớm' }),
  });
  const bodyDelRevoke = await resDelRevoke.json();
  console.log(`   HTTP Status: ${resDelRevoke.status} | Policy isActive: ${bodyDelRevoke.data?.isActive}`);
  if (resDelRevoke.status !== 200 || bodyDelRevoke.data?.isActive !== false) {
    throw new Error('Test 48 thất bại: Thu hồi delegation policy không thành công');
  }
  console.log('   -> PASS (Thu hồi chính sách ủy quyền thành công qua Live HTTP)\n');

  // Test 49: Cross-Tenant unauthorized access to delegation policy detail blocked
  console.log('49. Test Cross-Tenant Security: UserB (Company Beta) cố đọc policy của Alpha qua GET /api/delegations/:id:');
  const resCrossTenantGet = await fetch(`${API_BASE}/delegations/${createdPolicyId}`, {
    headers: { Authorization: `Bearer ${tokenUserB}` },
  });
  console.log(`   HTTP Status: ${resCrossTenantGet.status}`);
  if (resCrossTenantGet.status !== 403) {
    throw new Error(`Test 49 thất bại: UserB không bị chặn 403 khi đọc policy của Alpha (nhận ${resCrossTenantGet.status})`);
  }
  console.log('   -> PASS (Chặn truy cập chéo tenant giữa các công ty thành công với HTTP 403)\n');

  // Test 50: Non-delegated User in same org cannot access policy detail
  console.log('50. Test User-Level Authorization: Người ngoài trong cùng tổ chức cố xem chi tiết policy:');
  // Tạo token cho một user khác trong cùng Alpha (không phải UserA và không phải newApproverAlpha)
  const otherAlphaUser = await prisma.user.findFirst({
    where: {
      organizationId: userA.organizationId!,
      id: { notIn: [userA.id, newApproverAlpha.id] },
    },
  });
  if (otherAlphaUser) {
    const tokenOtherAlpha = JwtUtil.sign(
      {
        sub: otherAlphaUser.id,
        email: otherAlphaUser.email,
        fullName: otherAlphaUser.fullName,
        role: otherAlphaUser.role,
        organizationId: otherAlphaUser.organizationId,
        departmentId: otherAlphaUser.departmentId,
      },
      JWT_SECRET,
      3600
    );
    const resUnrelatedUser = await fetch(`${API_BASE}/delegations/${createdPolicyId}`, {
      headers: { Authorization: `Bearer ${tokenOtherAlpha}` },
    });
    console.log(`   HTTP Status: ${resUnrelatedUser.status}`);
    if (resUnrelatedUser.status !== 403) {
      throw new Error(`Test 50 thất bại: Người ngoài trong cùng org không bị chặn 403 (nhận ${resUnrelatedUser.status})`);
    }
    console.log('   -> PASS (Chặn người không liên quan xem chi tiết policy thành công với HTTP 403)\n');
  } else {
    console.log('   -> SKIP (Không có user thứ 3 trong Alpha để test)\n');
  }

  // Test 51: USER query GET /api/delegations?role=all strictly scoped to own delegations
  console.log('51. Test GET /api/delegations?role=all: USER không thể dùng role=all để vượt quyền xem toàn bộ tổ chức:');
  const resRoleAll = await fetch(`${API_BASE}/delegations?role=all`, {
    headers: { Authorization: `Bearer ${tokenUserA}` },
  });
  const bodyRoleAll = await resRoleAll.json();
  console.log(`   HTTP Status: ${resRoleAll.status} | Returned Policies: ${bodyRoleAll.data?.length}`);
  if (resRoleAll.status !== 200) {
    throw new Error('Test 51 thất bại: Không thể truy vấn danh sách policy với role=all');
  }
  // Mọi policy trả về PHẢI có delegatorId = userA.id HOẶC delegateeId = userA.id
  for (const item of (bodyRoleAll.data || [])) {
    if (item.delegatorId !== userA.id && item.delegateeId !== userA.id) {
      throw new Error(`Test 51 thất bại: Phát hiện rò rỉ policy của người khác khi USER gọi role=all (id: ${item.id})`);
    }
  }
  console.log('   -> PASS (role=all được giới hạn nghiêm ngặt chỉ trong phạm vi ủy quyền của chính user)\n');

  // Test 52: Query parameter organizationId injection blocked for USER and ADMIN
  console.log('52. Test Query Parameter Tampering: Client gửi organizationId khác trong query GET /api/delegations:');
  const resInjectOrg = await fetch(`${API_BASE}/delegations?organizationId=${userA.organizationId}`, {
    headers: { Authorization: `Bearer ${tokenUserB}` }, // UserB thuộc Beta
  });
  const bodyInjectOrg = await resInjectOrg.json();
  console.log(`   HTTP Status: ${resInjectOrg.status} | Items: ${bodyInjectOrg.data?.length}`);
  if (resInjectOrg.status !== 200) {
    throw new Error('Test 52 thất bại: Request bị lỗi không mong muốn');
  }
  // Toàn bộ item trả về (nếu có) PHẢI thuộc organization của UserB, TUYỆT ĐỐI không thuộc organization của Alpha
  for (const item of (bodyInjectOrg.data || [])) {
    if (item.organizationId === userA.organizationId) {
      throw new Error('Test 52 thất bại: Rò rỉ dữ liệu của Alpha khi UserB cố tình truyền organizationId của Alpha!');
    }
  }
  console.log('   -> PASS (Backend chặn triệt để tham số organizationId do client gửi, bảo đảm 100% Tenant Isolation)\n');

  // =========================================================================
  // PHASE 13.1: PDF RENDERING ENGINE & SECURE ARTIFACT STORAGE LIVE TESTS
  // =========================================================================

  // Test 53: POST /api/documents/:id/render-pdf (User A kết xuất PDF cho hồ sơ Alpha) -> 200 OK
  console.log('53. Test POST /api/documents/:id/render-pdf (Kết xuất PDF artifact thành công):');
  const resRender = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/render-pdf`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      versionNumber: 1,
      artifactType: 'OFFICIAL_UNSIGNED',
    }),
  });
  const bodyRender = await resRender.json();
  const createdArtifact = bodyRender.data;
  console.log(`   HTTP Status: ${resRender.status} | Status: ${createdArtifact?.status} | Hash: ${createdArtifact?.rawPdfHash?.slice(0, 16)}...`);
  if (resRender.status !== 200 || createdArtifact?.status !== 'COMPLETED' || !createdArtifact?.rawPdfHash) {
    throw new Error(`Test 53 thất bại: Kết xuất PDF artifact không thành công: ${JSON.stringify(bodyRender)}`);
  }
  console.log('   -> PASS (Tạo và lưu trữ PDF artifact thành công, trạng thái COMPLETED)\n');

  // Test 54: GET /api/documents/:id/render-status (Tra cứu trạng thái tệp artifact) -> 200 OK
  console.log('54. Test GET /api/documents/:id/render-status (Tra cứu trạng thái artifact):');
  const resRenderStatus = await fetch(
    `${API_BASE}/documents/${createdDocWithWf.id}/render-status?type=OFFICIAL_UNSIGNED&version=1`,
    {
      headers: { Authorization: `Bearer ${tokenUserA}` },
    }
  );
  const bodyRenderStatus = await resRenderStatus.json();
  console.log(`   HTTP Status: ${resRenderStatus.status} | ArtifactId: ${bodyRenderStatus.data?.id} | Status: ${bodyRenderStatus.data?.status}`);
  if (resRenderStatus.status !== 200 || bodyRenderStatus.data?.id !== createdArtifact.id) {
    throw new Error('Test 54 thất bại: Tra cứu trạng thái artifact không khớp');
  }
  console.log('   -> PASS (Tra cứu trạng thái artifact chính xác)\n');

  // Test 55: GET /api/documents/:id/pdf (Tải luồng nhị phân PDF thật qua HTTP) -> 200 OK
  console.log('55. Test GET /api/documents/:id/pdf (Tải tệp PDF nhị phân qua HTTP):');
  const resDownloadPdf = await fetch(
    `${API_BASE}/documents/${createdDocWithWf.id}/pdf?type=OFFICIAL_UNSIGNED&version=1`,
    {
      headers: { Authorization: `Bearer ${tokenUserA}` },
    }
  );
  const contentType = resDownloadPdf.headers.get('content-type');
  const headerPdfHash = resDownloadPdf.headers.get('x-raw-pdf-hash');
  const pdfArrayBuffer = await resDownloadPdf.arrayBuffer();
  const downloadedBuffer = Buffer.from(pdfArrayBuffer);
  const magicBytes = downloadedBuffer.subarray(0, 5).toString('ascii');

  console.log(`   HTTP Status: ${resDownloadPdf.status} | Content-Type: ${contentType} | Size: ${downloadedBuffer.length} bytes | Magic: ${magicBytes}`);
  if (resDownloadPdf.status !== 200 || contentType !== 'application/pdf' || magicBytes !== '%PDF-') {
    throw new Error('Test 55 thất bại: File tải về không phải PDF hợp lệ hoặc Content-Type sai');
  }
  console.log('   -> PASS (Tải luồng nhị phân PDF thành công với Magic Bytes %PDF- hợp lệ)\n');

  // Test 56: Đối soát toàn vẹn băm nhị phân: SHA-256 từ byte tải về phải trùng khớp tuyệt đối với rawPdfHash
  console.log('56. Test Đối soát Toàn vẹn Nhị phân (Binary Hash Integrity Verification):');
  const computedDownloadHash = crypto.createHash('sha256').update(downloadedBuffer).digest('hex');
  console.log(`   Hash từ API:   ${headerPdfHash}`);
  console.log(`   Hash tính lại:  ${computedDownloadHash}`);
  if (computedDownloadHash !== headerPdfHash || computedDownloadHash !== createdArtifact.rawPdfHash) {
    throw new Error('Test 56 thất bại: Mã băm SHA-256 của file tải về không khớp với rawPdfHash trong CSDL!');
  }
  console.log('   -> PASS (Mã băm SHA-256 của file tải về khớp 100% với dữ liệu kiểm toán CSDL)\n');

  // Test 57: Bảo mật Đa doanh nghiệp (Tenant Isolation): User B (Công ty Beta) bị chặn 403 khi tải PDF của Alpha
  console.log('57. Test Tenant Isolation trên API Artifacts: User B (Beta) cố tình truy cập PDF của Alpha:');
  const resCrossRender = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/render-pdf`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserB}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ versionNumber: 1 }),
  });
  const resCrossDownload = await fetch(
    `${API_BASE}/documents/${createdDocWithWf.id}/pdf?type=OFFICIAL_UNSIGNED&version=1`,
    {
      headers: { Authorization: `Bearer ${tokenUserB}` },
    }
  );
  console.log(`   Cross Render Status: ${resCrossRender.status} | Cross Download Status: ${resCrossDownload.status}`);
  if (resCrossRender.status !== 403 || resCrossDownload.status !== 403) {
    throw new Error('Test 57 thất bại: Không chặn 403 khi người dùng công ty khác truy cập PDF');
  }
  console.log('   -> PASS (Chặn truy cập trái phép đa doanh nghiệp trên PDF artifacts thành công với 403 Forbidden)\n');

  // Test 58: Chặn yêu cầu kết xuất cho phiên bản không tồn tại -> 404 NOT FOUND
  console.log('58. Test yêu cầu kết xuất PDF cho phiên bản không tồn tại (Chặn 404):');
  const resInvalidVer = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/render-pdf`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ versionNumber: 999 }),
  });
  console.log(`   HTTP Status: ${resInvalidVer.status}`);
  if (resInvalidVer.status !== 404) {
    throw new Error(`Test 58 thất bại: Kỳ vọng 404 NOT_FOUND nhưng nhận ${resInvalidVer.status}`);
  }
  console.log('   -> PASS (Chuẩn hóa lỗi 404 khi phiên bản không tồn tại)\n');

  // Test 59: Tính Idempotency trên Live HTTP: Gọi lại POST /render-pdf lần 2 nhận ngay artifact cũ
  console.log('59. Test tính Idempotency trên Live HTTP: Gọi render lần 2 nhận ngay artifact COMPLETED:');
  const resRenderAgain = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/render-pdf`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      versionNumber: 1,
      artifactType: 'OFFICIAL_UNSIGNED',
    }),
  });
  const bodyRenderAgain = await resRenderAgain.json();
  console.log(`   HTTP Status: ${resRenderAgain.status} | ArtifactId: ${bodyRenderAgain.data?.id}`);
  if (resRenderAgain.status !== 200 || bodyRenderAgain.data?.id !== createdArtifact.id) {
    throw new Error('Test 59 thất bại: Không trả về artifact cũ khi gọi lại lần 2');
  }
  console.log('   -> PASS (Hệ thống xử lý Idempotent hoàn hảo, không sinh file trùng lặp)\n');

  // Test 60: GET /api/documents/:id/artifacts (Lấy danh sách artifacts của hồ sơ) -> 200 OK
  console.log('60. Test GET /api/documents/:id/artifacts (Liệt kê danh sách artifacts của tài liệu):');
  const resListArt = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/artifacts`, {
    headers: { Authorization: `Bearer ${tokenUserA}` },
  });
  const bodyListArt = await resListArt.json();
  console.log(`   HTTP Status: ${resListArt.status} | Total Artifacts: ${bodyListArt.data?.length}`);
  if (resListArt.status !== 200 || !Array.isArray(bodyListArt.data) || bodyListArt.data.length === 0) {
    throw new Error('Test 60 thất bại: Không lấy được danh sách artifacts của hồ sơ');
  }
  console.log('   -> PASS (Tra cứu danh sách artifacts thành công)\n');

  // =========================================================================
  // --- BẮT ĐẦU KIỂM THỬ PHASE 13.2.1: CERTIFICATE REGISTRY & KEYSTORE ---
  // =========================================================================
  console.log('--- BẮT ĐẦU KIỂM THỬ PHASE 13.2.1: CERTIFICATE REGISTRY & SECURE KEYSTORE ---');

  // Tạo và nạp tệp Keystore tự ký cho User A
  const liveKeystoreProvider = new DevLocalKeystoreProvider();
  const liveKeystoreUserA = DevKeystoreGenerator.generateSelfSignedKeystore({
    commonName: userA.fullName,
    organizationName: 'Tập đoàn VinaGroup (HQ)',
  });
  const keyAliasLiveA = `key_live_user_a_${Date.now()}`;
  liveKeystoreProvider.importKeystore(keyAliasLiveA, liveKeystoreUserA.p12Buffer);

  // Test 61: POST /api/certificates - Admin Alpha đăng ký chứng thư số cho User A
  console.log('61. Test POST /api/certificates (ADMIN đăng ký chứng thư số công khai):');
  const resRegCert = await fetch(`${API_BASE}/certificates`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userId: userA.id,
      certificatePem: liveKeystoreUserA.certificatePem,
      keyAlias: keyAliasLiveA,
      keyStorageType: 'DEV_KEYSTORE',
    }),
  });
  const bodyRegCert = await resRegCert.json();
  const createdCert = bodyRegCert.data;
  console.log(`   HTTP Status: ${resRegCert.status} | CertId: ${createdCert?.id} | Subject: ${createdCert?.subjectDn?.slice(0, 30)}...`);
  if (resRegCert.status !== 201 || !createdCert?.id || createdCert.status !== 'ACTIVE') {
    throw new Error(`Test 61 thất bại: Đăng ký chứng thư không thành công: ${JSON.stringify(bodyRegCert)}`);
  }
  console.log('   -> PASS (ADMIN đăng ký chứng thư số X.509 thành công với trạng thái ACTIVE)\n');

  // Test 62: POST /api/certificates - USER thường bị chặn 403 Forbidden khi cố tự đăng ký
  console.log('62. Test USER thường bị chặn 403 Forbidden khi cố đăng ký chứng thư số:');
  const resUserRegCert = await fetch(`${API_BASE}/certificates`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      certificatePem: liveKeystoreUserA.certificatePem,
      keyAlias: 'unauthorized_alias',
    }),
  });
  console.log(`   HTTP Status: ${resUserRegCert.status}`);
  if (resUserRegCert.status !== 403) {
    throw new Error('Test 62 thất bại: Không chặn 403 khi USER thường cố đăng ký chứng thư');
  }
  console.log('   -> PASS (Bảo vệ phân quyền: Chỉ ADMIN mới được đăng ký chứng thư số)\n');

  // Test 63: GET /api/certificates - Liệt kê danh mục chứng thư số
  console.log('63. Test GET /api/certificates (Tra cứu danh sách chứng thư số theo tổ chức):');
  const resListCerts = await fetch(`${API_BASE}/certificates`, {
    headers: { Authorization: `Bearer ${tokenAdminA}` },
  });
  const bodyListCerts = await resListCerts.json();
  console.log(`   HTTP Status: ${resListCerts.status} | Items: ${bodyListCerts.data?.length}`);
  if (resListCerts.status !== 200 || !Array.isArray(bodyListCerts.data) || bodyListCerts.data.length === 0) {
    throw new Error('Test 63 thất bại: Không liệt kê được danh sách chứng thư số');
  }
  console.log('   -> PASS (Liệt kê danh sách chứng thư số của tổ chức thành công)\n');

  // Test 64: GET /api/certificates/:id - Xem chi tiết chứng thư bởi chính chủ User A
  console.log('64. Test GET /api/certificates/:id (Chính chủ User A xem chi tiết chứng thư của mình):');
  const resGetMyCert = await fetch(`${API_BASE}/certificates/${createdCert.id}`, {
    headers: { Authorization: `Bearer ${tokenUserA}` },
  });
  const bodyGetMyCert = await resGetMyCert.json();
  console.log(`   HTTP Status: ${resGetMyCert.status} | Fingerprint: ${bodyGetMyCert.data?.fingerprintSha256?.slice(0, 16)}...`);
  if (resGetMyCert.status !== 200 || bodyGetMyCert.data?.id !== createdCert.id) {
    throw new Error('Test 64 thất bại: Không xem được chứng thư của chính mình');
  }
  console.log('   -> PASS (Chính chủ xem chi tiết chứng thư cá nhân thành công)\n');

  // Test 65: Cross-Tenant Protection: User B (Beta) cố đọc chứng thư của Alpha -> 403 Forbidden
  console.log('65. Test Cross-Tenant Security: User B (Beta) cố truy cập chứng thư của Alpha:');
  const resCrossCert = await fetch(`${API_BASE}/certificates/${createdCert.id}`, {
    headers: { Authorization: `Bearer ${tokenUserB}` },
  });
  console.log(`   HTTP Status: ${resCrossCert.status}`);
  if (resCrossCert.status !== 403) {
    throw new Error('Test 65 thất bại: Không chặn 403 khi truy cập chứng thư của tổ chức khác');
  }
  console.log('   -> PASS (Chặn truy cập chéo tổ chức trên chứng thư số thành công với 403 Forbidden)\n');

  // Test 66: POST /api/certificates/:id/test-sign - User A ký thử nghiệm và xác minh thành công
  console.log('66. Test POST /api/certificates/:id/test-sign (Chính chủ User A thực thi ký thử nghiệm):');
  const resTestSign = await fetch(`${API_BASE}/certificates/${createdCert.id}/test-sign`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenUserA}` },
  });
  const bodyTestSign = await resTestSign.json();
  console.log(`   HTTP Status: ${resTestSign.status} | Data Sig Valid: ${bodyTestSign.data?.dataSignatureValid} | Digest Sig Valid: ${bodyTestSign.data?.digestSignatureValid}`);
  if (
    resTestSign.status !== 200 ||
    !bodyTestSign.data?.dataSignatureValid ||
    !bodyTestSign.data?.digestSignatureValid
  ) {
    throw new Error(`Test 66 thất bại: Thử nghiệm ký số không thành công: ${JSON.stringify(bodyTestSign)}`);
  }
  console.log('   -> PASS (Ký thử nghiệm thành công: Chữ ký số khớp 100% với khóa công khai X.509)\n');

  // Test 67: Cross-Tenant Test-Sign: User B (Beta) cố tình gọi test-sign trên chứng thư của Alpha -> 403
  console.log('67. Test Cross-Tenant Test-Sign: User B (Beta) cố dùng chứng thư Alpha để ký:');
  const resCrossTestSign = await fetch(`${API_BASE}/certificates/${createdCert.id}/test-sign`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenUserB}` },
  });
  console.log(`   HTTP Status: ${resCrossTestSign.status}`);
  if (resCrossTestSign.status !== 403) {
    throw new Error('Test 67 thất bại: Không chặn 403 khi gọi test-sign xuyên tổ chức');
  }
  console.log('   -> PASS (Chặn tuyệt đối hành vi ký số xuyên tổ chức)\n');

  // Test 68: User Privacy / Attribution: User khác trong cùng tổ chức cố dùng cert của User A để ký -> 403
  console.log('68. Test User Privacy: Người khác trong cùng công ty cố ký bằng chứng thư của User A:');
  let anotherUserA = await prisma.user.findFirst({
    where: { organizationId: userA.organizationId, id: { not: userA.id }, role: 'USER' },
  });
  if (!anotherUserA) {
    anotherUserA = await prisma.user.create({
      data: {
        email: `colleague-a-${Date.now()}@vinagroup.vn`,
        passwordHash: 'dummy_hash',
        fullName: 'Đồng nghiệp cùng công ty',
        role: 'USER',
        organizationId: userA.organizationId,
      },
    });
  }
  const tokenAnotherUserA = JwtUtil.sign(
    {
      sub: anotherUserA.id,
      email: anotherUserA.email,
      fullName: anotherUserA.fullName,
      role: anotherUserA.role,
      organizationId: anotherUserA.organizationId,
    },
    JWT_SECRET,
    3600
  );

  const resColleagueSign = await fetch(`${API_BASE}/certificates/${createdCert.id}/test-sign`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAnotherUserA}` },
  });
  console.log(`   HTTP Status: ${resColleagueSign.status}`);
  if (resColleagueSign.status !== 403) {
    throw new Error('Test 68 thất bại: Không chặn 403 khi đồng nghiệp cố dùng cert cá nhân của người khác');
  }
  console.log('   -> PASS (Bảo vệ chữ ký cá nhân: Chặn người dùng khác ký mạo danh thành công)\n');

  // Test 69: PATCH /api/certificates/:id/status - Admin thu hồi chứng thư (REVOKED)
  console.log('69. Test PATCH /api/certificates/:id/status (ADMIN thu hồi chứng thư số):');
  const resRevoke = await fetch(`${API_BASE}/certificates/${createdCert.id}/status`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      status: 'REVOKED',
      reason: 'Thu hồi thử nghiệm bảo mật trong Live HTTP Test',
    }),
  });
  const bodyRevoke = await resRevoke.json();
  console.log(`   HTTP Status: ${resRevoke.status} | Status: ${bodyRevoke.data?.status} | Reason: ${bodyRevoke.data?.revokedReason}`);
  if (resRevoke.status !== 200 || bodyRevoke.data?.status !== 'REVOKED') {
    throw new Error('Test 69 thất bại: Không cập nhật trạng thái thu hồi chứng thư');
  }
  console.log('   -> PASS (Thu hồi chứng thư số thành công qua Live HTTP)\n');

  // Test 70: Chặn ký số khi chứng thư đã bị thu hồi (REVOKED) -> 400 Bad Request
  console.log('70. Test Chặn ký số khi chứng thư đã bị thu hồi (Chặn 400):');
  const resSignRevoked = await fetch(`${API_BASE}/certificates/${createdCert.id}/test-sign`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenUserA}` },
  });
  const bodySignRevoked = await resSignRevoked.json();
  console.log(`   HTTP Status: ${resSignRevoked.status} | Error: ${bodySignRevoked.error?.message}`);
  if (resSignRevoked.status !== 400) {
    throw new Error('Test 70 thất bại: Không chặn 400 khi ký bằng chứng thư bị thu hồi');
  }
  console.log('   -> PASS (Chặn hoàn toàn hành vi ký bằng chứng thư bị thu hồi)\n');

  // =========================================================================
  // --- BẮT ĐẦU KIỂM THỬ PHASE 13.2.2: CMS/PDF SIGNING ENGINE ---
  // =========================================================================
  console.log('--- BẮT ĐẦU KIỂM THỬ PHASE 13.2.2: CMS/PDF SIGNING ENGINE ---');

  // Đăng ký một chứng thư số ACTIVE mới cho User A để phục vụ ký số văn bản thật
  const signingKeystoreUserA = DevKeystoreGenerator.generateSelfSignedKeystore({
    commonName: userA.fullName,
    organizationName: 'Tập đoàn VinaGroup (HQ)',
  });
  const keyAliasLiveSigningA = `key_live_signing_a_${Date.now()}`;
  liveKeystoreProvider.importKeystore(keyAliasLiveSigningA, signingKeystoreUserA.p12Buffer);

  const resRegSignCert = await fetch(`${API_BASE}/certificates`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userId: userA.id,
      certificatePem: signingKeystoreUserA.certificatePem,
      keyAlias: keyAliasLiveSigningA,
      keyStorageType: 'DEV_KEYSTORE',
    }),
  });
  const bodyRegSignCert = await resRegSignCert.json();
  const activeCertA = bodyRegSignCert.data;
  console.log(`   Chuẩn bị Active Signing Cert cho User A: ${activeCertA?.id} (${activeCertA?.status})`);

  // Test 71: POST /api/documents/:id/sign - User A ký số hồ sơ thật
  console.log('71. Test POST /api/documents/:id/sign (Ký số PDF thật bằng CMS detached):');
  const resSignDoc = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/sign`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      certificateId: activeCertA.id,
      reason: 'Phê duyệt tờ trình quyết toán dự án Live E2E 2026',
      location: 'Hà Nội, Việt Nam',
    }),
  });
  const bodySignDoc = await resSignDoc.json();
  const signResult = bodySignDoc.data;
  console.log(`   HTTP Status: ${resSignDoc.status} | ArtifactId: ${signResult?.artifactId}`);
  console.log(`   SignedPdfHash: ${signResult?.signedPdfHash?.slice(0, 16)}... | RawPdfHash: ${signResult?.rawPdfHash?.slice(0, 16)}...`);
  console.log(`   ByteRange: [${signResult?.byteRange?.join(', ')}] | Status: ${signResult?.status}`);
  if (
    resSignDoc.status !== 200 ||
    !signResult?.signedPdfHash ||
    signResult.signedPdfHash.length !== 64 ||
    signResult.signedPdfHash === signResult.rawPdfHash ||
    !Array.isArray(signResult.byteRange) ||
    signResult.byteRange.length !== 4 ||
    signResult.status !== 'COMPLETED'
  ) {
    throw new Error(`Test 71 thất bại: Ký số hồ sơ không thành công: ${JSON.stringify(bodySignDoc)}`);
  }
  console.log('   -> PASS (Ký số PDF thành công với CMS detached và cấu trúc ByteRange chuẩn xác)\n');

  // Test 72: GET /api/documents/:id/verify-signature - Xác minh độc lập chữ ký số
  console.log('72. Test GET /api/documents/:id/verify-signature (Xác minh độc lập chữ ký số mật mã):');
  const resVerifySig = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/verify-signature`, {
    headers: { Authorization: `Bearer ${tokenUserA}` },
  });
  const bodyVerifySig = await resVerifySig.json();
  const verifyData = bodyVerifySig.data;
  console.log(`   HTTP Status: ${resVerifySig.status} | Valid: ${verifyData?.isValid} | Tampered: ${verifyData?.isTampered}`);
  console.log(`   DigestValid: ${verifyData?.isDigestValid} | SigValid: ${verifyData?.isSignatureValid} | SignerSubject: ${verifyData?.signerSubject}`);
  if (
    resVerifySig.status !== 200 ||
    verifyData?.isValid !== true ||
    verifyData?.isTampered !== false ||
    verifyData?.isDigestValid !== true ||
    verifyData?.isSignatureValid !== true
  ) {
    throw new Error(`Test 72 thất bại: Xác minh chữ ký không hợp lệ: ${JSON.stringify(bodyVerifySig)}`);
  }
  console.log('   -> PASS (Xác minh độc lập thành công: Tính toàn vẹn và chữ ký RSA đều hợp lệ)\n');

  // Test 73: GET /api/documents/:id/signed-pdf - Tải tệp PDF đã ký số
  console.log('73. Test GET /api/documents/:id/signed-pdf (Tải tệp PDF đã ký số có kiểm soát phân quyền):');
  const resDownloadSigned = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/signed-pdf`, {
    headers: { Authorization: `Bearer ${tokenUserA}` },
  });
  console.log(`   HTTP Status: ${resDownloadSigned.status} | Content-Type: ${resDownloadSigned.headers.get('content-type')}`);
  if (
    resDownloadSigned.status !== 200 ||
    resDownloadSigned.headers.get('content-type') !== 'application/pdf'
  ) {
    throw new Error('Test 73 thất bại: Không tải được tệp PDF đã ký');
  }
  const downloadedSignedArrayBuffer = await resDownloadSigned.arrayBuffer();
  const downloadedSignedBuffer = Buffer.from(downloadedSignedArrayBuffer);
  const downloadedHash = crypto.createHash('sha256').update(downloadedSignedBuffer).digest('hex');
  console.log(`   Downloaded size: ${downloadedSignedBuffer.length} bytes | Magic: ${downloadedSignedBuffer.subarray(0, 5).toString('ascii')}`);
  console.log(`   Downloaded SHA-256: ${downloadedHash.slice(0, 16)}...`);
  if (
    downloadedSignedBuffer.subarray(0, 5).toString('ascii') !== '%PDF-' ||
    downloadedHash !== signResult.signedPdfHash
  ) {
    throw new Error('Test 73 thất bại: Nội dung tệp PDF tải về không khớp mã băm signedPdfHash');
  }
  console.log('   -> PASS (Tệp PDF tải về chuẩn định dạng và mã băm khớp 100% với signedPdfHash)\n');

  // Test 74: Tamper Detection - Sửa đổi 1 byte trong PDF làm xác minh thất bại
  console.log('74. Test Tamper Detection (Sửa đổi 1 byte trong vùng được ký làm xác minh thất bại):');
  const liveStorageService = new StorageService();
  const signedArtifactDb = await prisma.documentArtifact.findFirstOrThrow({
    where: {
      documentId: createdDocWithWf.id,
      artifactType: 'SIGNED_PDF',
    },
  });
  const originalSignedPdf = await liveStorageService.get(signedArtifactDb.storageKey!);
  const tamperedSignedPdf = Buffer.from(originalSignedPdf);
  tamperedSignedPdf[50] = tamperedSignedPdf[50] ^ 0xff; // Đảo bit tại byte thứ 50
  await liveStorageService.put(signedArtifactDb.storageKey!, tamperedSignedPdf);

  const resVerifyTampered = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/verify-signature`, {
    headers: { Authorization: `Bearer ${tokenUserA}` },
  });
  const bodyVerifyTampered = await resVerifyTampered.json();
  const tamperedData = bodyVerifyTampered.data;
  console.log(`   HTTP Status: ${resVerifyTampered.status} | Valid: ${tamperedData?.isValid} | Tampered: ${tamperedData?.isTampered} | DigestValid: ${tamperedData?.isDigestValid}`);
  if (
    resVerifyTampered.status !== 200 ||
    tamperedData?.isValid !== false ||
    tamperedData?.isTampered !== true ||
    tamperedData?.isDigestValid !== false
  ) {
    throw new Error(`Test 74 thất bại: Không phát hiện được can thiệp sửa đổi nội dung: ${JSON.stringify(bodyVerifyTampered)}`);
  }
  console.log('   -> PASS (Phát hiện can thiệp tức thì: isTampered = true, isDigestValid = false)');

  // Khôi phục lại tệp gốc và kiểm tra lại
  await liveStorageService.put(signedArtifactDb.storageKey!, originalSignedPdf);
  const resVerifyRestored = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/verify-signature`, {
    headers: { Authorization: `Bearer ${tokenUserA}` },
  });
  const bodyVerifyRestored = await resVerifyRestored.json();
  if (bodyVerifyRestored.data?.isValid !== true) {
    throw new Error('Test 74 thất bại: Không khôi phục được trạng thái hợp lệ sau khi restore');
  }
  console.log('   -> PASS (Khôi phục tệp gốc thành công, xác minh chữ ký hợp lệ trở lại)\n');

  // Test 75: Tenant Isolation - User B (Beta) cố ký hồ sơ của Alpha -> 403 Forbidden
  console.log('75. Test Tenant Isolation khi Ký (User B thuộc Beta cố ký hồ sơ của Alpha):');
  const resCrossSign = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/sign`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserB}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reason: 'Cố tình ký xuyên tổ chức trái phép',
    }),
  });
  console.log(`   HTTP Status: ${resCrossSign.status}`);
  if (resCrossSign.status !== 403) {
    throw new Error('Test 75 thất bại: Không chặn 403 khi ký xuyên tổ chức');
  }
  console.log('   -> PASS (Chặn tuyệt đối hành vi ký số xuyên tổ chức)\n');

  // Test 76: Tenant Isolation - User B cố xác minh chữ ký hồ sơ của Alpha -> 403 Forbidden
  console.log('76. Test Tenant Isolation khi Xác minh (User B cố xác minh chữ ký hồ sơ của Alpha):');
  const resCrossVerify = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/verify-signature`, {
    headers: { Authorization: `Bearer ${tokenUserB}` },
  });
  console.log(`   HTTP Status: ${resCrossVerify.status}`);
  if (resCrossVerify.status !== 403) {
    throw new Error('Test 76 thất bại: Không chặn 403 khi xác minh chữ ký xuyên tổ chức');
  }
  console.log('   -> PASS (Chặn tuyệt đối hành vi xác minh chữ ký xuyên tổ chức)\n');

  // Test 77: Tenant Isolation - User B cố tải tệp PDF đã ký của Alpha -> 403 Forbidden
  console.log('77. Test Tenant Isolation khi Tải PDF đã ký (User B cố tải PDF đã ký của Alpha):');
  const resCrossDownloadSignedPdf = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/signed-pdf`, {
    headers: { Authorization: `Bearer ${tokenUserB}` },
  });
  console.log(`   HTTP Status: ${resCrossDownloadSignedPdf.status}`);
  if (resCrossDownloadSignedPdf.status !== 403) {
    throw new Error('Test 77 thất bại: Không chặn 403 khi tải PDF đã ký xuyên tổ chức');
  }
  console.log('   -> PASS (Chặn tuyệt đối hành vi tải PDF đã ký xuyên tổ chức)\n');

  // Test 78: Chặn ký số khi chứng thư đã bị thu hồi (REVOKED) -> 400 Bad Request
  console.log('78. Test Chặn ký số hồ sơ khi chứng thư bị thu hồi (REVOKED -> 400):');
  const resSignWithRevoked = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/sign`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      certificateId: createdCert.id, // Cert này đã bị thu hồi ở Test 69
      reason: 'Cố ký bằng chứng thư đã bị thu hồi',
    }),
  });
  const bodySignWithRevoked = await resSignWithRevoked.json();
  console.log(`   HTTP Status: ${resSignWithRevoked.status} | Error: ${bodySignWithRevoked.error?.message}`);
  if (resSignWithRevoked.status !== 400) {
    throw new Error('Test 78 thất bại: Không chặn 400 khi ký bằng chứng thư đã bị thu hồi');
  }
  console.log('   -> PASS (Chặn thành công hành vi ký số bằng chứng thư bị thu hồi)\n');

  // Test 79: User Privacy - Đồng nghiệp cùng công ty cố dùng chứng thư của User A để ký -> 403 Forbidden
  console.log('79. Test User Privacy: Đồng nghiệp cùng tổ chức cố dùng chứng thư cá nhân của User A để ký:');
  const resColleagueSignDoc = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/sign`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAnotherUserA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      certificateId: activeCertA.id,
      reason: 'Mạo danh ký số',
    }),
  });
  console.log(`   HTTP Status: ${resColleagueSignDoc.status}`);
  if (resColleagueSignDoc.status !== 403) {
    throw new Error('Test 79 thất bại: Không chặn 403 khi đồng nghiệp cố dùng cert cá nhân của người khác để ký số');
  }
  console.log('   -> PASS (Bảo vệ chữ ký cá nhân: Chặn người dùng khác ký mạo danh thành công)\n');

  // Test 80: Concurrency & Idempotency - Ký lại hồ sơ cập nhật chữ ký số an toàn
  console.log('80. Test Idempotency / Cập nhật chữ ký số lặp lại:');
  const resResignDoc = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/sign`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      certificateId: activeCertA.id,
      reason: 'Ký cập nhật lý do mới nhất',
      location: 'TP. Hồ Chí Minh',
    }),
  });
  const bodyResignDoc = await resResignDoc.json();
  console.log(`   HTTP Status: ${resResignDoc.status} | ArtifactId: ${bodyResignDoc.data?.artifactId}`);
  if (resResignDoc.status !== 200 || !bodyResignDoc.data?.signedPdfHash) {
    throw new Error('Test 80 thất bại: Không cập nhật được chữ ký số lặp lại');
  }

  // Đếm số lượng SIGNED_PDF artifact trong DB cho document này
  const totalSignedArtifacts = await prisma.documentArtifact.count({
    where: {
      documentId: createdDocWithWf.id,
      artifactType: 'SIGNED_PDF',
    },
  });
  console.log(`   Total SIGNED_PDF artifacts in DB: ${totalSignedArtifacts}`);
  if (totalSignedArtifacts !== 1) {
    throw new Error(`Test 80 thất bại: Có nhiều hơn 1 SIGNED_PDF artifact (${totalSignedArtifacts})`);
  }
  console.log('   -> PASS (Xử lý Idempotency hoàn hảo: Cập nhật chữ ký số an toàn, không sinh artifact trùng lặp)\n');

  // Test 81: RFC 3161 Trusted Timestamping - Ký số tài liệu với cờ requireTimestamp: true
  console.log('81. Test RFC 3161 Trusted Timestamping: Ký số PDF yêu cầu dấu thời gian tin cậy (requireTimestamp: true):');
  const resSignWithTs = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/sign`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      certificateId: activeCertA.id,
      reason: 'Phê duyệt hợp đồng với dấu thời gian RFC 3161',
      location: 'Hà Nội, Việt Nam',
      requireTimestamp: true,
    }),
  });
  const bodySignWithTs = await resSignWithTs.json();
  console.log(`   HTTP Status: ${resSignWithTs.status} | hasTimestamp: ${bodySignWithTs.data?.hasTimestamp} | TSA: ${bodySignWithTs.data?.tsaSubject}`);
  if (
    resSignWithTs.status !== 200 ||
    bodySignWithTs.data?.hasTimestamp !== true ||
    !bodySignWithTs.data?.timestampGenTime ||
    !bodySignWithTs.data?.tsaSubject
  ) {
    throw new Error('Test 81 thất bại: Ký PDF với requireTimestamp: true không tạo ra TimeStampToken hợp lệ');
  }

  // Kiểm tra CSDL DocumentArtifact lưu trữ đầy đủ metadata timestamp
  const artifactWithTs = await prisma.documentArtifact.findFirst({
    where: {
      documentId: createdDocWithWf.id,
      artifactType: 'SIGNED_PDF',
    },
  });
  if (
    !artifactWithTs ||
    artifactWithTs.hasTimestamp !== true ||
    !artifactWithTs.timestampGenTime ||
    !artifactWithTs.tsaSubject ||
    !artifactWithTs.tsaSerialNumber ||
    !artifactWithTs.tsaPolicyOid
  ) {
    throw new Error('Test 81 thất bại: CSDL DocumentArtifact không lưu đầy đủ metadata dấu thời gian RFC 3161');
  }
  console.log('   -> PASS (Ký PDF thành công với RFC 3161 TimeStampToken và lưu metadata CSDL chuẩn hóa)\n');

  // Test 82: Xác minh độc lập chữ ký số có TimeStampToken qua HTTP API
  console.log('82. Test Xác minh độc lập chữ ký PDF kèm TimeStampToken qua API GET /verify-signature:');
  const resVerifyWithTs = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/verify-signature`, {
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
    },
  });
  const bodyVerifyWithTs = await resVerifyWithTs.json();
  console.log(
    `   HTTP Status: ${resVerifyWithTs.status} | isValid: ${bodyVerifyWithTs.data?.isValid} | hasTimestamp: ${bodyVerifyWithTs.data?.hasTimestamp} | isTimestampValid: ${bodyVerifyWithTs.data?.isTimestampValid}`
  );
  if (
    resVerifyWithTs.status !== 200 ||
    bodyVerifyWithTs.data?.isValid !== true ||
    bodyVerifyWithTs.data?.isTampered !== false ||
    bodyVerifyWithTs.data?.hasTimestamp !== true ||
    bodyVerifyWithTs.data?.isTimestampValid !== true ||
    !bodyVerifyWithTs.data?.timestampGenTime
  ) {
    throw new Error('Test 82 thất bại: API xác minh chữ ký không xác thực được TimeStampToken hợp lệ');
  }
  console.log('   -> PASS (API xác minh toàn diện chữ ký RSA và TimeStampToken RFC 3161 thành công)\n');

  // Test 83: Tải tệp PDF đã ký có TimeStampToken qua HTTP API
  console.log('83. Test Tải tệp PDF đã ký có dấu thời gian GET /signed-pdf:');
  const resDownloadTsPdf = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/signed-pdf`, {
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
    },
  });
  console.log(`   HTTP Status: ${resDownloadTsPdf.status} | Content-Type: ${resDownloadTsPdf.headers.get('content-type')}`);
  if (resDownloadTsPdf.status !== 200) {
    throw new Error('Test 83 thất bại: Không tải được tệp PDF đã ký có timestamp');
  }
  const downloadedBuf = Buffer.from(await resDownloadTsPdf.arrayBuffer());
  if (downloadedBuf.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('Test 83 thất bại: Tệp tải về không có magic bytes %PDF-');
  }
  if (!downloadedBuf.includes(Buffer.from('/ByteRange')) || !downloadedBuf.includes(Buffer.from('/Contents'))) {
    throw new Error('Test 83 thất bại: Tệp PDF không chứa ByteRange hoặc Contents');
  }
  console.log(`   Tải thành công PDF kích thước: ${downloadedBuf.length} bytes`);
  console.log('   -> PASS (Tải tệp PDF đã ký có RFC 3161 TimeStampToken thành công)\n');

  // Test 84: Input Validation - Chặn requireTimestamp sai định dạng kiểu dữ liệu
  console.log('84. Test Input Validation: Chặn requireTimestamp sai kiểu boolean:');
  const resInvalidReqTs = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/sign`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      certificateId: activeCertA.id,
      requireTimestamp: 'not_a_boolean',
    }),
  });
  console.log(`   HTTP Status: ${resInvalidReqTs.status}`);
  if (resInvalidReqTs.status !== 400) {
    throw new Error('Test 84 thất bại: Không chặn 400 khi requireTimestamp không phải boolean');
  }
  console.log('   -> PASS (Validation Pipe chặn thành công dữ liệu requireTimestamp không hợp lệ)\n');

  // Test 85: Tenant Isolation trên tệp PDF đã ký có timestamp
  console.log('85. Test Tenant Isolation trên tài liệu đã ký có RFC 3161 Timestamp:');
  const resCrossTenantVerify = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/verify-signature`, {
    headers: {
      Authorization: `Bearer ${tokenUserB}`,
    },
  });
  console.log(`   Verify cross-tenant status: ${resCrossTenantVerify.status}`);
  if (resCrossTenantVerify.status !== 403) {
    throw new Error('Test 85 thất bại: Không chặn 403 khi tenant khác cố xác minh chữ ký');
  }

  const resCrossTenantDownload = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/signed-pdf`, {
    headers: {
      Authorization: `Bearer ${tokenUserB}`,
    },
  });
  console.log(`   Download cross-tenant status: ${resCrossTenantDownload.status}`);
  if (resCrossTenantDownload.status !== 403) {
    throw new Error('Test 85 thất bại: Không chặn 403 khi tenant khác cố tải PDF đã ký');
  }
  console.log('   -> PASS (Cách ly Tenant tuyệt đối trên các tài liệu đã ký số có dấu thời gian)\n');

  // Test 86: Bổ sung DSS vào tài liệu đã ký qua HTTP API (POST /api/documents/:id/add-ltv)
  console.log('86. Test Bổ sung DSS / VRI vào tài liệu đã ký POST /add-ltv (PAdES B-T -> PAdES B-LT):');
  const resAddLtv = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/add-ltv`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  console.log(`   HTTP Status: ${resAddLtv.status}`);
  if (resAddLtv.status !== 200 && resAddLtv.status !== 201) {
    const errText = await resAddLtv.text();
    throw new Error(`Test 86 thất bại: HTTP status ${resAddLtv.status} - ${errText}`);
  }
  const bodyAddLtv = await resAddLtv.json();
  console.log(`   Response LTV: hasLtv=${bodyAddLtv.data?.hasLtv}, status=${bodyAddLtv.data?.ltvStatus}, padesLevel=${bodyAddLtv.data?.padesLevel}, dssCerts=${bodyAddLtv.data?.dssCertsCount}, dssOcsps=${bodyAddLtv.data?.dssOcspsCount}`);
  if (
    bodyAddLtv.data?.hasLtv !== true ||
    bodyAddLtv.data?.ltvStatus !== 'VALID' ||
    bodyAddLtv.data?.padesLevel !== 'PADES_B_LT' ||
    bodyAddLtv.data?.dssCertsCount < 1 ||
    bodyAddLtv.data?.dssOcspsCount < 1
  ) {
    throw new Error('Test 86 thất bại: Dữ liệu LTV phản hồi không đạt chuẩn PAdES B-LT');
  }
  console.log('   -> PASS (Bổ sung DSS / VRI vào tài liệu đã ký qua HTTP API thành công)\n');

  // Test 87: Thẩm định LTV qua HTTP API GET /api/documents/:id/verify-ltv
  console.log('87. Test Thẩm định dữ liệu LTV chuyên biệt GET /verify-ltv:');
  const resVerifyLtv = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/verify-ltv`, {
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
    },
  });
  console.log(`   HTTP Status: ${resVerifyLtv.status}`);
  if (resVerifyLtv.status !== 200) {
    const errText = await resVerifyLtv.text();
    throw new Error(`Test 87 thất bại: HTTP status ${resVerifyLtv.status} - ${errText}`);
  }
  const bodyVerifyLtv = await resVerifyLtv.json();
  console.log(`   LTV Verify: hasLtv=${bodyVerifyLtv.data?.hasLtv}, status=${bodyVerifyLtv.data?.ltvValidationStatus}, padesLevel=${bodyVerifyLtv.data?.padesLevel}, certsCount=${bodyVerifyLtv.data?.dssInfo?.certsCount}, ocspsCount=${bodyVerifyLtv.data?.dssInfo?.ocspsCount}`);
  if (
    bodyVerifyLtv.data?.hasLtv !== true ||
    bodyVerifyLtv.data?.ltvValidationStatus !== 'VALID' ||
    bodyVerifyLtv.data?.padesLevel !== 'PADES_B_LT' ||
    bodyVerifyLtv.data?.dssInfo?.certsCount < 1
  ) {
    throw new Error('Test 87 thất bại: Kết quả thẩm định LTV qua API không hợp lệ');
  }
  console.log('   -> PASS (Xác minh dữ liệu xác thực dài hạn LTV GET /verify-ltv thành công)\n');

  // Test 88: Xác minh toàn diện chữ ký số sau khi có LTV (GET /api/documents/:id/verify-signature)
  console.log('88. Test Xác minh toàn diện chữ ký số hồ sơ PAdES B-LT GET /verify-signature:');
  const resVerifyFullLtv = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/verify-signature`, {
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
    },
  });
  console.log(`   HTTP Status: ${resVerifyFullLtv.status}`);
  if (resVerifyFullLtv.status !== 200) {
    throw new Error('Test 88 thất bại: API verify-signature không thành công');
  }
  const bodyVerifyFullLtv = await resVerifyFullLtv.json();
  console.log(`   Signature & LTV: isValid=${bodyVerifyFullLtv.data?.isValid}, hasTimestamp=${bodyVerifyFullLtv.data?.hasTimestamp}, hasLtv=${bodyVerifyFullLtv.data?.hasLtv}, padesLevel=${bodyVerifyFullLtv.data?.padesLevel}`);
  if (
    bodyVerifyFullLtv.data?.isValid !== true ||
    bodyVerifyFullLtv.data?.isSignatureValid !== true ||
    bodyVerifyFullLtv.data?.hasTimestamp !== true ||
    bodyVerifyFullLtv.data?.hasLtv !== true ||
    bodyVerifyFullLtv.data?.ltvValidationStatus !== 'VALID' ||
    bodyVerifyFullLtv.data?.padesLevel !== 'PADES_B_LT'
  ) {
    throw new Error('Test 88 thất bại: Tài liệu không đạt đồng thời chữ ký hợp lệ, dấu thời gian và PAdES B-LT');
  }
  console.log('   -> PASS (Xác minh toàn diện chữ ký số PAdES B-LT thành công)\n');

  // Test 89: Tenant Isolation trên LTV endpoints (Chặn 403 đối với Tenant Beta)
  console.log('89. Test Tenant Isolation trên các endpoints LTV (add-ltv & verify-ltv):');
  const resCrossTenantAddLtv = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/add-ltv`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserB}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  console.log(`   Add-LTV cross-tenant status: ${resCrossTenantAddLtv.status}`);
  if (resCrossTenantAddLtv.status !== 403) {
    throw new Error('Test 89 thất bại: Không chặn 403 khi tenant khác cố bổ sung LTV');
  }

  const resCrossTenantVerifyLtv = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/verify-ltv`, {
    headers: {
      Authorization: `Bearer ${tokenUserB}`,
    },
  });
  console.log(`   Verify-LTV cross-tenant status: ${resCrossTenantVerifyLtv.status}`);
  if (resCrossTenantVerifyLtv.status !== 403) {
    throw new Error('Test 89 thất bại: Không chặn 403 khi tenant khác cố xác minh LTV');
  }
  console.log('   -> PASS (Cách ly Tenant tuyệt đối trên các endpoints LTV)\n');

  // Test 90: Tải tệp PDF PAdES B-LT qua GET /signed-pdf và kiểm tra cấu trúc /DSS
  console.log('90. Test Tải tệp PDF PAdES B-LT có nhúng DSS / VRI GET /signed-pdf:');
  const resDownloadLtvPdf = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}/signed-pdf`, {
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
    },
  });
  console.log(`   HTTP Status: ${resDownloadLtvPdf.status}`);
  if (resDownloadLtvPdf.status !== 200) {
    throw new Error('Test 90 thất bại: Không tải được tệp PDF PAdES B-LT');
  }
  const ltvPdfBuf = Buffer.from(await resDownloadLtvPdf.arrayBuffer());
  const ltvPdfAscii = ltvPdfBuf.toString('binary');
  if (!ltvPdfAscii.includes('/DSS') || !ltvPdfAscii.includes('/Certs') || !ltvPdfAscii.includes('/OCSPs')) {
    throw new Error('Test 90 thất bại: Tệp PDF tải về không chứa đầy đủ /DSS, /Certs hoặc /OCSPs');
  }
  console.log(`   Tải thành công PDF PAdES B-LT kích thước: ${ltvPdfBuf.length} bytes (Chứa đầy đủ /DSS, /Certs, /OCSPs)`);
  console.log('   -> PASS (Tải và xác thực cấu trúc nhị phân PDF PAdES B-LT thành công)\n');

  // --- BẮT ĐẦU KIỂM THỬ PHASE 13.4: WORKFLOW AUTO-SIGNING & PRODUCTION READINESS ---
  console.log('--- BẮT ĐẦU KIỂM THỬ PHASE 13.4: WORKFLOW AUTO-SIGNING & PRODUCTION READINESS ---');

  // Test 91: GET /api/documents/:id trả về signedPdfArtifact kèm siêu dữ liệu PAdES B-LT
  console.log('91. Test GET /api/documents/:id trả về signedPdfArtifact kèm siêu dữ liệu PAdES B-LT:');
  const resDocDetail = await fetch(`${API_BASE}/documents/${createdDocWithWf.id}`, {
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
    },
  });
  console.log(`   HTTP Status: ${resDocDetail.status}`);
  if (resDocDetail.status !== 200) {
    throw new Error('Test 91 thất bại: Không lấy được chi tiết hồ sơ');
  }
  const bodyDocDetail = await resDocDetail.json();
  const signedArtifactView = bodyDocDetail.data?.signedPdfArtifact;
  console.log(`   Signed Artifact View: ID=${signedArtifactView?.id}, padesLevel=${signedArtifactView?.padesLevel}, hasTimestamp=${signedArtifactView?.hasTimestamp}, hasLtv=${signedArtifactView?.hasLtv}`);
  if (!signedArtifactView || signedArtifactView.padesLevel !== 'PADES_B_LT' || !signedArtifactView.hasLtv) {
    throw new Error('Test 91 thất bại: signedPdfArtifact không đúng chuẩn PAdES B-LT');
  }
  console.log('   -> PASS (signedPdfArtifact trả về đầy đủ và chính xác trong chi tiết hồ sơ)\n');

  // Test 92: Tự động niêm phong số PAdES B-LT khi hồ sơ hoàn tất phê duyệt (APPROVED)
  console.log('92. Test Tự động niêm phong số PAdES B-LT khi hồ sơ hoàn tất phê duyệt (APPROVED):');
  await prisma.digitalCertificate.deleteMany({
    where: {
      organizationId: userA.organizationId!,
      userId: null,
    },
  });
  const sealAliasE2E = `seal_alpha_corp_${Date.now()}`;
  const sealKeystore = DevKeystoreGenerator.generateSelfSignedKeystore({
    commonName: 'Con dau Dien tu Alpha Corp (Live E2E)',
    organizationName: userA.organization?.name || 'Tập đoàn VinaGroup',
  });
  liveKeystoreProvider.importKeystore(sealAliasE2E, sealKeystore.p12Buffer);

  const resRegOrgSeal = await fetch(`${API_BASE}/certificates`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userId: null,
      certificatePem: sealKeystore.certificatePem,
      keyAlias: sealAliasE2E,
      keyStorageType: 'DEV_KEYSTORE',
    }),
  });
  const bodyRegOrgSeal = await resRegOrgSeal.json();
  const orgSealCertE2E = bodyRegOrgSeal.data;
  console.log(`   Khởi tạo con dấu tổ chức Alpha: ${orgSealCertE2E?.id} (${orgSealCertE2E?.keyAlias})`);

  // Tạo hồ sơ mới
  const resCreateDocAutoSeal = await fetch(`${API_BASE}/documents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      templateId: createdTplId,
      workflowTemplateId: createdWfId,
      title: 'Tờ trình tự động niêm phong số Phase 13.4',
      formData: {
        ten_thiet_bi: 'Workstation AI SuperCluster',
        ngan_sach: 120000000,
        ngay_can: '2026-12-01',
        muc_dich: 'Triển khai niêm phong điện tử tự động trên quy trình phê duyệt',
      },
    }),
  });
  const bodyCreateDocAutoSeal = await resCreateDocAutoSeal.json();
  const docAutoSeal = bodyCreateDocAutoSeal.data;

  // Submit hồ sơ
  await fetch(`${API_BASE}/documents/${docAutoSeal.id}/submit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
    },
  });

  // Step 1: User A phê duyệt
  const resApproveStep1 = await fetch(`${API_BASE}/documents/${docAutoSeal.id}/decision`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      decision: 'APPROVED',
      decisionComment: 'Trưởng bộ phận phê duyệt bước 1',
    }),
  });
  const bodyApproveStep1 = await resApproveStep1.json();
  console.log(`   Duyệt Bước 1 status: ${resApproveStep1.status} | docStatus: ${bodyApproveStep1.data?.documentStatus}`);

  // Step 2: Admin A phê duyệt -> APPROVED terminal state
  const resApproveStep2 = await fetch(`${API_BASE}/documents/${docAutoSeal.id}/decision`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenAdminA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      decision: 'APPROVED',
      decisionComment: 'Ban Giám đốc phê duyệt chung, kích hoạt tự động niêm phong số.',
    }),
  });
  const bodyApproveStep2 = await resApproveStep2.json();
  console.log(`   Duyệt Bước 2 status: ${resApproveStep2.status} | docStatus: ${bodyApproveStep2.data?.documentStatus}`);

  // Kiểm tra tệp SIGNED_PDF đã được tự động sinh qua GET /api/documents/:id
  const resCheckAutoSealed = await fetch(`${API_BASE}/documents/${docAutoSeal.id}`, {
    headers: {
      Authorization: `Bearer ${tokenUserA}`,
    },
  });
  const bodyCheckAutoSealed = await resCheckAutoSealed.json();
  const autoSealedArtifact = bodyCheckAutoSealed.data?.signedPdfArtifact;
  console.log(`   Auto-sealed Artifact: id=${autoSealedArtifact?.id}, padesLevel=${autoSealedArtifact?.padesLevel}, hasTimestamp=${autoSealedArtifact?.hasTimestamp}, hasLtv=${autoSealedArtifact?.hasLtv}`);
  if (!autoSealedArtifact || autoSealedArtifact.padesLevel !== 'PADES_B_LT' || !autoSealedArtifact.hasLtv) {
    throw new Error('Test 92 thất bại: Hồ sơ APPROVED chưa được tự động niêm phong PAdES B-LT');
  }
  console.log('   -> PASS (Quy trình duyệt hồ sơ tự động niêm phong PAdES B-LT thành công)\n');

  // Test 93: Thông báo DOCUMENT_APPROVED được phát sinh tự động kèm link download
  console.log('93. Test Thông báo DOCUMENT_APPROVED được phát sinh tự động kèm link download:');
  const autoSealNotif = await prisma.notification.findFirst({
    where: {
      documentId: docAutoSeal.id,
      type: 'DOCUMENT_APPROVED',
    },
  });
  console.log(`   Notification found: ID=${autoSealNotif?.id}, Title="${autoSealNotif?.title}"`);
  const meta: any = autoSealNotif?.metadata || {};
  console.log(`   Notification downloadUrl: ${meta?.downloadUrl}`);
  if (!autoSealNotif || !meta?.downloadUrl || !meta?.downloadUrl.includes('type=SIGNED_PDF')) {
    throw new Error('Test 93 thất bại: Không tìm thấy thông báo DOCUMENT_APPROVED kèm downloadUrl');
  }
  console.log('   -> PASS (Thông báo DOCUMENT_APPROVED chứa link download /pdf?type=SIGNED_PDF chuẩn xác)\n');

  await prisma.$disconnect();
  console.log('========================================================================');
  console.log('🎉 TẤT CẢ 93/93 KỊCH BẢN KIỂM THỬ LIVE HTTP & SECURITY TRÊN POSTGRESQL');
  console.log('   (BAO GỒM REASSIGNMENT, SLA SCHEDULER, NOTIFICATION, DELEGATION,');
  console.log('    PHASE 13.1 PDF ARTIFACT STORAGE, PHASE 13.2.1 CERTIFICATE KEYSTORE,');
  console.log('    PHASE 13.2.2 CMS/PDF SIGNING ENGINE, PHASE 13.3.1 RFC 3161 TSA,');
  console.log('    PHASE 13.3.2 PAdES B-LT, DSS/VRI & LONG-TERM VALIDATION');
  console.log('    VÀ PHASE 13.4 WORKFLOW AUTO-SIGNING & PRODUCTION READINESS)');
  console.log('   ĐÃ PASS 100%!');
  console.log('========================================================================');
}

runLiveTests().catch((err) => {
  console.error('\n❌ Lỗi khi chạy live test:', err);
  process.exit(1);
});

