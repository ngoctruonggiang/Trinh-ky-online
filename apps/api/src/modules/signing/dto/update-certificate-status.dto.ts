import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CertificateStatus } from '@trinh-ky/shared';

export class UpdateCertificateStatusDto {
  @IsNotEmpty({ message: 'Trạng thái chứng thư số không được để trống.' })
  @IsEnum(CertificateStatus, { message: 'Trạng thái chứng thư số không hợp lệ.' })
  status!: CertificateStatus;

  @IsOptional()
  @IsString()
  reason?: string;
}
