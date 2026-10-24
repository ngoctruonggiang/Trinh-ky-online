import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import {
  AuditAction,
  CertificateStatus,
  KeyStorageType,
  UserRole,
} from '@trinh-ky/shared';
import { RegisterCertificateDto } from './dto/register-certificate.dto';
import { UpdateCertificateStatusDto } from './dto/update-certificate-status.dto';
import {
  ISigningKeyProvider,
  SIGNING_KEY_PROVIDER,
} from './providers/signing-key-provider.interface';

export interface UserContext {
  id: string;
  role: UserRole;
  organizationId?: string | null;
  email?: string;
  fullName?: string;
}

@Injectable()
export class CertificateRegistryService {
  private readonly logger = new Logger(CertificateRegistryService.name);

  constructor(
    private readonly prisma: PrismaClient,
    @Inject(SIGNING_KEY_PROVIDER)
    private readonly signingProvider: ISigningKeyProvider
  ) {}

  /**
   * Đăng ký chứng thư số công khai X.509 vào hệ thống
   * YÊU CẦU BẢO MẬT:
   * - Chỉ ADMIN hoặc SUPER_ADMIN mới có quyền đăng ký chứng thư.
   * - organizationId được cố định theo actor, không cho phép client ghi đè.
   * - Tuyệt đối không lưu trữ private key trong CSDL.
   */
  async registerCertificate(actor: UserContext, dto: RegisterCertificateDto) {
    if (actor.role !== UserRole.SUPER_ADMIN && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Chỉ Quản trị viên (ADMIN) mới có quyền đăng ký chứng thư số cho tổ chức.'
      );
    }

    const orgId = actor.organizationId;
    if (!orgId) {
      throw new BadRequestException('Người dùng phải thuộc về một tổ chức để đăng ký chứng thư số.');
    }

    // 1. Nếu gán cho người dùng cụ thể, kiểm tra người dùng có thuộc cùng công ty không
    let assignedUserId: string | null = null;
    if (dto.userId) {
      const user = await this.prisma.user.findFirst({
        where: { id: dto.userId, organizationId: orgId },
      });
      if (!user) {
        throw new BadRequestException(
          'Người dùng được chỉ định không tồn tại hoặc không thuộc tổ chức của bạn.'
        );
      }
      assignedUserId = user.id;
    }

    // 2. Phân tích cú pháp chứng thư PEM bằng Native X509Certificate
    let x509: crypto.X509Certificate;
    try {
      x509 = new crypto.X509Certificate(dto.certificatePem);
    } catch (err: any) {
      throw new BadRequestException('Định dạng chứng thư số PEM không hợp lệ hoặc bị hỏng.');
    }

    const fingerprintSha256 = x509.fingerprint256.replace(/:/g, '').toLowerCase();
    const validFrom = new Date(x509.validFrom);
    const validTo = new Date(x509.validTo);

    // 3. Kiểm tra trùng lặp mã băm trong tổ chức
    const existingCert = await this.prisma.digitalCertificate.findFirst({
      where: { organizationId: orgId, fingerprintSha256 },
    });
    if (existingCert) {
      throw new ConflictException(
        'Chứng thư số này (dựa trên Fingerprint SHA-256) đã được đăng ký trong tổ chức.'
      );
    }

    // 4. Kiểm tra trùng lặp keyAlias trong tổ chức
    const existingAlias = await this.prisma.digitalCertificate.findFirst({
      where: { organizationId: orgId, keyAlias: dto.keyAlias },
    });
    if (existingAlias) {
      throw new ConflictException(
        `Định danh khóa [${dto.keyAlias}] đã được sử dụng trong tổ chức.`
      );
    }

    // 5. Kiểm tra thời hạn hiệu lực của chứng thư
    const now = new Date();
    let initialStatus = CertificateStatus.ACTIVE;
    if (now > validTo) {
      initialStatus = CertificateStatus.EXPIRED;
    }

    // 6. Lưu vào cơ sở dữ liệu
    const cert = await this.prisma.digitalCertificate.create({
      data: {
        organizationId: orgId,
        userId: assignedUserId,
        subjectDn: x509.subject,
        issuerDn: x509.issuer,
        serialNumber: x509.serialNumber.toLowerCase(),
        fingerprintSha256,
        certificatePem: dto.certificatePem,
        validFrom,
        validTo,
        status: initialStatus,
        keyStorageType: dto.keyStorageType || KeyStorageType.DEV_KEYSTORE,
        keyAlias: dto.keyAlias,
      },
      include: {
        user: {
          select: { id: true, fullName: true, email: true },
        },
      },
    });

