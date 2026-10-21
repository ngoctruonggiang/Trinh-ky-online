import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { UserPrincipal } from '../../common/interfaces/user-principal.interface.js';
import { WorkflowExceptionFilter } from '../../common/filters/workflow-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';

@Controller('api/auth')
@UseGuards(AuthGuard)
@UseFilters(WorkflowExceptionFilter)
export class AuthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Endpoint 3: GET /api/auth/me
   * Trả về danh tính người dùng hiện tại, organization và department.
   * Tuyệt đối không trả về passwordHash, secrets hoặc tokens.
   */
  @Get('me')
  @HttpCode(HttpStatus.OK)
  async getMe(@CurrentUser() user: UserPrincipal) {
    let orgName = '';
    let deptName = '';

    if (user.id) {
      try {
        const dbUser = await this.prisma.user.findUnique({
          where: { id: user.id },
          select: {
            id: true,
            email: true,
            fullName: true,
            role: true,
            organizationId: true,
            departmentId: true,
            organization: { select: { id: true, name: true, code: true } },
            department: { select: { id: true, name: true, code: true } },
          },
        });

        if (dbUser) {
          orgName = dbUser.organization?.name ?? '';
          deptName = dbUser.department?.name ?? '';
        }
      } catch {
        // Fallback an toàn nếu database chưa kết nối hoặc chạy trong môi trường mock
      }
    }

    return {
      success: true,
      data: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        organizationId: user.organizationId ?? null,
        organizationName: orgName,
        departmentId: user.departmentId ?? null,
        departmentName: deptName,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
