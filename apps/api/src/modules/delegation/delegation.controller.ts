import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { UserPrincipal } from '../../common/interfaces/user-principal.interface.js';
import { DelegationService } from './delegation.service.js';
import {
  CreateDelegationPolicyDto,
  UpdateDelegationPolicyDto,
} from '@trinh-ky/shared';

@Controller('api/delegations')
@UseGuards(AuthGuard)
export class DelegationController {
  constructor(private readonly delegationService: DelegationService) {}

  /**
   * Tạo chính sách ủy quyền mới
   * POST /api/delegations
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createPolicy(
    @CurrentUser() user: UserPrincipal,
    @Body() dto: CreateDelegationPolicyDto
  ) {
    const policy = await this.delegationService.createPolicy(
      user.id,
      user.role,
      user.organizationId ?? null,
      dto
    );
    return {
      success: true,
      data: policy,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Lấy danh sách chính sách ủy quyền (phân quyền theo vai trò)
   * GET /api/delegations
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async getPolicies(
    @CurrentUser() user: UserPrincipal,
    @Query('isActive') isActiveQuery?: string,
    @Query('role') roleQuery?: 'delegator' | 'delegatee' | 'all',
    @Query('organizationId') organizationIdQuery?: string,
    @Query('page') pageQuery?: string,
    @Query('limit') limitQuery?: string
  ) {
    let isActive: boolean | undefined = undefined;
    if (isActiveQuery === 'true') isActive = true;
    if (isActiveQuery === 'false') isActive = false;

    const page = pageQuery ? parseInt(pageQuery, 10) : undefined;
    const limit = limitQuery ? parseInt(limitQuery, 10) : undefined;

    const result = await this.delegationService.getPolicies(
      user.id,
      user.role,
      user.organizationId ?? null,
      {
        isActive,
        role: roleQuery,
        organizationId: organizationIdQuery,
        page,
        limit,
      }
    );

    return {
      success: true,
      data: result.items,
      pagination: result.pagination,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Lấy thông tin chi tiết một chính sách ủy quyền
   * GET /api/delegations/:id
   */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getPolicyById(
    @CurrentUser() user: UserPrincipal,
    @Param('id') id: string
  ) {
    const policy = await this.delegationService.getPolicyById(
      id,
      user.id,
      user.role,
      user.organizationId ?? null
    );
    return {
      success: true,
      data: policy,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Cập nhật chính sách ủy quyền
   * PATCH /api/delegations/:id
   */
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async updatePolicy(
    @CurrentUser() user: UserPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdateDelegationPolicyDto
  ) {
    const policy = await this.delegationService.updatePolicy(
      id,
      user.id,
      user.role,
      user.organizationId ?? null,
      dto
    );
    return {
      success: true,
      data: policy,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Thu hồi chính sách ủy quyền (Soft Revoke)
   * POST /api/delegations/:id/revoke
   */
  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  async revokePolicy(
    @CurrentUser() user: UserPrincipal,
    @Param('id') id: string,
    @Body() body: { reason?: string }
  ) {
    const policy = await this.delegationService.revokePolicy(
      id,
      user.id,
      user.role,
      user.organizationId ?? null,
      body?.reason
    );
    return {
      success: true,
      data: policy,
      timestamp: new Date().toISOString(),
    };
  }
}
