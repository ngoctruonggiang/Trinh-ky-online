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
import { ArtifactType } from '@trinh-ky/shared';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { UserPrincipal } from '../../common/interfaces/user-principal.interface.js';
import { WorkflowExceptionFilter } from '../../common/filters/workflow-exception.filter.js';
import { ArtifactService } from '../artifact/artifact.service.js';
import { PdfSigningService } from './engine/pdf-signing.service.js';
import { SignDocumentRequestDto } from './dto/sign-document.dto.js';

@Controller('api/documents')
@UseGuards(AuthGuard)
@UseFilters(WorkflowExceptionFilter)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class DocumentSigningController {
  constructor(
    private readonly pdfSigningService: PdfSigningService,
    private readonly artifactService: ArtifactService
  ) {}

  /**
   * Ký số mật mã tệp PDF của hồ sơ bằng chứng thư số X.509
   * POST /api/documents/:id/sign
   */
  @Post(':id/sign')
  @HttpCode(HttpStatus.OK)
  async signDocument(
    @Param('id') documentId: string,
    @Body() dto: SignDocumentRequestDto,
    @CurrentUser() user: UserPrincipal
  ) {
    const result = await this.pdfSigningService.signDocument(documentId, dto, user);

    return {
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Xác minh độc lập chữ ký số mật mã trên tệp PDF đã ký
   * GET /api/documents/:id/verify-signature
   */
  @Get(':id/verify-signature')
  async verifySignature(
    @Param('id') documentId: string,
    @Query('version') version: string,
    @CurrentUser() user: UserPrincipal
  ) {
    const versionNumber = version ? parseInt(version, 10) : undefined;
    const verifyResult = await this.pdfSigningService.verifyDocumentSignature(
      documentId,
      { versionNumber },
      user
    );

    return {
      success: true,
      data: verifyResult,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Tải tệp PDF đã ký số mật mã với kiểm soát phân quyền Tenant
   * GET /api/documents/:id/signed-pdf
   */
  @Get(':id/signed-pdf')
  async downloadSignedPdf(
    @Param('id') documentId: string,
    @Query('version') version: string,
    @CurrentUser() user: UserPrincipal,
    @Res() res: Response
  ) {
    const versionNumber = version ? parseInt(version, 10) : undefined;
    const { buffer, artifact, fileName } = await this.artifactService.getArtifactStream(
      documentId,
      versionNumber,
      ArtifactType.SIGNED_PDF,
      user
    );

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Content-Length': buffer.length.toString(),
      'X-Raw-Pdf-Hash': artifact.rawPdfHash || '',
      'X-Signed-Pdf-Hash': artifact.signedPdfHash || '',
      'X-Artifact-Id': artifact.id,
      'Cache-Control': 'private, no-transform, max-age=3600',
    });

    res.end(buffer);
  }
}
