import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ReassignApproverDto {
  @IsOptional()
  @IsUUID('all', { message: 'Mã bước duyệt (stepId) phải là UUID hợp lệ' })
  stepId?: string;

  @IsNotEmpty({ message: 'Mã người duyệt cũ (oldUserId) không được để trống' })
  @IsUUID('all', { message: 'Mã người duyệt cũ phải là UUID hợp lệ' })
  oldUserId: string;

  @IsNotEmpty({ message: 'Mã người duyệt mới (newUserId) không được để trống' })
  @IsUUID('all', { message: 'Mã người duyệt mới phải là UUID hợp lệ' })
  newUserId: string;

  @IsNotEmpty({ message: 'Lý do chuyển giao người duyệt không được để trống' })
  @IsString({ message: 'Lý do chuyển giao phải là chuỗi văn bản' })
  @MaxLength(1000, { message: 'Lý do chuyển giao không được vượt quá 1000 ký tự' })
  reason: string;
}
