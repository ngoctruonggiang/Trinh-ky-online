import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UserRole } from '@trinh-ky/shared';
import { AuthController } from './auth.controller.js';
import { UserPrincipal } from '../../common/interfaces/user-principal.interface.js';

describe('AuthController (GET /api/auth/me)', () => {
  let controller: AuthController;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: vi.fn(),
      },
    };

    controller = new AuthController(mockPrisma);
  });

  it('1. Trả về thông tin profile người dùng, organization và department', async () => {
    const user: UserPrincipal = {
      id: 'user-tp-id',
      email: 'tp@vinagroup.vn',
      fullName: 'Trưởng Phòng IT',
      role: UserRole.USER,
      organizationId: 'org-hq',
      departmentId: 'dept-it',
    };

    mockPrisma.user.findUnique.mockResolvedValue({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      organizationId: user.organizationId,
      departmentId: user.departmentId,
      organization: { id: 'org-hq', name: 'Tập đoàn VinaGroup (HQ)', code: 'VGR-HQ' },
      department: { id: 'dept-it', name: 'Phòng Công nghệ Thông tin', code: 'IT' },
    });

    const response = await controller.getMe(user);

    expect(response.success).toBe(true);
    expect(response.data.id).toBe('user-tp-id');
    expect(response.data.email).toBe('tp@vinagroup.vn');
    expect(response.data.fullName).toBe('Trưởng Phòng IT');
    expect(response.data.organizationName).toBe('Tập đoàn VinaGroup (HQ)');
    expect(response.data.departmentName).toBe('Phòng Công nghệ Thông tin');
    // Tuyệt đối không trả về passwordHash, secrets hay tokens
    expect((response.data as any).passwordHash).toBeUndefined();
    expect((response.data as any).token).toBeUndefined();
  });

  it('2. Fallback an toàn khi database chưa có bản ghi hoặc user được gửi từ gateway/test mock', async () => {
    const user: UserPrincipal = {
      id: 'gateway-user-id',
      email: 'gateway@vinagroup.vn',
      fullName: 'Gateway User',
      role: UserRole.ADMIN,
      organizationId: 'org-hq',
    };

    mockPrisma.user.findUnique.mockResolvedValue(null);

    const response = await controller.getMe(user);

    expect(response.success).toBe(true);
    expect(response.data.id).toBe('gateway-user-id');
    expect(response.data.email).toBe('gateway@vinagroup.vn');
    expect(response.data.organizationName).toBe('');
  });
});
