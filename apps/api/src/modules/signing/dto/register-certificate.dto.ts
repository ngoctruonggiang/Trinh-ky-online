import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { KeyStorageType } from '@trinh-ky/shared';

export class RegisterCertificateDto {
  @IsOptional()
  @IsString()
  userId?: string | null;

  @IsNotEmpty({ message: 'Nội dung chứng thư số PEM không được để trống.' })
  @IsString()
  certificatePem!: string;

  @IsNotEmpty({ message: 'Định danh khóa (keyAlias) không được để trống.' })
  @IsString()
  keyAlias!: string;

  @IsOptional()
  @IsEnum(KeyStorageType, { message: 'Loại lưu trữ khóa không hợp lệ.' })
  keyStorageType?: KeyStorageType;
}
