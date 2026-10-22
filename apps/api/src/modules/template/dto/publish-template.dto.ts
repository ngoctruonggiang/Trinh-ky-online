import { IsString, IsOptional, MaxLength } from 'class-validator';

export class PublishTemplateDto {
  @IsOptional()
  @IsString({ message: 'Tóm tắt thay đổi phải là chuỗi ký tự' })
  @MaxLength(500, { message: 'Tóm tắt thay đổi tối đa 500 ký tự' })
  changeSummary?: string;
}
