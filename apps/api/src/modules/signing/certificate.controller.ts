import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseFilters,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { UserPrincipal } from '../../common/interfaces/user-principal.interface.js';
import { WorkflowExceptionFilter } from '../../common/filters/workflow-exception.filter.js';
import { CertificateRegistryService } from './certificate-registry.service.js';
import { RegisterCertificateDto } from './dto/register-certificate.dto.js';
import { UpdateCertificateStatusDto } from './dto/update-certificate-status.dto.js';
import { CertificateStatus } from '@trinh-ky/shared';

@Controller('api/certificates')
@UseGuards(AuthGuard)
@UseFilters(WorkflowExceptionFilter)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class CertificateController {
  constructor(private readonly certificateService: CertificateRegistryService) {}

  /**
   * Đăng ký chứng thư số công khai X.509
   * POST /api/certificates
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() dto: RegisterCertificateDto,
    @CurrentUser() user: UserPrincipal
  ) {
    const cert = await this.certificateService.registerCertificate(user, dto);
    return {
      success: true,
      data: cert,
    };
  }

  /**
   * Liệt kê danh mục chứng thư số theo quyền hạn và bộ lọc
   * GET /api/certificates
   */
  @Get()
  async list(
    @CurrentUser() user: UserPrincipal,
    @Query('status') status?: CertificateStatus,
    @Query('type') type?: 'PERSONAL' | 'ORGANIZATION',
    @Query('userId') userId?: string
  ) {
    const items = await this.certificateService.listCertificates(user, {
      status,
      type,
      userId,
    });
    return {
      success: true,
      data: items,
    };
  }

  /**
   * Xem chi tiết chứng thư số theo ID
   * GET /api/certificates/:id
   */
  @Get(':id')
  async getById(
    @Param('id') id: string,
    @CurrentUser() user: UserPrincipal
  ) {
    const cert = await this.certificateService.getCertificateById(user, id);
    return {
      success: true,
      data: cert,
    };
  }

  /**
   * Cập nhật trạng thái chứng thư số (Thu hồi / Kích hoạt lại)
   * PATCH /api/certificates/:id/status
   */
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateCertificateStatusDto,
    @CurrentUser() user: UserPrincipal
  ) {
    const updated = await this.certificateService.updateCertificateStatus(user, id, dto);
    return {
      success: true,
      data: updated,
    };
  }

  /**
   * Thử nghiệm ký số và xác minh với khóa công khai (Test Sign)
   * POST /api/certificates/:id/test-sign
   */
  @Post(':id/test-sign')
  @HttpCode(HttpStatus.OK)
  async testSign(
    @Param('id') id: string,
    @CurrentUser() user: UserPrincipal
  ) {
    const result = await this.certificateService.testSignCertificate(user, id);
    return {
      success: true,
      data: result,
    };
  }
}
