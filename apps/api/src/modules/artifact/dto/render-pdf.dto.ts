import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { ArtifactType } from '@trinh-ky/shared';
import { Type } from 'class-transformer';

export class RenderPdfDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'versionNumber phải là số nguyên dương' })
  @Min(1, { message: 'versionNumber phải lớn hơn hoặc bằng 1' })
  versionNumber?: number;

  @IsOptional()
  @IsEnum(ArtifactType, { message: 'artifactType phải là PREVIEW hoặc OFFICIAL_UNSIGNED' })
  artifactType?: ArtifactType = ArtifactType.OFFICIAL_UNSIGNED;
}
