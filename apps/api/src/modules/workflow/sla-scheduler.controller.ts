import {
  Controller,
  Post,
  Get,
  HttpCode,
  HttpStatus,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { UserPrincipal } from '../../common/interfaces/user-principal.interface.js';
import { SlaSchedulerService } from './sla-scheduler.service.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { DocumentStatus, StepStatus, WorkflowStatus } from '@trinh-ky/shared';

@Controller('api/workflows/sla')
@UseGuards(AuthGuard)
export class SlaSchedulerController {
  constructor(
    private readonly slaSchedulerService: SlaSchedulerService,
    private readonly prisma: PrismaService
  ) {}

  /**
   * Kích hoạt quét SLA thủ công hoặc bởi cron job worker
   * POST /api/workflows/sla/trigger-check
   */
  @Post('trigger-check')
  @HttpCode(HttpStatus.OK)
  async triggerSlaCheck(@CurrentUser() user: UserPrincipal) {
    // Chỉ SUPER_ADMIN hoặc ADMIN mới có quyền trigger quét SLA
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN') {
      throw new ForbiddenException('Chỉ quản trị viên mới có quyền kích hoạt kiểm tra SLA.');
    }

    const summary = await this.slaSchedulerService.processSlaChecks();
    return {
      success: true,
      data: summary,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Lấy số liệu giám sát SLA hiện tại
   * GET /api/workflows/sla/status
   */
  @Get('status')
  @HttpCode(HttpStatus.OK)
  async getSlaStatus(@CurrentUser() user: UserPrincipal) {
    const now = new Date();
    const nearDueThreshold = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const whereBase: any = {
      status: DocumentStatus.IN_REVIEW,
    };
    if (user.role !== 'SUPER_ADMIN') {
      whereBase.organizationId = user.organizationId;
    }

    const [totalInReview, overdueCount, nearDueCount] = await Promise.all([
      this.prisma.document.count({ where: whereBase }),
      this.prisma.document.count({
        where: {
          ...whereBase,
          dueDate: { lt: now },
        },
      }),
      this.prisma.document.count({
        where: {
          ...whereBase,
          dueDate: { gte: now, lte: nearDueThreshold },
        },
      }),
    ]);

    const onTrackCount = Math.max(0, totalInReview - overdueCount - nearDueCount);

    return {
      success: true,
      data: {
        totalInReview,
        onTrackCount,
        nearDueCount,
        overdueCount,
        checkedAt: now.toISOString(),
      },
      timestamp: now.toISOString(),
    };
  }
}
