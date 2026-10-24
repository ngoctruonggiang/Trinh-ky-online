import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { ArtifactType } from '@trinh-ky/shared';
import { Type } from 'class-transformer';

export class GetArtifactQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'version phải là số nguyên' })
  @Min(1, { message: 'version phải lớn hơn hoặc bằng 1' })
  version?: number;

  @IsOptional()
  @IsEnum(ArtifactType, { message: 'type phải là PREVIEW hoặc OFFICIAL_UNSIGNED' })
  type?: ArtifactType = ArtifactType.OFFICIAL_UNSIGNED;
}
