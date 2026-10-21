import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { AssigneeDecision } from '@trinh-ky/shared';

export class ProcessDecisionDto {
  @IsEnum(AssigneeDecision, {
    message: 'Quyết định phải là một trong các giá trị: APPROVED, REJECTED, REVISION_REQUESTED',
  })
  decision: AssigneeDecision;

  @IsOptional()
  @IsString({ message: 'Ý kiến phê duyệt phải là chuỗi văn bản' })
  @MaxLength(1000, { message: 'Ý kiến phê duyệt không được vượt quá 1000 ký tự' })
  decisionComment?: string;

  @IsOptional()
  @IsString({ message: 'Đường dẫn chữ ký phải là chuỗi văn bản' })
  @MaxLength(2000, { message: 'Đường dẫn chữ ký không được vượt quá 2000 ký tự' })
  signatureImageUrl?: string;
}
