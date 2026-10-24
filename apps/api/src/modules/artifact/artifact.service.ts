import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { ArtifactStatus, ArtifactType, AuditAction, DocumentArtifactView } from '@trinh-ky/shared';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { UserPrincipal } from '../../common/interfaces/user-principal.interface.js';
import { StorageService } from './storage/storage.service.js';
import { PdfGeneratorService } from './pdf-generator.service.js';

@Injectable()
export class ArtifactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly pdfGenerator: PdfGeneratorService
  ) {}

  /**
   * Khởi tạo hoặc nhận lại (idempotent) tệp PDF artifact từ DocumentVersion snapshot
   */
  async renderArtifact(
    documentId: string,
    options: { versionNumber?: number; artifactType?: ArtifactType } = {},
    user: UserPrincipal
  ): Promise<DocumentArtifactView> {
    const artifactType = options.artifactType || ArtifactType.OFFICIAL_UNSIGNED;

    // 1. Kiểm tra tài liệu và phân quyền Tenant
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        organization: true,
        createdBy: true,
        template: {
          include: {
            versions: true,
          },
        },
        templateVersion: true,
        workflow: {
          include: {
            steps: {
              include: {
                assignees: {
                  include: {
                    user: true,
                  },
                },
              },
              orderBy: { stepOrder: 'asc' },
            },
          },
        },
      },
    });

    if (!document) {
      throw new NotFoundException(`Không tìm thấy hồ sơ với ID: ${documentId}`);
    }

    // Bảo mật cách ly đa doanh nghiệp (Tenant Isolation)
    if (user.role !== 'SUPER_ADMIN' && document.organizationId !== user.organizationId) {
      throw new ForbiddenException('Bạn không có quyền truy cập hồ sơ của tổ chức khác.');
    }

    const versionNumber = options.versionNumber || document.currentVersion;

    // 2. Tìm đúng snapshot DocumentVersion (dữ liệu bất biến)
    const docVersion = await this.prisma.documentVersion.findUnique({
      where: {
        documentId_versionNumber: {
          documentId,
          versionNumber,
        },
      },
    });

    if (!docVersion) {
      throw new NotFoundException(
        `Không tìm thấy phiên bản v${versionNumber} cho hồ sơ số ${document.documentNumber}.`
      );
    }

    // 3. Tìm đúng template version snapshot gắn với tài liệu (KHÔNG lấy template mới nhất nếu tài liệu gắn bản cũ)
    let selectedTemplateVersion = document.templateVersion;
    if (!selectedTemplateVersion && document.template?.versions) {
      selectedTemplateVersion =
        document.template.versions.find((v) => v.id === document.templateVersionId) ||
        document.template.versions[0];
    }

    if (!selectedTemplateVersion) {
      throw new BadRequestException('Không tìm thấy bản chụp mẫu biểu (Template Version Snapshot) tương ứng.');
    }

    // 4. Tuần tự hóa tiến trình render bằng PostgreSQL Advisory Lock để chống race condition
    return await this.prisma.$transaction(
      async (tx) => {
        // Khóa advisory cấp transaction theo documentId
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext('doc_artifact_' || $1)::bigint);`,
          documentId
        );

        // 5. Kiểm tra tính Idempotency: Nếu artifact COMPLETED đã tồn tại và file còn nguyên vẹn trên Storage
        const existingArtifact = await tx.documentArtifact.findUnique({
          where: {
            documentVersionId_artifactType: {
              documentVersionId: docVersion.id,
              artifactType,
            },
          },
        });

        if (
          existingArtifact &&
          existingArtifact.status === ArtifactStatus.COMPLETED &&
          existingArtifact.storageKey
        ) {
          const fileExists = await this.storageService.exists(existingArtifact.storageKey);
          if (fileExists) {
            // Trả về ngay artifact đã hoàn thành từ trước
            return this.mapToView(existingArtifact, document.documentNumber);
          }
        }

        // 6. Ghi nhận hoặc chuyển trạng thái sang PROCESSING
        const now = new Date();
        const artifactRecord = await tx.documentArtifact.upsert({
          where: {
            documentVersionId_artifactType: {
              documentVersionId: docVersion.id,
              artifactType,
            },
          },
          create: {
            documentId: document.id,
            documentVersionId: docVersion.id,
            organizationId: document.organizationId || user.organizationId || 'default-org',
            artifactType,
            status: ArtifactStatus.PROCESSING,
            formDataHash: docVersion.sha256Hash,
            requestedById: user.id,
            startedAt: now,
          },
          update: {
            status: ArtifactStatus.PROCESSING,
            startedAt: now,
            errorMessage: null,
          },
        });

        // 7. Thực hiện kết xuất PDF trong bộ nhớ
        let generatedResult;
        try {
          generatedResult = await this.pdfGenerator.generatePdf({
            document: {
              id: document.id,
              documentNumber: document.documentNumber,
              title: document.title,
              status: document.status,
              urgency: document.urgency,
              createdAt: document.createdAt,
              createdByName: document.createdBy?.fullName,
              organizationName: document.organization?.name,
              departmentName: document.departmentId || undefined,
            },
            templateVersion: {
              title: selectedTemplateVersion.title,
              versionNumber: selectedTemplateVersion.versionNumber,
              description: selectedTemplateVersion.description,
              fields: (selectedTemplateVersion.fields as any[]) || [],
            },
            documentVersion: {
              versionNumber: docVersion.versionNumber,
              formData: (docVersion.formData as Record<string, any>) || {},
              sha256Hash: docVersion.sha256Hash,
              changeSummary: docVersion.changeSummary,
            },
            workflow: document.workflow
              ? {
                  steps: document.workflow.steps.map((s) => ({
                    stepOrder: s.stepOrder,
                    stepName: s.stepName,
                    status: s.status,
                    assignees: s.assignees.map((a) => ({
                      userFullName: a.user?.fullName || 'Người duyệt',
                      decision: a.decision,
                      decisionComment: a.decisionComment,
                      decidedAt: a.decidedAt ? a.decidedAt.toISOString() : null,
                    })),
                  })),
                }
              : null,
            artifactType,
          });
        } catch (renderError: any) {
          // Ghi nhận trạng thái FAILED nếu render lỗi
          await tx.documentArtifact.update({
            where: { id: artifactRecord.id },
            data: {
              status: ArtifactStatus.FAILED,
              errorMessage: `Lỗi kết xuất PDF: ${renderError.message}`,
            },
          });
          throw renderError;
        }

        // 8. Lưu tệp nhị phân vào Storage an toàn theo Tenant
        const storageKey = this.storageService.generateArtifactKey(
          document.organizationId || user.organizationId || 'org',
          document.id,
          docVersion.versionNumber,
          artifactType,
          generatedResult.rawPdfHash
        );

        try {
          await this.storageService.put(storageKey, generatedResult.pdfBuffer, 'application/pdf');
        } catch (storageError: any) {
          await tx.documentArtifact.update({
            where: { id: artifactRecord.id },
            data: {
              status: ArtifactStatus.FAILED,
              errorMessage: `Lỗi lưu trữ tệp: ${storageError.message}`,
            },
          });
          throw storageError;
        }

        // 9. Cập nhật trạng thái COMPLETED trong cơ sở dữ liệu
        const completedArtifact = await tx.documentArtifact.update({
          where: { id: artifactRecord.id },
          data: {
            status: ArtifactStatus.COMPLETED,
            storageKey,
            sizeBytes: generatedResult.sizeBytes,
            rawPdfHash: generatedResult.rawPdfHash,
            completedAt: new Date(),
            errorMessage: null,
          },
        });

        // 10. Nếu là bản OFFICIAL_UNSIGNED, cập nhật pdfUrl trong DocumentVersion
        if (artifactType === ArtifactType.OFFICIAL_UNSIGNED) {
          await tx.documentVersion.update({
            where: { id: docVersion.id },
            data: {
              pdfUrl: `/api/documents/${document.id}/pdf?type=OFFICIAL_UNSIGNED&version=${docVersion.versionNumber}`,
            },
          });
        }

        // 11. Ghi nhật ký kiểm toán (AuditLog)
        await tx.auditLog.create({
          data: {
            documentId: document.id,
            userId: user.id,
            action: AuditAction.RENDER_PDF,
            details: {
              artifactId: completedArtifact.id,
              artifactType,
              versionNumber: docVersion.versionNumber,
              rawPdfHash: generatedResult.rawPdfHash,
              sizeBytes: generatedResult.sizeBytes,
              pageCount: generatedResult.pageCount,
            },
          },
        });

        return this.mapToView(completedArtifact, document.documentNumber);
      },
      { timeout: 15000 }
    );
  }

  /**
   * Tra cứu trạng thái của tệp artifact
   */
  async getArtifactStatus(
    documentId: string,
    versionNumber?: number,
    artifactType = ArtifactType.OFFICIAL_UNSIGNED,
    user?: UserPrincipal
  ): Promise<DocumentArtifactView> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      throw new NotFoundException(`Không tìm thấy hồ sơ với ID: ${documentId}`);
    }

    if (user && user.role !== 'SUPER_ADMIN' && document.organizationId !== user.organizationId) {
      throw new ForbiddenException('Bạn không có quyền truy cập hồ sơ của tổ chức khác.');
    }

    const verNum = versionNumber || document.currentVersion;
    const docVersion = await this.prisma.documentVersion.findUnique({
      where: {
        documentId_versionNumber: {
          documentId,
          versionNumber: verNum,
        },
      },
    });

    if (!docVersion) {
      throw new NotFoundException(`Không tìm thấy phiên bản v${verNum} của hồ sơ.`);
    }

    const artifact = await this.prisma.documentArtifact.findUnique({
      where: {
        documentVersionId_artifactType: {
          documentVersionId: docVersion.id,
          artifactType,
        },
      },
    });

    if (!artifact) {
      throw new NotFoundException(
        `Chưa có tệp PDF artifact (${artifactType}) nào được tạo cho phiên bản v${verNum}.`
      );
    }

    return this.mapToView(artifact, document.documentNumber);
  }

  /**
   * Tải luồng nhị phân của tệp PDF artifact đã tạo có kiểm tra xác thực và đối soát hash
   */
  async getArtifactStream(
    documentId: string,
    versionNumber?: number,
    artifactType = ArtifactType.OFFICIAL_UNSIGNED,
    user?: UserPrincipal
  ): Promise<{ buffer: Buffer; artifact: DocumentArtifactView; fileName: string }> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      throw new NotFoundException(`Không tìm thấy hồ sơ với ID: ${documentId}`);
    }

    if (user && user.role !== 'SUPER_ADMIN' && document.organizationId !== user.organizationId) {
      throw new ForbiddenException('Bạn không có quyền tải tệp của tổ chức khác.');
    }

    const verNum = versionNumber || document.currentVersion;
    const docVersion = await this.prisma.documentVersion.findUnique({
      where: {
        documentId_versionNumber: {
          documentId,
          versionNumber: verNum,
        },
      },
    });

    if (!docVersion) {
      throw new NotFoundException(`Không tìm thấy phiên bản v${verNum} của hồ sơ.`);
    }

    const artifact = await this.prisma.documentArtifact.findUnique({
      where: {
        documentVersionId_artifactType: {
          documentVersionId: docVersion.id,
          artifactType,
        },
      },
    });

    if (!artifact) {
      throw new NotFoundException(`Chưa có tệp PDF artifact nào được tạo cho phiên bản v${verNum}.`);
    }

    if (artifact.status !== ArtifactStatus.COMPLETED || !artifact.storageKey) {
      throw new BadRequestException(
        `Tệp PDF chưa sẵn sàng (Trạng thái hiện tại: ${artifact.status}). Vui lòng thử lại sau.`
      );
    }

    // Đọc nhị phân từ Storage
    const buffer = await this.storageService.get(artifact.storageKey);

    // Đối soát tính toàn vẹn nhị phân: Băm lại SHA-256 từ byte đọc được so với rawPdfHash trong CSDL
    const currentHash = crypto.createHash('sha256').update(buffer).digest('hex');
    if (artifact.rawPdfHash && currentHash !== artifact.rawPdfHash) {
      throw new InternalServerErrorException(
        'CẢNH BÁO TOÀN VẸN: Mã băm SHA-256 của tệp trong kho lưu trữ không khớp với dữ liệu kiểm toán.'
      );
    }

    const typeSuffix = artifactType === ArtifactType.PREVIEW ? '_preview' : '';
    const fileName = `${document.documentNumber}_v${verNum}${typeSuffix}.pdf`;

    return {
      buffer,
      artifact: this.mapToView(artifact, document.documentNumber),
      fileName,
    };
  }

  /**
   * Lấy danh sách toàn bộ các artifact của một tài liệu
   */
  async getArtifactsForDocument(documentId: string, user: UserPrincipal): Promise<DocumentArtifactView[]> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      throw new NotFoundException(`Không tìm thấy hồ sơ với ID: ${documentId}`);
    }

    if (user.role !== 'SUPER_ADMIN' && document.organizationId !== user.organizationId) {
      throw new ForbiddenException('Bạn không có quyền truy cập hồ sơ của tổ chức khác.');
    }

    const artifacts = await this.prisma.documentArtifact.findMany({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
    });

    return artifacts.map((a) => this.mapToView(a, document.documentNumber));
  }

  private mapToView(artifact: any, documentNumber: string): DocumentArtifactView {
    return {
      id: artifact.id,
      documentId: artifact.documentId,
      documentVersionId: artifact.documentVersionId,
      organizationId: artifact.organizationId,
      artifactType: artifact.artifactType,
      status: artifact.status,
      storageKey: artifact.storageKey,
      mimeType: artifact.mimeType || 'application/pdf',
      sizeBytes: artifact.sizeBytes,
      rawPdfHash: artifact.rawPdfHash,
      formDataHash: artifact.formDataHash,
      signedPdfHash: artifact.signedPdfHash,
      requestedById: artifact.requestedById,
      errorMessage: artifact.errorMessage,
      startedAt: artifact.startedAt ? artifact.startedAt.toISOString() : null,
      completedAt: artifact.completedAt ? artifact.completedAt.toISOString() : null,
      createdAt: artifact.createdAt.toISOString(),
      updatedAt: artifact.updatedAt.toISOString(),
      downloadUrl:
        artifact.status === ArtifactStatus.COMPLETED
          ? `/api/documents/${artifact.documentId}/pdf?type=${artifact.artifactType}`
          : undefined,
    };
  }
}
