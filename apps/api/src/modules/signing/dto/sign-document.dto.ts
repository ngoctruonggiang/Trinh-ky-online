import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class SignDocumentRequestDto {
  @IsOptional()
  @IsUUID('4', { message: 'certificateId phải là định dạng UUID hợp lệ' })
  certificateId?: string;

  @IsOptional()
  @IsString({ message: 'Lý do ký (reason) phải là chuỗi ký tự' })
  reason?: string;

  @IsOptional()
  @IsString({ message: 'Thông tin liên hệ (contactInfo) phải là chuỗi ký tự' })
  contactInfo?: string;

  @IsOptional()
  @IsString({ message: 'Địa điểm ký (location) phải là chuỗi ký tự' })
  location?: string;

  @IsOptional()
  @IsInt({ message: 'versionNumber phải là số nguyên' })
  @Min(1, { message: 'versionNumber phải lớn hơn hoặc bằng 1' })
  versionNumber?: number;

  @IsOptional()
  @IsBoolean({ message: 'requireTimestamp phải là giá trị boolean' })
  requireTimestamp?: boolean;
}
