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
  AddLtvDto,
  AddLtvResultView,
  LtvVerificationResult,
} from '@trinh-ky/shared';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import { UserPrincipal } from '../../../common/interfaces/user-principal.interface.js';
import { StorageService } from '../../artifact/storage/storage.service.js';
import { ArtifactService } from '../../artifact/artifact.service.js';
import {
  ISigningKeyProvider,
  SIGNING_KEY_PROVIDER,
} from '../providers/signing-key-provider.interface.js';
import { TimestampService } from '../timestamp/timestamp.service.js';
import { PdfDssService } from '../dss/pdf-dss.service.js';
import { PdfSignatureAdapter } from './pdf-signature.adapter.js';
import { PdfSignatureVerifier } from './pdf-signature.verifier.js';

@Injectable()
export class PdfSigningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly artifactService: ArtifactService,
    @Inject(SIGNING_KEY_PROVIDER)
    private readonly keyProvider: ISigningKeyProvider,
    private readonly timestampService: TimestampService,
    private readonly pdfDssService: PdfDssService
  ) {}

  /**
   * Ký số tệp PDF của hồ sơ bằng chứng thư số X.509, hỗ trợ RFC 3161 Trusted Timestamping
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

    const requireTimestamp = !!dto.requireTimestamp;
    const includeLtv = !!dto.includeLtv;

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

      // 5. Thực hiện ký số PDF (CMS Detached + ByteRange Injection + RFC 3161 TSA)
      const signingResult = await PdfSignatureAdapter.signPdf({
        unsignedPdfBuffer: unsignedPdfBytes,
        keyAlias: certificate.keyAlias,
        keyProvider: this.keyProvider,
        signerCertificatePem: certificate.certificatePem,
        reason: dto.reason || 'Phê duyệt tài liệu điện tử qua Trình Ký Online',
        contactInfo: dto.contactInfo || user.email,
        signerName: user.fullName || undefined,
        location: dto.location || 'Việt Nam',
        tsaProvider: requireTimestamp ? this.timestampService.getProvider() : undefined,
        requireTimestamp,
      });

      // 6. TỰ XÁC MINH NGAY LẬP TỨC ĐỐI VỚI PDF ĐÃ KÝ (Fail Closed Defense in Depth)
      let verifyResult = PdfSignatureVerifier.verify(signingResult.signedPdfBuffer);
      if (!verifyResult.isValid || verifyResult.isTampered) {
        throw new InternalServerErrorException(
          `Chữ ký số tạo ra không vượt qua bước tự xác minh tính toàn vẹn: ${verifyResult.errorMessage}`
        );
      }

      if (requireTimestamp && (!verifyResult.hasTimestamp || !verifyResult.isTimestampValid)) {
        throw new InternalServerErrorException(
          `Yêu cầu ký bắt buộc dấu thời gian RFC 3161 nhưng xác minh dấu thời gian không thành công: ${verifyResult.timestampErrorMessage || 'Thiếu timestamp token'}`
        );
      }

      // 6.1. BỔ SUNG LTV / DSS NẾU ĐƯỢC YÊU CẦU (PAdES B-LT)
      let finalSignedPdfBuffer = signingResult.signedPdfBuffer;
      let finalSignedPdfHash = signingResult.signedPdfHash;
      let hasLtv = false;
      let ltvStatus: string | undefined;
      let dssCertsCount: number | undefined;
      let dssOcspsCount: number | undefined;
      let dssCrlsCount: number | undefined;
      let ltvEmbeddedAt: Date | undefined;

      if (includeLtv) {
        const ltvResult = await this.pdfDssService.applyLtv({
          signedPdfBuffer: signingResult.signedPdfBuffer,
          signerCertificatePem: certificate.certificatePem,
          tsaCertificatePem: signingResult.hasTimestamp
            ? ((this.timestampService.getProvider() as any)?.getCertificatePem?.() ||
                (this.timestampService.getProvider() as any)?.getTsaCertificatePem?.())
            : undefined,
          signatureValueBuffer: signingResult.signatureValueBuffer,
        });

        if (ltvResult.hasLtv) {
          finalSignedPdfBuffer = ltvResult.updatedPdfBuffer;
          finalSignedPdfHash = crypto.createHash('sha256').update(finalSignedPdfBuffer).digest('hex');
          hasLtv = true;
          ltvStatus = ltvResult.ltvStatus;
          dssCertsCount = ltvResult.dssCertsCount;
          dssOcspsCount = ltvResult.dssOcspsCount;
          dssCrlsCount = ltvResult.dssCrlsCount;
          ltvEmbeddedAt = new Date();

          // Tự xác minh lại tệp PDF sau khi bổ sung DSS
          const ltvVerifyResult = PdfSignatureVerifier.verify(finalSignedPdfBuffer);
          if (!ltvVerifyResult.isValid || ltvVerifyResult.isTampered) {
            throw new InternalServerErrorException(
              `Tệp PDF sau khi bổ sung DSS không vượt qua bước tự xác minh: ${ltvVerifyResult.errorMessage}`
            );
          }
          verifyResult = ltvVerifyResult;
        } else {
          throw new BadRequestException(
            `Yêu cầu tạo chữ ký PAdES B-LT thất bại do không thể thu thập đầy đủ thông tin xác thực dài hạn: ${ltvResult.errorMessage || ltvResult.ltvStatus}`
          );
        }
      }

      // 7. Lưu tệp PDF đã ký vào Storage theo đường dẫn an toàn
      const signedStorageKey = this.storageService.generateArtifactKey(
        document.organizationId,
        document.id,
        versionNumber,
        ArtifactType.SIGNED_PDF,
        finalSignedPdfHash
      );
      await this.storageService.put(signedStorageKey, finalSignedPdfBuffer, 'application/pdf');

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
          sizeBytes: finalSignedPdfBuffer.length,
          rawPdfHash: signingResult.rawPdfHash,
          formDataHash: docVersion.sha256Hash,
          signedPdfHash: finalSignedPdfHash,
          certificateId: certificate.id,
          signerName: user.fullName || certificate.subjectDn,
          signerSubject: certificate.subjectDn,
          signingTime: signingResult.signingTime,
          byteRange: signingResult.byteRange,
          hasTimestamp: signingResult.hasTimestamp,
          timestampGenTime: signingResult.timestampGenTime,
          tsaSubject: signingResult.tsaSubjectDn,
          tsaSerialNumber: signingResult.tsaSerialNumber,
          tsaPolicyOid: signingResult.tsaPolicyOid,
          hasLtv,
          ltvStatus,
          dssCertsCount,
          dssOcspsCount,
          dssCrlsCount,
          ltvEmbeddedAt,
          requestedById: user.id,
          completedAt: new Date(),
        },
        update: {
          status: ArtifactStatus.COMPLETED,
          storageKey: signedStorageKey,
          sizeBytes: finalSignedPdfBuffer.length,
          rawPdfHash: signingResult.rawPdfHash,
          signedPdfHash: finalSignedPdfHash,
          certificateId: certificate.id,
          signerName: user.fullName || certificate.subjectDn,
          signerSubject: certificate.subjectDn,
          signingTime: signingResult.signingTime,
          byteRange: signingResult.byteRange,
          hasTimestamp: signingResult.hasTimestamp,
          timestampGenTime: signingResult.timestampGenTime,
          tsaSubject: signingResult.tsaSubjectDn,
          tsaSerialNumber: signingResult.tsaSerialNumber,
          tsaPolicyOid: signingResult.tsaPolicyOid,
          hasLtv,
          ltvStatus,
          dssCertsCount,
          dssOcspsCount,
          dssCrlsCount,
          ltvEmbeddedAt,
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
            hasTimestamp: signingResult.hasTimestamp,
            tsaSubject: signingResult.tsaSubjectDn,
            timestampGenTime: signingResult.timestampGenTime?.toISOString(),
            hasLtv,
            ltvStatus,
            padesLevel: verifyResult.padesLevel,
            isDelegated: Boolean(dto.isDelegated),
            ...(dto.isDelegated
              ? {
                  delegatorId: dto.delegatedFromUserId,
                  delegationPolicyId: dto.delegationPolicyId,
                  actualActorId: user.id,
                }
              : {}),
            stepId: dto.stepId || undefined,
          },
        },
      });

      if (hasLtv) {
        await tx.auditLog.create({
          data: {
            action: AuditAction.DOCUMENT_ADD_LTV,
            userId: user.id,
            documentId: document.id,
            details: {
              organizationId: document.organizationId,
              versionNumber,
              artifactId: signedArtifact.id,
              signedPdfHash: finalSignedPdfHash,
              hasLtv: true,
              ltvStatus,
              dssCertsCount,
              dssOcspsCount,
              dssCrlsCount,
              padesLevel: verifyResult.padesLevel,
            },
          },
        });
      }

      return {
        artifactId: signedArtifact.id,
        documentId: document.id,
        documentVersionId: docVersion.id,
        status: ArtifactStatus.COMPLETED,
        signedPdfHash: finalSignedPdfHash,
        rawPdfHash: signingResult.rawPdfHash,
        formDataHash: docVersion.sha256Hash,
        sizeBytes: finalSignedPdfBuffer.length,
        byteRange: signingResult.byteRange,
        signerSubject: certificate.subjectDn,
        signerIssuer: certificate.issuerDn,
        signingTime: signingResult.signingTime.toISOString(),
        hasTimestamp: signingResult.hasTimestamp,
        timestampGenTime: signingResult.timestampGenTime?.toISOString(),
        tsaSubject: signingResult.tsaSubjectDn,
        hasLtv,
        ltvStatus,
        dssCertsCount,
        dssOcspsCount,
        dssCrlsCount,
        ltvEmbeddedAt: ltvEmbeddedAt?.toISOString(),
        padesLevel: verifyResult.padesLevel,
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

  /**
   * Bổ sung thông tin xác thực dài hạn DSS (LTV) cho tệp PDF đã ký của hồ sơ
   */
  async addLtvToDocument(
    documentId: string,
    dto: AddLtvDto = {},
    user: UserPrincipal
  ): Promise<AddLtvResultView> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
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
      throw new NotFoundException(`Không tìm thấy phiên bản v${versionNumber} của hồ sơ.`);
    }

    return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext('doc_ltv_' || $1)::bigint);`,
        documentId
      );

      const signedArtifact = await tx.documentArtifact.findUnique({
        where: {
          documentVersionId_artifactType: {
            documentVersionId: docVersion.id,
            artifactType: ArtifactType.SIGNED_PDF,
          },
        },
        include: {
          certificate: true,
        },
      });

      if (!signedArtifact || signedArtifact.status !== ArtifactStatus.COMPLETED || !signedArtifact.storageKey) {
        throw new BadRequestException('Hồ sơ chưa có tệp PDF đã ký số. Cần ký số trước khi bổ sung LTV.');
      }

      // Đọc tệp PDF đã ký từ Storage
      const signedPdfBytes = await this.storageService.get(signedArtifact.storageKey);

      // Xác minh chữ ký hiện tại trước khi bổ sung LTV
      const preVerify = PdfSignatureVerifier.verify(signedPdfBytes);
      if (!preVerify.isValid || preVerify.isTampered) {
        throw new BadRequestException(
          `Chữ ký hiện tại của tệp PDF không hợp lệ hoặc đã bị can thiệp: ${preVerify.errorMessage}`
        );
      }

      // Lấy thông tin chứng thư số người ký
      let signerCertPem = signedArtifact.certificate?.certificatePem;
      if (!signerCertPem) {
        throw new BadRequestException('Không tìm thấy thông tin chứng thư số đã dùng để ký tệp.');
      }

      // Bổ sung DSS qua PdfDssService
      const ltvResult = await this.pdfDssService.applyLtv({
        signedPdfBuffer: signedPdfBytes,
        signerCertificatePem: signerCertPem,
        tsaCertificatePem: signedArtifact.hasTimestamp
          ? ((this.timestampService.getProvider() as any)?.getCertificatePem?.() ||
              (this.timestampService.getProvider() as any)?.getTsaCertificatePem?.())
          : undefined,
      });

      if (!ltvResult.hasLtv) {
        throw new BadRequestException(
          `Không thể bổ sung dữ liệu xác thực dài hạn LTV: ${ltvResult.errorMessage || ltvResult.ltvStatus}`
        );
      }

      // Tự xác minh tệp PDF sau khi bổ sung DSS
      const postVerify = PdfSignatureVerifier.verify(ltvResult.updatedPdfBuffer);
      if (!postVerify.isValid || postVerify.isTampered) {
        throw new InternalServerErrorException(
          `Tệp PDF sau khi bổ sung DSS không vượt qua bước tự xác minh: ${postVerify.errorMessage}`
        );
      }

      // Tính mã băm mới
      const newSignedPdfHash = crypto.createHash('sha256').update(ltvResult.updatedPdfBuffer).digest('hex');

      // Lưu tệp PDF mới vào Storage
      const newStorageKey = this.storageService.generateArtifactKey(
        document.organizationId,
        document.id,
        versionNumber,
        ArtifactType.SIGNED_PDF,
        newSignedPdfHash
      );
      await this.storageService.put(newStorageKey, ltvResult.updatedPdfBuffer, 'application/pdf');

      // Cập nhật DocumentArtifact
      const now = new Date();
      await tx.documentArtifact.update({
        where: { id: signedArtifact.id },
        data: {
          storageKey: newStorageKey,
          signedPdfHash: newSignedPdfHash,
          sizeBytes: ltvResult.updatedPdfBuffer.length,
          hasLtv: true,
          ltvStatus: ltvResult.ltvStatus,
          dssCertsCount: ltvResult.dssCertsCount,
          dssOcspsCount: ltvResult.dssOcspsCount,
          dssCrlsCount: ltvResult.dssCrlsCount,
          ltvEmbeddedAt: now,
        },
      });

      // Ghi nhật ký kiểm toán (Audit Log)
      await tx.auditLog.create({
        data: {
          action: AuditAction.DOCUMENT_ADD_LTV,
          userId: user.id,
          documentId: document.id,
          details: {
            organizationId: document.organizationId,
            versionNumber,
            artifactId: signedArtifact.id,
            previousHash: signedArtifact.signedPdfHash,
            newHash: newSignedPdfHash,
            hasLtv: true,
            ltvStatus: ltvResult.ltvStatus,
            dssCertsCount: ltvResult.dssCertsCount,
            dssOcspsCount: ltvResult.dssOcspsCount,
            dssCrlsCount: ltvResult.dssCrlsCount,
            padesLevel: postVerify.padesLevel,
          },
        },
      });

      return {
        artifactId: signedArtifact.id,
        documentId: document.id,
        documentVersionId: docVersion.id,
        signedPdfHash: newSignedPdfHash,
        sizeBytes: ltvResult.updatedPdfBuffer.length,
        hasLtv: true,
        ltvStatus: ltvResult.ltvStatus,
        padesLevel: postVerify.padesLevel || 'PADES_B_LT',
        dssCertsCount: ltvResult.dssCertsCount,
        dssOcspsCount: ltvResult.dssOcspsCount,
        dssCrlsCount: ltvResult.dssCrlsCount,
        embeddedAt: now.toISOString(),
        downloadUrl: `/api/documents/${document.id}/pdf?type=SIGNED_PDF`,
      };
    });
  }

  /**
   * Xác minh toàn diện thông tin xác thực dài hạn (LTV / DSS) của hồ sơ
   */
  async verifyLtv(
    documentId: string,
    versionNumberOrUser?: number | UserPrincipal,
    maybeUser?: UserPrincipal
  ): Promise<LtvVerificationResult> {
    let versionNumber: number | undefined;
    let user: UserPrincipal;

    if (maybeUser) {
      versionNumber = typeof versionNumberOrUser === 'number' ? versionNumberOrUser : undefined;
      user = maybeUser;
    } else if (typeof versionNumberOrUser === 'object' && versionNumberOrUser !== null) {
      user = versionNumberOrUser as UserPrincipal;
      versionNumber = undefined;
    } else {
      throw new BadRequestException('Thông tin người dùng (UserPrincipal) không hợp lệ.');
    }

    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      throw new NotFoundException(`Không tìm thấy hồ sơ với ID: ${documentId}`);
    }

    if (user.role !== 'SUPER_ADMIN' && document.organizationId !== user.organizationId) {
      throw new ForbiddenException('Bạn không có quyền truy cập hồ sơ của tổ chức khác.');
    }

    const version = versionNumber || document.currentVersion;
    const docVersion = await this.prisma.documentVersion.findUnique({
      where: {
        documentId_versionNumber: {
          documentId,
          versionNumber: version,
        },
      },
    });

    if (!docVersion) {
      throw new NotFoundException(`Không tìm thấy phiên bản v${version} của hồ sơ.`);
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
      throw new NotFoundException('Hồ sơ chưa có tệp PDF đã ký số (SIGNED_PDF artifact).');
    }

    const signedPdfBytes = await this.storageService.get(signedArtifact.storageKey);
    const verifyResult = PdfSignatureVerifier.verify(signedPdfBytes);

    return {
      isValid: verifyResult.isValid,
      signatureIntegrity: verifyResult.signatureIntegrity ?? (verifyResult.isDigestValid && verifyResult.isSignatureValid),
      certificatePathValid: verifyResult.certificatePathValid ?? true,
      revocationStatus: verifyResult.revocationStatus ?? 'UNAVAILABLE',
      timestampStatus: verifyResult.timestampStatus ?? (verifyResult.hasTimestamp ? 'VALID' : 'MISSING'),
      hasTimestamp: verifyResult.hasTimestamp,
      hasLtv: !!verifyResult.hasLtv,
      ltvDataPresent: !!verifyResult.ltvDataPresent,
      ltvValidationStatus: verifyResult.ltvValidationStatus ?? 'REVOCATION_DATA_MISSING',
      padesLevel: verifyResult.padesLevel ?? 'PADES_B_B',
      dssInfo: verifyResult.dssInfo,
      errorMessage: verifyResult.errorMessage,
    };
  }

  /**
   * Tự động ký niêm phong số PAdES B-LT khi hồ sơ hoàn tất toàn bộ quy trình phê duyệt (APPROVED)
   */
  async autoSealApprovedDocument(
    documentId: string,
    actor: UserPrincipal
  ): Promise<SignDocumentResultView | null> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        organization: true,
        workflow: {
          include: {
            steps: {
              include: {
                assignees: true,
              },
            },
          },
        },
      },
    });

    if (!document) {
      return null;
    }

    // 1. Tìm chứng thư số niêm phong phù hợp của tổ chức hoặc của người phê duyệt cuối cùng
    const orgCerts = await this.prisma.digitalCertificate.findMany({
      where: {
        organizationId: document.organizationId,
        userId: null, // Ưu tiên con dấu điện tử chung của tổ chức
        status: CertificateStatus.ACTIVE,
      },
      orderBy: { createdAt: 'desc' },
    });

    let certificate: any = null;
    for (const cert of orgCerts) {
      if (await this.keyProvider.isAvailable(cert.keyAlias)) {
        certificate = cert;
        break;
      }
    }

    if (!certificate) {
      // Nếu tổ chức chưa có con dấu khả dụng, tìm chứng thư cá nhân của người duyệt cuối cùng
      const userCerts = await this.prisma.digitalCertificate.findMany({
        where: {
          organizationId: document.organizationId,
          userId: actor.id,
          status: CertificateStatus.ACTIVE,
        },
        orderBy: { createdAt: 'desc' },
      });
      for (const cert of userCerts) {
        if (await this.keyProvider.isAvailable(cert.keyAlias)) {
          certificate = cert;
          break;
        }
      }
    }

    if (!certificate) {
      // Nếu cả tổ chức và người duyệt đều chưa có chứng thư ACTIVE:
      // Không crash workflow phê duyệt, trả về null
      return null;
    }

    // 2. Kích hoạt ký số PAdES B-LT với đầy đủ Trusted Timestamp và LTV
    const signResult = await this.signDocument(
      documentId,
      {
        certificateId: certificate.id,
        requireTimestamp: true,
        includeLtv: true,
        reason: 'Chữ ký số niêm phong điện tử tự động khi hồ sơ hoàn tất phê duyệt (PAdES Baseline B-LT)',
      },
      actor
    );

    // 3. Gửi thông báo hoàn tất niêm phong số tới người tạo hồ sơ và tất cả người tham gia quy trình
    const participantUserIds = new Set<string>();
    if (document.createdById) {
      participantUserIds.add(document.createdById);
    }
    if (document.workflow?.steps) {
      for (const step of document.workflow.steps) {
        for (const assignee of step.assignees) {
          if (assignee.userId) {
            participantUserIds.add(assignee.userId);
          }
        }
      }
    }

    const downloadUrl = `/api/documents/${document.id}/pdf?type=SIGNED_PDF`;
    for (const userId of participantUserIds) {
      if (typeof (this.prisma as any).notification?.create === 'function') {
        await (this.prisma as any).notification.create({
          data: {
            userId,
            documentId: document.id,
            type: 'DOCUMENT_APPROVED',
            title: 'Hồ sơ đã được phê duyệt và niêm phong số PAdES B-LT',
            content: `Hồ sơ "${document.title}" (Số: ${document.documentNumber}) đã hoàn tất tất cả các bước phê duyệt và được niêm phong chữ ký số PAdES B-LT hợp lệ kèm dấu thời gian và LTV.`,
            metadata: {
              documentId: document.id,
              versionNumber: document.currentVersion,
              downloadUrl,
              signedPdfHash: signResult.signedPdfHash,
              padesLevel: signResult.padesLevel,
              completedAt: new Date().toISOString(),
            },
          },
        });
      }
    }

    return signResult;
  }
}
