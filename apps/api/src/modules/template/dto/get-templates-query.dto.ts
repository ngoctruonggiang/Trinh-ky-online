import { IsOptional, IsString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class GetTemplatesQueryDto {
  @IsOptional()
  @IsIn(['DRAFT', 'PUBLISHED', 'ARCHIVED', 'ALL'], {
    message: 'Trạng thái template phải là DRAFT, PUBLISHED, ARCHIVED hoặc ALL',
  })
  status?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;
}
