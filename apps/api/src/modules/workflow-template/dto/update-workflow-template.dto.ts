import { IsString, IsOptional, IsArray, MaxLength, MinLength } from 'class-validator';
import { WorkflowStepConfig } from '@trinh-ky/shared';

export class UpdateWorkflowTemplateDto {
  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'Tên quy trình tối thiểu 3 ký tự' })
  @MaxLength(200, { message: 'Tên quy trình tối đa 200 ký tự' })
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsArray({ message: 'Danh sách bước duyệt phải là một mảng' })
  steps?: WorkflowStepConfig[];
}
