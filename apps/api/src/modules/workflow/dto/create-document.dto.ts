import {
  IsString,
  IsNotEmpty,
  MinLength,
  MaxLength,
  IsOptional,
  IsEnum,
  IsObject,
  IsDateString,
} from 'class-validator';
import { UrgencyLevel } from '@trinh-ky/shared';

export class CreateDocumentDto {
  @IsString({ message: 'Mã mẫu biểu (templateId) phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Vui lòng chọn mẫu biểu mẫu (templateId)' })
  templateId!: string;

  @IsString({ message: 'Tiêu đề hồ sơ phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Tiêu đề hồ sơ không được để trống' })
  @MinLength(3, { message: 'Tiêu đề hồ sơ tối thiểu 3 ký tự' })
  @MaxLength(255, { message: 'Tiêu đề hồ sơ tối đa 255 ký tự' })
  title!: string;

  @IsOptional()
  @IsEnum(UrgencyLevel, { message: 'Mức độ khẩn cấp không hợp lệ' })
  urgency?: UrgencyLevel = UrgencyLevel.NORMAL;

  @IsOptional()
  @IsDateString({}, { message: 'Hạn xử lý (dueDate) phải là định dạng ngày hợp lệ' })
  dueDate?: string;

  @IsObject({ message: 'Dữ liệu biểu mẫu (formData) phải là JSON Object' })
  @IsNotEmpty({ message: 'Dữ liệu biểu mẫu không được để trống' })
  formData!: Record<string, any>;

  @IsOptional()
  @IsString()
  workflowTemplateId?: string;

  @IsOptional()
  @IsString()
  workflowTemplateVersionId?: string;
}
