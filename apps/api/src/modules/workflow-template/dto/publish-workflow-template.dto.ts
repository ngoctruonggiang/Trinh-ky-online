import { IsString, IsOptional, MaxLength } from 'class-validator';

export class PublishWorkflowTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Ghi chú phiên bản tối đa 500 ký tự' })
  changeSummary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Ghi chú phát hành tối đa 500 ký tự' })
  releaseNotes?: string;
}
