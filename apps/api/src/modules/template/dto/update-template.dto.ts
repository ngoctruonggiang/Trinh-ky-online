import {
  IsString,
  IsOptional,
  MinLength,
  MaxLength,
  IsArray,
} from 'class-validator';
import { FormFieldDefinition, LayoutBlock, DefaultWorkflowStep } from '@trinh-ky/shared';

export class UpdateTemplateDto {
  @IsOptional()
  @IsString({ message: 'Tiêu đề biểu mẫu phải là chuỗi ký tự' })
  @MinLength(2, { message: 'Tiêu đề biểu mẫu tối thiểu 2 ký tự' })
  @MaxLength(200, { message: 'Tiêu đề biểu mẫu tối đa 200 ký tự' })
  title?: string;

  @IsOptional()
  @IsString({ message: 'Mô tả phải là chuỗi ký tự' })
  @MaxLength(1000, { message: 'Mô tả tối đa 1000 ký tự' })
  description?: string;

  @IsOptional()
  @IsString({ message: 'Danh mục phải là chuỗi ký tự' })
  category?: string;

  @IsOptional()
  @IsArray({ message: 'Danh sách trường (fields) phải là mảng' })
  fields?: FormFieldDefinition[];

  @IsOptional()
  @IsArray({ message: 'Layout blocks phải là mảng' })
  layoutBlocks?: LayoutBlock[];

  @IsOptional()
  @IsArray({ message: 'Các bước duyệt mặc định phải là mảng' })
  defaultWorkflowSteps?: DefaultWorkflowStep[];
}
