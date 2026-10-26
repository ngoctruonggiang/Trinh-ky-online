import { IsInt, IsOptional, Min } from 'class-validator';

export class AddLtvRequestDto {
  @IsOptional()
  @IsInt({ message: 'versionNumber phải là số nguyên' })
  @Min(1, { message: 'versionNumber phải lớn hơn hoặc bằng 1' })
  versionNumber?: number;
}