    // 7. Ghi nhận AuditLog
    await this.prisma.auditLog.create({
      data: {
        userId: actor.id,
        action: AuditAction.CERTIFICATE_REGISTER,
        details: {
          organizationId: orgId,
          certificateId: cert.id,
          keyAlias: cert.keyAlias,
          subjectDn: cert.subjectDn,
          fingerprintSha256: cert.fingerprintSha256,
          assignedUserId: cert.userId,
        },
      },
    });

    return cert;
  }

  /**
   * Lấy chi tiết chứng thư số theo ID kèm phân quyền Tenant Isolation & User Privacy
   */
  async getCertificateById(actor: UserContext, id: string) {
    const cert = await this.prisma.digitalCertificate.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, fullName: true, email: true },
        },
        organization: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    if (!cert) {
      throw new NotFoundException(`Không tìm thấy chứng thư số với định danh: ${id}`);
    }

    // Tenant Isolation
    if (actor.role !== UserRole.SUPER_ADMIN && cert.organizationId !== actor.organizationId) {
      throw new ForbiddenException('Bạn không có quyền truy cập chứng thư số của tổ chức khác.');
    }

    // User-Level Privacy: Nếu là chứng thư cá nhân, chỉ chủ sở hữu hoặc ADMIN mới được xem
    if (
      actor.role === UserRole.USER &&
      cert.userId !== null &&
      cert.userId !== actor.id
    ) {
      throw new ForbiddenException(
        'Bạn không có quyền xem thông tin chứng thư số cá nhân của người dùng khác.'
      );
    }

    return cert;
  }

  /**
   * Liệt kê danh mục chứng thư số theo quyền
   */
  async listCertificates(
    actor: UserContext,
    query?: {
      status?: CertificateStatus;
      type?: 'PERSONAL' | 'ORGANIZATION';
      userId?: string;
    }
  ) {
    const whereClause: any = {};

    // 1. Phân quyền Tenant
    if (actor.role !== UserRole.SUPER_ADMIN) {
      whereClause.organizationId = actor.organizationId;
    }

    // 2. Phân quyền Người dùng thường: Chỉ xem con dấu chung hoặc chứng thư của chính mình
    if (actor.role === UserRole.USER) {
      whereClause.OR = [
        { userId: null }, // Con dấu chung của tổ chức
        { userId: actor.id }, // Chứng thư cá nhân của chính mình
      ];
    } else if (query?.userId) {
      whereClause.userId = query.userId;
    }

    // 3. Lọc theo trạng thái
    if (query?.status) {
      whereClause.status = query.status;
    }

    // 4. Lọc theo loại chứng thư
    if (query?.type === 'PERSONAL') {
      whereClause.userId = { not: null };
    } else if (query?.type === 'ORGANIZATION') {
      whereClause.userId = null;
    }

    return this.prisma.digitalCertificate.findMany({
      where: whereClause,
      include: {
        user: {
          select: { id: true, fullName: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Cập nhật trạng thái chứng thư số (ACTIVE / REVOKED)
   * TUYỆT ĐỐI KHÔNG cho phép sửa đổi organizationId, userId, keyAlias hoặc fingerprint.
   */
  async updateCertificateStatus(
    actor: UserContext,
    id: string,
    dto: UpdateCertificateStatusDto
  ) {
    if (actor.role !== UserRole.SUPER_ADMIN && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Chỉ Quản trị viên (ADMIN) mới có quyền cập nhật trạng thái chứng thư số.'
      );
    }

    const cert = await this.prisma.digitalCertificate.findUnique({
      where: { id },
    });

    if (!cert) {
      throw new NotFoundException(`Không tìm thấy chứng thư số với định danh: ${id}`);
    }

    // Tenant Isolation
    if (actor.role !== UserRole.SUPER_ADMIN && cert.organizationId !== actor.organizationId) {
      throw new ForbiddenException(
        'Bạn không có quyền cập nhật chứng thư số của tổ chức khác.'
      );
    }

    const updateData: any = {
      status: dto.status,
    };

    if (dto.status === CertificateStatus.REVOKED) {
      updateData.revokedAt = new Date();
      updateData.revokedReason = dto.reason || 'Thu hồi bởi Quản trị viên';
    } else if (dto.status === CertificateStatus.ACTIVE) {
      updateData.revokedAt = null;
      updateData.revokedReason = null;
    }

    const updated = await this.prisma.digitalCertificate.update({
      where: { id },
      data: updateData,
      include: {
        user: {
          select: { id: true, fullName: true, email: true },
        },
      },
    });

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        userId: actor.id,
        action: AuditAction.CERTIFICATE_UPDATE_STATUS,
        details: {
          organizationId: cert.organizationId,
          certificateId: id,
          oldStatus: cert.status,
          newStatus: dto.status,
          reason: dto.reason,
        },
      },
    });

    return updated;
  }

  /**
   * Kiểm tra thẩm quyền ký bằng chứng thư số cụ thể
   */
  async assertCanSignWithCertificate(actor: UserContext, certificateId: string) {
    const cert = await this.prisma.digitalCertificate.findUnique({
      where: { id: certificateId },
    });

    if (!cert) {
      throw new NotFoundException('Chứng thư số được chọn không tồn tại.');
    }

    // 1. Tenant Isolation
    if (cert.organizationId !== actor.organizationId) {
      throw new ForbiddenException('Chứng thư số không thuộc về tổ chức của bạn.');
    }

    // 2. Trạng thái chứng thư
    if (cert.status !== CertificateStatus.ACTIVE) {
      throw new BadRequestException(
        `Chứng thư số không ở trạng thái hoạt động (Trạng thái hiện tại: ${cert.status}).`
      );
    }

    // 3. Thời hạn hiệu lực
    const now = new Date();
    if (now < cert.validFrom || now > cert.validTo) {
      throw new BadRequestException(
        `Chứng thư số đã hết hạn hoặc chưa đến ngày có hiệu lực (Hiệu lực: ${cert.validFrom.toISOString()} - ${cert.validTo.toISOString()}).`
      );
    }

    // 4. Quyền sở hữu khóa
    if (cert.userId !== null) {
      // Chứng thư cá nhân: Phải là chính người đó ký
      if (actor.id !== cert.userId) {
        throw new ForbiddenException(
          'Bạn không có quyền sử dụng chứng thư số cá nhân của người khác.'
        );
      }
    } else {
      // Con dấu doanh nghiệp: Chỉ ADMIN hoặc SUPER_ADMIN mới được dùng để đóng dấu tổ chức
      if (actor.role !== UserRole.ADMIN && actor.role !== UserRole.SUPER_ADMIN) {
        throw new ForbiddenException(
          'Chỉ Quản trị viên mới có quyền sử dụng con dấu điện tử chung của tổ chức.'
        );
      }
    }

    return cert;
  }

  /**
   * Thử nghiệm ký số (Test Sign) để xác minh độ sẵn sàng của Provider và Key
   * Không can thiệp vào tài liệu PDF; chỉ ký token kiểm thử và xác minh bằng public key độc lập.
   */
  async testSignCertificate(actor: UserContext, certificateId: string) {
    const cert = await this.assertCanSignWithCertificate(actor, certificateId);

    // 1. Kiểm tra tính sẵn sàng của Provider
    const isAvailable = await this.signingProvider.isAvailable(cert.keyAlias);
    if (!isAvailable) {
      throw new BadRequestException(
        `Khóa ký với alias [${cert.keyAlias}] không sẵn sàng trong Provider lưu trữ khóa.`
      );
    }

    // 2. Tạo dữ liệu kiểm thử
    const testData = Buffer.from(
      `ANTIGRAVITY_TEST_SIGN_${cert.id}_${Date.now()}`,
      'utf8'
    );
    const testDigest = crypto.createHash('sha256').update(testData).digest();

    // 3. Thực hiện ký số qua Provider (thử cả signData và signDigest)
    const signDataResult = await this.signingProvider.signData(cert.keyAlias, testData);
    const signDigestResult = await this.signingProvider.signDigest(cert.keyAlias, testDigest);

    // 4. Xác minh độc lập bằng public key từ certificate công khai
    const x509 = new crypto.X509Certificate(cert.certificatePem);
    const isDataSigValid = crypto.verify(
      'sha256',
      testData,
      x509.publicKey,
      signDataResult.signatureBytes
    );

    const isDigestSigValid = crypto.verify(
      'sha256',
      testData,
      x509.publicKey,
      signDigestResult.signatureBytes
    );

    if (!isDataSigValid || !isDigestSigValid) {
      throw new BadRequestException(
        'Thử nghiệm ký số thất bại: Chữ ký tạo ra không thể xác minh bằng khóa công khai của chứng thư!'
      );
    }

    // 5. Ghi nhận AuditLog
    await this.prisma.auditLog.create({
      data: {
        userId: actor.id,
        action: AuditAction.CERTIFICATE_TEST_SIGN,
        details: {
          organizationId: cert.organizationId,
          certificateId: cert.id,
          keyAlias: cert.keyAlias,
          isDataSigValid,
          isDigestSigValid,
        },
      },
    });

    return {
      success: true,
      certificateId: cert.id,
      keyAlias: cert.keyAlias,
      isProviderAvailable: isAvailable,
      dataSignatureValid: isDataSigValid,
      digestSignatureValid: isDigestSigValid,
      signatureLengthBytes: signDigestResult.signatureBytes.length,
      testedAt: new Date(),
    };
  }
}
