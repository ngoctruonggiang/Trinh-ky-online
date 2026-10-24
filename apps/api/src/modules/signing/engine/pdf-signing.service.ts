import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import {
  ArtifactStatus,
  ArtifactType,
  AuditAction,
  CertificateStatus,
  PdfSignatureVerificationResult,
  SignDocumentDto,
  SignDocumentResultView,
} from '@trinh-ky/shared';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import { UserPrincipal } from '../../../common/interfaces/user-principal.interface.js';
import { StorageService } from '../../artifact/storage/storage.service.js';
import { ArtifactService } from '../../artifact/artifact.service.js';
import {
  ISigningKeyProvider,
  SIGNING_KEY_PROVIDER,
} from '../providers/signing-key-provider.interface.js';
import { PdfSignatureAdapter } from './pdf-signature.adapter.js';
import { PdfSignatureVerifier } from './pdf-signature.verifier.js';

@Injectable()
export class PdfSigningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly artifactService: ArtifactService,
    @Inject(SIGNING_KEY_PROVIDER)
    private readonly keyProvider: ISigningKeyProvider
  ) {}

  /**
   * Ký số tệp PDF của hồ sơ bằng chứng thư số X.509
   */
  async signDocument(
    documentId: string,
    dto: SignDocumentDto = {},
    user: UserPrincipal
  ): Promise<SignDocumentResultView> {
    // 1. Kiểm tra tài liệu và phân quyền Tenant
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        organization: true,
        createdBy: true,
      },
    });

    if (!document) {
      throw new NotFoundException(`Không tìm thấy hồ sơ với ID: ${documentId}`);
    }

    if (user.role !== 'SUPER_ADMIN' && document.organizationId !== user.organizationId) {
      throw new ForbiddenException('Bạn không có quyền truy cập hồ sơ của tổ chức khác.');
    }

    const versionNumber = dto.versionNumber || document.currentVersion;

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

    // 2. Xác định và kiểm tra tính hợp lệ của Chứng thư số
    let certificate;
    if (dto.certificateId) {
      certificate = await this.prisma.digitalCertificate.findUnique({
        where: { id: dto.certificateId },
      });
      if (!certificate) {
        throw new NotFoundException(`Không tìm thấy chứng thư số với ID: ${dto.certificateId}`);
      }

      // Kiểm tra Tenant của chứng thư
      if (certificate.organizationId !== document.organizationId) {
        throw new ForbiddenException('Chứng thư số không thuộc cùng tổ chức với hồ sơ.');
      }

      // Kiểm tra quyền sở hữu chứng thư cá nhân
      if (certificate.userId && certificate.userId !== user.id && user.role === 'USER') {
        throw new ForbiddenException('Bạn không thể ký bằng chứng thư cá nhân của người khác.');
      }
    } else {
      // Tự động tìm chứng thư cá nhân đang hoạt động của người dùng
      certificate = await this.prisma.digitalCertificate.findFirst({
        where: {
          organizationId: document.organizationId,
          userId: user.id,
          status: CertificateStatus.ACTIVE,
        },
      });

      // Nếu không có cert cá nhân, tìm cert tổ chức (nếu người dùng là ADMIN/SUPER_ADMIN)
      if (!certificate && (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN')) {
        certificate = await this.prisma.digitalCertificate.findFirst({
          where: {
            organizationId: document.organizationId,
            userId: null,
            status: CertificateStatus.ACTIVE,
          },
        });
      }

      if (!certificate) {
        throw new BadRequestException(
          'Không tìm thấy chứng thư số hoạt động (ACTIVE) nào thuộc quyền sở hữu của bạn trong tổ chức.'
        );
      }
    }

    // Kiểm tra trạng thái hoạt động của chứng thư
    if (certificate.status !== CertificateStatus.ACTIVE) {
      throw new BadRequestException(
        `Chứng thư số không ở trạng thái hoạt động (Trạng thái hiện tại: ${certificate.status}).`
      );
    }

    // Kiểm tra thời hạn hiệu lực
    const now = new Date();
    if (now < certificate.validFrom || now > certificate.validTo) {
      throw new BadRequestException('Chứng thư số đã hết hạn hoặc chưa đến thời điểm hiệu lực.');
    }

    // Kiểm tra tính sẵn sàng của khóa trong Key Provider
    const isKeyReady = await this.keyProvider.isAvailable(certificate.keyAlias);
    if (!isKeyReady) {
      throw new InternalServerErrorException(
        `Khóa ký (Key Alias: ${certificate.keyAlias}) chưa sẵn sàng trong Signing Provider.`
      );
    }

    // 3. Khóa tương tranh transaction bằng PostgreSQL Advisory Lock
    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext('doc_sign_' || $1)::bigint);`,
        documentId
      );

      // 4. Lấy tệp PDF gốc chưa ký (OFFICIAL_UNSIGNED)
      let unsignedArtifact = await tx.documentArtifact.findUnique({
        where: {
          documentVersionId_artifactType: {
            documentVersionId: docVersion.id,
            artifactType: ArtifactType.OFFICIAL_UNSIGNED,
          },
        },
      });

      // Nếu chưa có PDF chưa ký, tự động kết xuất qua ArtifactService
      if (!unsignedArtifact || unsignedArtifact.status !== ArtifactStatus.COMPLETED || !unsignedArtifact.storageKey) {
        await this.artifactService.renderArtifact(documentId, { versionNumber }, user);
        unsignedArtifact = await tx.documentArtifact.findUnique({
          where: {
            documentVersionId_artifactType: {
              documentVersionId: docVersion.id,
              artifactType: ArtifactType.OFFICIAL_UNSIGNED,
            },
          },
        });
      }

      if (!unsignedArtifact || !unsignedArtifact.storageKey) {
        throw new InternalServerErrorException('Không thể chuẩn bị tệp PDF gốc chưa ký để thực hiện ký số.');
      }

      // Đọc tệp PDF nhị phân từ Storage
      const unsignedPdfBytes = await this.storageService.get(unsignedArtifact.storageKey);

      // Đối soát tính toàn vẹn của PDF gốc với mã băm rawPdfHash trong CSDL
      const actualRawHash = crypto.createHash('sha256').update(unsignedPdfBytes).digest('hex');
      if (unsignedArtifact.rawPdfHash && actualRawHash !== unsignedArtifact.rawPdfHash) {
        throw new InternalServerErrorException(
          'Tệp PDF gốc trên hệ thống lưu trữ bị sai lệch mã băm toàn vẹn (Storage Corrupted).'
        );
      }

      // 5. Thực hiện ký số PDF (CMS Detached + ByteRange Injection)
      const signingResult = await PdfSignatureAdapter.signPdf({
        unsignedPdfBuffer: unsignedPdfBytes,
        keyAlias: certificate.keyAlias,
        keyProvider: this.keyProvider,
        signerCertificatePem: certificate.certificatePem,
        reason: dto.reason || 'Phê duyệt tài liệu điện tử qua Trình Ký Online',
        contactInfo: dto.contactInfo || user.email,
        signerName: user.fullName || undefined,
        location: dto.location || 'Việt Nam',
      });

      // 6. TỰ XÁC MINH NGAY LẬP TỨC ĐỐI VỚI PDF ĐÃ KÝ (Fail Closed Defense in Depth)
      const verifyResult = PdfSignatureVerifier.verify(signingResult.signedPdfBuffer);
      if (!verifyResult.isValid || verifyResult.isTampered) {
        throw new InternalServerErrorException(
          `Chữ ký số tạo ra không vượt qua bước tự xác minh tính toàn vẹn: ${verifyResult.errorMessage}`
        );
      }

      // 7. Lưu tệp PDF đã ký vào Storage theo đường dẫn an toàn
      const signedStorageKey = this.storageService.generateArtifactKey(
        document.organizationId,
        document.id,
        versionNumber,
        ArtifactType.SIGNED_PDF,
        signingResult.signedPdfHash
      );
      await this.storageService.put(signedStorageKey, signingResult.signedPdfBuffer, 'application/pdf');

      // 8. Lưu hoặc cập nhật bản ghi DocumentArtifact với loại SIGNED_PDF
      const signedArtifact = await tx.documentArtifact.upsert({
        where: {
          documentVersionId_artifactType: {
            documentVersionId: docVersion.id,
            artifactType: ArtifactType.SIGNED_PDF,
          },
        },
        create: {
          documentId: document.id,
          documentVersionId: docVersion.id,
          organizationId: document.organizationId,
          artifactType: ArtifactType.SIGNED_PDF,
          status: ArtifactStatus.COMPLETED,
          storageKey: signedStorageKey,
          mimeType: 'application/pdf',
          sizeBytes: signingResult.signedPdfBuffer.length,
          rawPdfHash: signingResult.rawPdfHash,
          formDataHash: docVersion.sha256Hash,
          signedPdfHash: signingResult.signedPdfHash,
          certificateId: certificate.id,
          signerName: user.fullName || certificate.subjectDn,
          signerSubject: certificate.subjectDn,
          signingTime: signingResult.signingTime,
          byteRange: signingResult.byteRange,
          requestedById: user.id,
          completedAt: new Date(),
        },
        update: {
          status: ArtifactStatus.COMPLETED,
          storageKey: signedStorageKey,
          sizeBytes: signingResult.signedPdfBuffer.length,
          rawPdfHash: signingResult.rawPdfHash,
          signedPdfHash: signingResult.signedPdfHash,
          certificateId: certificate.id,
          signerName: user.fullName || certificate.subjectDn,
          signerSubject: certificate.subjectDn,
          signingTime: signingResult.signingTime,
          byteRange: signingResult.byteRange,
          completedAt: new Date(),
          errorMessage: null,
        },
      });

      // 9. Ghi nhận nhật ký kiểm toán (Audit Log)
      await tx.auditLog.create({
        data: {
          action: AuditAction.DOCUMENT_SIGN_PDF,
          userId: user.id,
          documentId: document.id,
          details: {
            organizationId: document.organizationId,
            versionNumber,
            certificateId: certificate.id,
            keyAlias: certificate.keyAlias,
            rawPdfHash: signingResult.rawPdfHash,
            signedPdfHash: signingResult.signedPdfHash,
            signerSubject: certificate.subjectDn,
            signingTime: signingResult.signingTime.toISOString(),
          },
        },
      });

      return {
        artifactId: signedArtifact.id,
        documentId: document.id,
        documentVersionId: docVersion.id,
        status: ArtifactStatus.COMPLETED,
        signedPdfHash: signingResult.signedPdfHash,
        rawPdfHash: signingResult.rawPdfHash,
        formDataHash: docVersion.sha256Hash,
        sizeBytes: signingResult.signedPdfBuffer.length,
        byteRange: signingResult.byteRange,
        signerSubject: certificate.subjectDn,
        signerIssuer: certificate.issuerDn,
        signingTime: signingResult.signingTime.toISOString(),
        isSignatureVerified: true,
        downloadUrl: `/api/documents/${document.id}/pdf?type=SIGNED_PDF`,
      };
    });
  }

  /**
   * Xác minh độc lập chữ ký số trên tệp PDF đã ký của hồ sơ
   */
  async verifyDocumentSignature(
    documentId: string,
    options: { versionNumber?: number } = {},
    user: UserPrincipal
  ): Promise<PdfSignatureVerificationResult> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      throw new NotFoundException(`Không tìm thấy hồ sơ với ID: ${documentId}`);
    }

    if (user.role !== 'SUPER_ADMIN' && document.organizationId !== user.organizationId) {
      throw new ForbiddenException('Bạn không có quyền truy cập hồ sơ của tổ chức khác.');
    }

    const versionNumber = options.versionNumber || document.currentVersion;
    const docVersion = await this.prisma.documentVersion.findUnique({
      where: {
        documentId_versionNumber: {
          documentId,
          versionNumber,
        },
      },
    });

    if (!docVersion) {
      throw new NotFoundException(`Không tìm thấy phiên bản v${versionNumber} của hồ sơ.`);
    }

    const signedArtifact = await this.prisma.documentArtifact.findUnique({
      where: {
        documentVersionId_artifactType: {
          documentVersionId: docVersion.id,
          artifactType: ArtifactType.SIGNED_PDF,
        },
      },
    });

    if (!signedArtifact || signedArtifact.status !== ArtifactStatus.COMPLETED || !signedArtifact.storageKey) {
      throw new NotFoundException('Hồ sơ này chưa có tệp PDF đã ký số (SIGNED_PDF artifact).');
    }

    const signedBytes = await this.storageService.get(signedArtifact.storageKey);
    return PdfSignatureVerifier.verify(signedBytes);
  }
}
