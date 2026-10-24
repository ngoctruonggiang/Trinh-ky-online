import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseFilters,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { UserPrincipal } from '../../common/interfaces/user-principal.interface.js';
import { WorkflowExceptionFilter } from '../../common/filters/workflow-exception.filter.js';
import { ArtifactService } from './artifact.service.js';
import { RenderPdfDto } from './dto/render-pdf.dto.js';
import { GetArtifactQueryDto } from './dto/get-artifact-query.dto.js';

@Controller('api/documents')
@UseGuards(AuthGuard)
@UseFilters(WorkflowExceptionFilter)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class ArtifactController {
  constructor(private readonly artifactService: ArtifactService) {}

  /**
   * Khởi tạo hoặc lấy lại kết quả kết xuất PDF artifact từ snapshot hồ sơ
   * POST /api/documents/:id/render-pdf
   */
  @Post(':id/render-pdf')
  @HttpCode(HttpStatus.OK)
  async renderPdf(
    @Param('id') documentId: string,
    @Body() dto: RenderPdfDto,
    @CurrentUser() user: UserPrincipal
  ) {
    const artifact = await this.artifactService.renderArtifact(
      documentId,
      {
        versionNumber: dto.versionNumber,
        artifactType: dto.artifactType,
      },
      user
    );

    return {
      success: true,
      data: artifact,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Tra cứu trạng thái tệp PDF artifact
   * GET /api/documents/:id/render-status
   */
  @Get(':id/render-status')
  async getRenderStatus(
    @Param('id') documentId: string,
    @Query() query: GetArtifactQueryDto,
    @CurrentUser() user: UserPrincipal
  ) {
    const artifact = await this.artifactService.getArtifactStatus(
      documentId,
      query.version,
      query.type,
      user
    );

    return {
      success: true,
      data: artifact,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Tải tệp PDF artifact đã hoàn thành có kiểm soát phân quyền Tenant
   * GET /api/documents/:id/pdf
   */
  @Get(':id/pdf')
  async downloadPdf(
    @Param('id') documentId: string,
    @Query() query: GetArtifactQueryDto,
    @CurrentUser() user: UserPrincipal,
    @Res() res: Response
  ) {
    const { buffer, artifact, fileName } = await this.artifactService.getArtifactStream(
      documentId,
      query.version,
      query.type,
      user
    );

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Content-Length': buffer.length.toString(),
      'X-Raw-Pdf-Hash': artifact.rawPdfHash || '',
      'X-Artifact-Id': artifact.id,
      'Cache-Control': 'private, no-transform, max-age=3600',
    });

    res.end(buffer);
  }

  /**
   * Lấy danh sách toàn bộ artifact của hồ sơ
   * GET /api/documents/:id/artifacts
   */
  @Get(':id/artifacts')
  async listArtifacts(@Param('id') documentId: string, @CurrentUser() user: UserPrincipal) {
    const artifacts = await this.artifactService.getArtifactsForDocument(documentId, user);

    return {
      success: true,
      data: artifacts,
      timestamp: new Date().toISOString(),
    };
  }
}
