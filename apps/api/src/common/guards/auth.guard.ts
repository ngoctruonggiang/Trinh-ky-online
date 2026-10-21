import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '@trinh-ky/shared';
import { UserPrincipal } from '../interfaces/user-principal.interface.js';
import { JwtUtil } from '../utils/jwt.util.js';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    // 1. Nếu principal đã được kiểm tra và gắn sẵn (Ví dụ: internal unit tests)
    if (request.user && request.user.id) {
      return true;
    }

    const authHeader = request.headers['authorization'];
    const gatewaySecretHeader = request.headers['x-gateway-secret'];
    const userIdHeader = request.headers['x-user-id'];

    const jwtSecret = process.env.JWT_SECRET || 'trinh-ky-secret-key-for-dev-change-in-prod';
    const gatewaySecret = process.env.GATEWAY_SHARED_SECRET;
    const isDevMockAllowed =
      process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_MOCK_AUTH === 'true';

    // 2. Chế độ 1: Xác thực JWT Bearer Token (Chuẩn Production)
    if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      const verification = JwtUtil.verify(token, jwtSecret);

      if (!verification.valid || !verification.payload) {
        throw new UnauthorizedException({
          code: 'UNAUTHORIZED',
          message: verification.error || 'Token xác thực không hợp lệ hoặc đã hết hạn.',
        });
      }

      const p = verification.payload;
      request.user = {
        id: p.sub,
        email: p.email,
        fullName: p.fullName,
        role: (p.role as UserRole) || UserRole.USER,
        organizationId: p.organizationId || null,
        departmentId: p.departmentId || null,
      } as UserPrincipal;

      return true;
    }

    // 3. Chế độ 2: Xác thực qua API Gateway Đáng Tin Cậy (Trusted Reverse Proxy / Gateway Mode)
    // Yêu cầu bắt buộc Gateway phải gửi kèm shared secret đã thỏa thuận
    if (gatewaySecret && gatewaySecretHeader === gatewaySecret && userIdHeader) {
      request.user = {
        id: userIdHeader as string,
        email: (request.headers['x-user-email'] as string) || 'gateway-user@company.com',
        fullName: (request.headers['x-user-name'] as string) || 'Gateway User',
        role: (request.headers['x-user-role'] as UserRole) || UserRole.USER,
        organizationId: (request.headers['x-org-id'] as string) || null,
        departmentId: (request.headers['x-dept-id'] as string) || null,
      } as UserPrincipal;

      return true;
    }

    // 4. Chế độ 3: Dev Mock Header (Chỉ bật khi dev rõ ràng bằng biến ALLOW_DEV_MOCK_AUTH=true)
    if (isDevMockAllowed && userIdHeader) {
      request.user = {
        id: userIdHeader as string,
        email: (request.headers['x-user-email'] as string) || 'dev-user@company.com',
        fullName: (request.headers['x-user-name'] as string) || 'Dev Mock User',
        role: (request.headers['x-user-role'] as UserRole) || UserRole.USER,
        organizationId: (request.headers['x-org-id'] as string) || null,
        departmentId: (request.headers['x-dept-id'] as string) || null,
      } as UserPrincipal;

      return true;
    }

    // 5. Nếu không thỏa mãn bất kỳ cơ chế tin cậy nào -> TỪ CHỐI
    throw new UnauthorizedException({
      code: 'UNAUTHORIZED',
      message:
        'Yêu cầu Bearer JWT Token hợp lệ hoặc xác thực Gateway đáng tin cậy. Các header định danh trực tiếp bị từ chối.',
    });
  }
}
