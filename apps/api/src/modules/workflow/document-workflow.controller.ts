import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  UseFilters,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { UserRole } from '@trinh-ky/shared';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { UserPrincipal } from '../../common/interfaces/user-principal.interface.js';
import { WorkflowExceptionFilter } from '../../common/filters/workflow-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { WorkflowOrchestratorService } from './workflow-orchestrator.service.js';
import { ProcessDecisionDto } from './dto/process-decision.dto.js';
import { ResubmitDocumentDto } from './dto/resubmit-document.dto.js';

interface HttpRequest {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  user?: any;
}
import { CancelDocumentDto } from './dto/cancel-document.dto.js';

@Controller('api/documents')
@UseGuards(AuthGuard)
@UseFilters(WorkflowExceptionFilter)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class DocumentWorkflowController {
  constructor(
    private readonly orchestrator: WorkflowOrchestratorService,
    private readonly prisma: PrismaService
  ) {}

  /**
   * Helper: Kiểm tra quyền sở hữu hoặc quyền quản trị trên hồ sơ theo phân quyền tổ chức
   */
  private async verifyDocumentAccess(
    documentId: string,
    user: UserPrincipal,
    action: 'submit' | 'resubmit' | 'cancel' | 'decision' = 'submit'
  ) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        createdById: true,
        organizationId: true,
        status: true,
      },
    });

    if (!document) {
      throw new NotFoundException(`Không tìm thấy hồ sơ với id: ${documentId}`);
    }

    // 1. Phân quyền ranh giới tổ chức (Multi-Company Boundary):
    // SUPER_ADMIN có quyền toàn hệ thống (tất cả công ty con).
    // Nếu user hoặc ADMIN thuộc công ty A và tài liệu thuộc công ty B -> CHẶN
    if (
      user.role !== UserRole.SUPER_ADMIN &&
      user.organizationId &&
      document.organizationId &&
      user.organizationId !== document.organizationId
    ) {
      throw new ForbiddenException(
        'Bạn không có quyền thao tác trên hồ sơ thuộc công ty/tổ chức khác.'
      );
    }

    // 2. Quyền quản trị / tác giả cho các hành động submit, resubmit, cancel:
    if (action !== 'decision') {
      const isCreator = document.createdById === user.id;
      const isSuperAdmin = user.role === UserRole.SUPER_ADMIN;
      const isCompanyAdmin =
        user.role === UserRole.ADMIN &&
        (!document.organizationId || user.organizationId === document.organizationId);

      if (!isCreator && !isSuperAdmin && !isCompanyAdmin) {
        throw new ForbiddenException('Bạn không có quyền thực hiện thao tác trên hồ sơ này.');
      }
    }

    return document;
  }

  private getUserAgent(req: HttpRequest): string | undefined {
    const ua = req.headers['user-agent'];
    return Array.isArray(ua) ? ua[0] : ua;
  }

  /**
   * 1. Gửi duyệt hồ sơ (Submit)
   * POST /api/documents/:id/submit
   */
  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  async submitDocument(
    @Param('id') id: string,
    @CurrentUser() user: UserPrincipal,
    @Req() req: HttpRequest
  ) {
    // Xác minh quyền: Chỉ tác giả hoặc Admin công ty sở hữu mới được submit
    await this.verifyDocumentAccess(id, user, 'submit');

    const result = await this.orchestrator.submitDocument({
      documentId: id,
      userId: user.id,
      ipAddress: req.ip,
      userAgent: this.getUserAgent(req),
    });

    return {
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 2. Ra quyết định phê duyệt (Approve / Reject / Request Revision)
   * POST /api/documents/:id/decision
   */
  @Post(':id/decision')
  @HttpCode(HttpStatus.OK)
  async processDecision(
    @Param('id') id: string,
    @Body() dto: ProcessDecisionDto,
    @CurrentUser() user: UserPrincipal,
    @Req() req: HttpRequest
  ) {
    // 1. Xác minh tài liệu tồn tại và kiểm tra ranh giới tổ chức
    await this.verifyDocumentAccess(id, user, 'decision');

    // 2. Lưu ý bảo mật: Danh tính userId ĐƯỢC LẤY TRỰC TIẾP TỪ AUTHENTICATED PRINCIPAL
    // Client tuyệt đối không thể mạo danh hoặc truyền userId khác trong body payload.
    const result = await this.orchestrator.processAssigneeDecision({
      documentId: id,
      userId: user.id,
      decision: dto.decision,
      decisionComment: dto.decisionComment,
      signatureImageUrl: dto.signatureImageUrl,
      ipAddress: req.ip,
      userAgent: this.getUserAgent(req),
    });

    return {
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 3. Nộp lại hồ sơ sau chỉnh sửa (Resubmit)
   * POST /api/documents/:id/resubmit
   */
  @Post(':id/resubmit')
  @HttpCode(HttpStatus.OK)
  async resubmitDocument(
    @Param('id') id: string,
    @Body() dto: ResubmitDocumentDto,
    @CurrentUser() user: UserPrincipal,
    @Req() req: HttpRequest
  ) {
    // Xác minh quyền: Chỉ tác giả hoặc Admin công ty sở hữu mới được resubmit
    await this.verifyDocumentAccess(id, user, 'resubmit');

    const result = await this.orchestrator.resubmitDocument({
      documentId: id,
      userId: user.id,
      newFormData: dto.formData,
      changeSummary: dto.changeSummary,
      ipAddress: req.ip,
      userAgent: this.getUserAgent(req),
    });

    return {
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 4. Hủy hồ sơ trình ký (Cancel)
   * POST /api/documents/:id/cancel
   */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelDocument(
    @Param('id') id: string,
    @Body() dto: CancelDocumentDto,
    @CurrentUser() user: UserPrincipal,
    @Req() req: HttpRequest
  ) {
    // Xác minh quyền: Chỉ tác giả hoặc Super Admin / Admin công ty sở hữu mới được hủy
    await this.verifyDocumentAccess(id, user, 'cancel');

    const result = await this.orchestrator.cancelDocument({
      documentId: id,
      userId: user.id,
      cancelReason: dto.cancelReason,
      ipAddress: req.ip,
      userAgent: this.getUserAgent(req),
    });

    return {
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    };
  }
}
