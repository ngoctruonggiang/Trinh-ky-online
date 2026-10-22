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

  await prisma.$disconnect();
  console.log('========================================================================');
  console.log('🎉 TẤT CẢ 8/8 KỊCH BẢN KIỂM THỬ LIVE HTTP & SECURITY TRÊN POSTGRESQL');
  console.log('   ĐÃ CHẠY THÀNH CÔNG 100%!');
  console.log('========================================================================');
}

runLiveTests().catch((err) => {
  console.error('\n❌ Lỗi khi chạy live test:', err);
  process.exit(1);
});
