import {
  IsString,
  IsNotEmpty,
  MinLength,
  MaxLength,
  IsOptional,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FormFieldDefinition, LayoutBlock, DefaultWorkflowStep } from '@trinh-ky/shared';

export class CreateTemplateDto {
  @IsString({ message: 'Mã biểu mẫu phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Mã biểu mẫu không được để trống' })
  @MinLength(2, { message: 'Mã biểu mẫu tối thiểu 2 ký tự' })
  @MaxLength(50, { message: 'Mã biểu mẫu tối đa 50 ký tự' })
  code!: string;

  @IsString({ message: 'Tiêu đề biểu mẫu phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Tiêu đề biểu mẫu không được để trống' })
  @MinLength(2, { message: 'Tiêu đề biểu mẫu tối thiểu 2 ký tự' })
  @MaxLength(200, { message: 'Tiêu đề biểu mẫu tối đa 200 ký tự' })
  title!: string;

  @IsOptional()
  @IsString({ message: 'Mô tả phải là chuỗi ký tự' })
  @MaxLength(1000, { message: 'Mô tả tối đa 1000 ký tự' })
  description?: string;

  @IsOptional()
  @IsString({ message: 'Danh mục phải là chuỗi ký tự' })
  category?: string;

  @IsArray({ message: 'Danh sách trường (fields) phải là mảng' })
  @IsNotEmpty({ message: 'Biểu mẫu phải chứa ít nhất 1 trường dữ liệu' })
  fields!: FormFieldDefinition[];

  @IsOptional()
  @IsArray({ message: 'Layout blocks phải là mảng' })
  layoutBlocks?: LayoutBlock[];

  @IsOptional()
  @IsArray({ message: 'Các bước duyệt mặc định phải là mảng' })
  defaultWorkflowSteps?: DefaultWorkflowStep[];

  @IsOptional()
  @IsString()
  organizationId?: string | null;
}
