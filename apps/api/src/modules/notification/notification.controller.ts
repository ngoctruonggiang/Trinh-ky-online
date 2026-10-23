import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { UserPrincipal } from '../../common/interfaces/user-principal.interface.js';
import { NotificationService } from './notification.service.js';

@Controller('api/notifications')
@UseGuards(AuthGuard)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  /**
   * Lấy danh sách thông báo của người dùng hiện tại
   * GET /api/notifications?isRead=false&page=1&limit=20
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async getNotifications(
    @CurrentUser() user: UserPrincipal,
    @Query('isRead') isRead?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const isReadBool =
      isRead === 'true' ? true : isRead === 'false' ? false : undefined;

    const data = await this.notificationService.getUserNotifications(user.id, {
      isRead: isReadBool,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });

    return {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Lấy số lượng thông báo chưa đọc
   * GET /api/notifications/unread-count
   */
  @Get('unread-count')
  @HttpCode(HttpStatus.OK)
  async getUnreadCount(@CurrentUser() user: UserPrincipal) {
    const count = await this.notificationService.getUnreadCount(user.id);
    return {
      success: true,
      data: { unreadCount: count },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Đánh dấu 1 thông báo là đã đọc
   * PATCH /api/notifications/:id/read
   */
  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  async markAsRead(
    @Param('id') id: string,
    @CurrentUser() user: UserPrincipal
  ) {
    const result = await this.notificationService.markAsRead(user.id, id);
    return {
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Đánh dấu tất cả thông báo là đã đọc
   * PATCH /api/notifications/read-all
   */
  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllAsRead(@CurrentUser() user: UserPrincipal) {
    const result = await this.notificationService.markAllAsRead(user.id);
    return {
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    };
  }
}
