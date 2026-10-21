import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DocumentStatus } from '@trinh-ky/shared';

export type DocumentTabMode = 'pending_my_approval' | 'my_documents' | 'all';

export class GetDocumentsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Trang phải là số nguyên dương.' })
  @Min(1, { message: 'Trang tối thiểu là 1.' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số lượng phần tử mỗi trang phải là số nguyên.' })
  @Min(1, { message: 'Số lượng phần tử tối thiểu là 1.' })
  @Max(100, { message: 'Số lượng phần tử tối đa mỗi trang là 100.' })
  limit: number = 10;

  @IsOptional()
  @IsString()
  @IsIn(['pending_my_approval', 'my_documents', 'all'], {
    message: 'Tab hợp lệ: pending_my_approval, my_documents hoặc all.',
  })
  tab: DocumentTabMode = 'all';

  @IsOptional()
  @IsEnum(DocumentStatus, {
    message: 'Trạng thái hồ sơ không hợp lệ.',
  })
  status?: DocumentStatus;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Từ khóa tìm kiếm tối đa 100 ký tự.' })
  search?: string;
}
