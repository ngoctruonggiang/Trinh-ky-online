import { IsObject, IsNotEmpty } from 'class-validator';

export class ValidateFormDataDto {
  @IsObject({ message: 'Dữ liệu biểu mẫu (formData) phải là một JSON Object' })
  @IsNotEmpty({ message: 'Dữ liệu biểu mẫu không được để trống' })
  formData!: Record<string, any>;
}
