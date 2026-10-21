import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelDocumentDto {
  @IsOptional()
  @IsString({ message: 'Lý do hủy hồ sơ phải là chuỗi văn bản' })
  @MaxLength(500, { message: 'Lý do hủy hồ sơ không được vượt quá 500 ký tự' })
  cancelReason?: string;
}
