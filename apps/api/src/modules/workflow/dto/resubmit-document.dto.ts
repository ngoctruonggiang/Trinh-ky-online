import { IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class ResubmitDocumentDto {
  @IsNotEmpty({ message: 'Dữ liệu biểu mẫu (formData) không được để trống' })
  @IsObject({ message: 'formData phải là một đối tượng JSON hợp lệ' })
  formData: Record<string, any>;

  @IsOptional()
  @IsString({ message: 'Tóm tắt nội dung chỉnh sửa phải là chuỗi văn bản' })
  @MaxLength(500, { message: 'Tóm tắt nội dung chỉnh sửa không được vượt quá 500 ký tự' })
  changeSummary?: string;
}
