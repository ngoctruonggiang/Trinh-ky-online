import { IsNotEmpty, IsString, IsOptional, IsArray, MaxLength, MinLength } from 'class-validator';
import { WorkflowStepConfig } from '@trinh-ky/shared';

export class CreateWorkflowTemplateDto {
  @IsNotEmpty({ message: 'Mã quy trình không được để trống' })
  @IsString()
  @MinLength(2, { message: 'Mã quy trình tối thiểu 2 ký tự' })
  @MaxLength(50, { message: 'Mã quy trình tối đa 50 ký tự' })
  code: string;

  @IsNotEmpty({ message: 'Tên quy trình không được để trống' })
  @IsString()
  @MinLength(3, { message: 'Tên quy trình tối thiểu 3 ký tự' })
  @MaxLength(200, { message: 'Tên quy trình tối đa 200 ký tự' })
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsNotEmpty({ message: 'Danh sách bước duyệt không được để trống' })
  @IsArray({ message: 'Danh sách bước duyệt phải là một mảng' })
  steps: WorkflowStepConfig[];

  @IsOptional()
  @IsString()
  organizationId?: string | null;
}
