import { z } from 'zod';
import { TemplateStatus } from './enums.js';

/**
 * Các loại trường dữ liệu người dùng nhập liệu (Input Field Types)
 * Hỗ trợ cả định dạng chữ thường chuẩn và chữ hoa tương thích ngược.
 */
export const FormFieldTypeSchema = z.enum([
  // Chuẩn chữ thường (Phase 10 standard)
  'text',
  'textarea',
  'number',
  'date',
  'select',
  'radio',
  'checkbox',
  'email',
  'currency_vnd',
  'table',

  // Tương thích ngược (Legacy uppercase)
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'DATE',
  'SELECT',
  'RADIO',
  'CHECKBOX',
  'EMAIL',
  'CURRENCY_VND',
  'TABLE',
  'DATETIME',
  'USER_SELECT',
  'DEPARTMENT_SELECT',
]);
export type FormFieldType = z.infer<typeof FormFieldTypeSchema>;

/**
 * Cấu hình tùy chọn cho trường lựa chọn (SELECT, RADIO, CHECKBOX)
 */
export const FormFieldOptionSchema = z.union([
  z.object({
    label: z.string().min(1, 'Nhãn tùy chọn không được để trống'),
    value: z.string().min(1, 'Giá trị tùy chọn không được để trống'),
  }),
  z.string().min(1, 'Giá trị tùy chọn không được để trống'),
]);
export type FormFieldOption = z.infer<typeof FormFieldOptionSchema>;

/**
 * Cấu hình quy tắc kiểm tra hợp lệ của trường dữ liệu
 */
export const FormFieldValidationSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  pattern: z.string().optional(),
  regex: z.string().optional(), // tương thích ngược
});
export type FormFieldValidation = z.infer<typeof FormFieldValidationSchema>;

/**
 * Cấu hình cột trong bảng nhiều dòng (Table Field)
 */
export const TableColumnSchema = z.object({
  id: z.string().optional(),
  key: z.string().optional(),
  name: z.string().optional(), // fallback key
  label: z.string(),
  type: z.enum(['text', 'number', 'currency_vnd', 'date', 'select', 'TEXT', 'NUMBER', 'CURRENCY_VND', 'DATE', 'SELECT']),
  options: z.array(FormFieldOptionSchema).optional(),
  required: z.boolean().default(false),
  width: z.string().optional(),
});
export type TableColumn = z.infer<typeof TableColumnSchema>;

/**
 * Định nghĩa một trường dữ liệu (Field Definition)
 */
export const FormFieldDefinitionSchema = z.object({
  id: z.string().default(() => Math.random().toString(36).substring(2, 9)),
  key: z.string().min(1, 'Key không được để trống'),
  name: z.string().optional(), // Alias cho key
  label: z.string().min(1, 'Nhãn trường không được để trống'),
  type: FormFieldTypeSchema,
  placeholder: z.string().optional(),
  defaultValue: z.any().optional(),
  required: z.boolean().default(false),
  helpText: z.string().optional(),
  order: z.number().default(0),
  options: z.array(FormFieldOptionSchema).optional(),
  columns: z.array(TableColumnSchema).optional(),
  validation: FormFieldValidationSchema.optional(),
});
export type FormFieldDefinition = z.infer<typeof FormFieldDefinitionSchema>;

/**
 * Các loại Khối bố cục văn bản (Layout Block Types)
 */
export const LayoutBlockTypeSchema = z.enum([
  'HEADER_BLOCK',
  'PARAGRAPH_BLOCK',
  'KEY_VALUE_GRID',
  'DYNAMIC_TABLE',
  'SIGNATURE_BOX_GRID',
  'PAGE_BREAK',
  'DIVIDER',
]);
export type LayoutBlockType = z.infer<typeof LayoutBlockTypeSchema>;

export const LayoutBlockSchema = z.object({
  id: z.string(),
  type: LayoutBlockTypeSchema,
  title: z.string().optional(),
  order: z.number(),
  settings: z.record(z.any()).default({}),
});
export type LayoutBlock = z.infer<typeof LayoutBlockSchema>;

/**
 * Vòng đời mẫu biểu mẫu (Template Lifecycle Status)
 */
export const TemplateStatusSchema = z.nativeEnum(TemplateStatus);


/**
 * Cấu hình bước duyệt mặc định của template
 */
export const DefaultWorkflowStepSchema = z.object({
  stepOrder: z.number(),
  stepName: z.string().min(1, 'Tên bước duyệt không được để trống'),
  stepType: z.enum(['SEQUENTIAL', 'PARALLEL']).default('SEQUENTIAL'),
  completionRule: z.enum(['ALL_MUST_APPROVE', 'ANY_CAN_APPROVE']).default('ALL_MUST_APPROVE'),
  assigneeRoleIds: z.array(z.string()).optional(),
  defaultUserIds: z.array(z.string()).optional(),
});
export type DefaultWorkflowStep = z.infer<typeof DefaultWorkflowStepSchema>;

/**
 * Schema đầy đủ của FormTemplate
 */
export const FormTemplateSchema = z.object({
  id: z.string().optional(),
  organizationId: z.string().nullable().optional(),
  code: z.string().min(2, 'Mã biểu mẫu tối thiểu 2 ký tự').max(50),
  title: z.string().min(2, 'Tiêu đề biểu mẫu tối thiểu 2 ký tự').max(200),
  description: z.string().nullable().optional(),
  category: z.string().default('Hành chính - Nhân sự'),
  status: TemplateStatusSchema.default(TemplateStatus.DRAFT),
  currentVersion: z.number().default(1),
  fields: z.array(FormFieldDefinitionSchema).min(1, 'Biểu mẫu phải có ít nhất 1 trường dữ liệu'),
  layoutBlocks: z.array(LayoutBlockSchema).default([]),
  defaultWorkflowSteps: z.array(DefaultWorkflowStepSchema).default([]),
  createdById: z.string().optional(),
  createdAt: z.date().or(z.string()).optional(),
  updatedAt: z.date().or(z.string()).optional(),
});
export type FormTemplate = z.infer<typeof FormTemplateSchema>;

// -------------------------------------------------------------
// HÀM TIỆN ÍCH & XÁC THỰC NGHIỆP VỤ (HELPER & VALIDATORS)
// -------------------------------------------------------------

/**
 * Chuẩn hóa danh sách options thành mảng { label, value }
 */
export function normalizeFieldOptions(
  options?: Array<FormFieldOption>
): Array<{ label: string; value: string }> {
  if (!options || !Array.isArray(options)) return [];
  return options.map((opt) => {
    if (typeof opt === 'string') {
      return { label: opt, value: opt };
    }
    return {
      label: opt.label || opt.value,
      value: opt.value,
    };
  });
}

/**
 * Chuẩn hóa định dạng key (ví dụ: 'ho_va_ten', 'so_tien')
 */
export function normalizeFieldKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Xác thực tính hợp lệ của schema biểu mẫu trước khi lưu hoặc phát hành:
 * - Chặn key trùng
 * - Chặn key chứa ký tự nguy hiểm / script
 * - Chặn options rỗng với select / radio
 * - Đảm bảo thứ tự order hợp lệ
 */
export function validateTemplateSchema(template: Partial<FormTemplate>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!template.title || template.title.trim().length < 2) {
    errors.push('Tiêu đề biểu mẫu phải có ít nhất 2 ký tự.');
  }

  if (!template.code || !/^[A-Z0-9_-]{2,50}$/i.test(template.code.trim())) {
    errors.push('Mã biểu mẫu chỉ được chứa chữ cái, số, dấu gạch dưới hoặc gạch ngang (2-50 ký tự).');
  }

  const fields = template.fields;
  if (!fields || !Array.isArray(fields) || fields.length === 0) {
    errors.push('Biểu mẫu phải chứa ít nhất 1 trường dữ liệu.');
    return { valid: false, errors };
  }

  const seenKeys = new Set<string>();

  fields.forEach((field, index) => {
    const rawKey = field.key || field.name;
    if (!rawKey || typeof rawKey !== 'string' || !rawKey.trim()) {
      errors.push(`Trường thứ ${index + 1} chưa có định danh (key).`);
      return;
    }

    const key = rawKey.trim();

    // Chặn key có ký tự nguy hiểm hoặc vi phạm cú pháp
    if (!/^[a-zA-Z0-9_]{1,64}$/.test(key)) {
      errors.push(`Key "${key}" không hợp lệ. Chỉ được chứa chữ cái, số và dấu gạch dưới (tối đa 64 ký tự).`);
    }

    // Chặn key trùng
    const lowerKey = key.toLowerCase();
    if (seenKeys.has(lowerKey)) {
      errors.push(`Phát hiện key trùng lặp trong biểu mẫu: "${key}".`);
    } else {
      seenKeys.add(lowerKey);
    }

    if (!field.label || typeof field.label !== 'string' || !field.label.trim()) {
      errors.push(`Trường "${key}" chưa có nhãn hiển thị (label).`);
    }

    // Kiểm tra type hợp lệ
    const normalizedType = field.type.toLowerCase();
    const validTypes = [
      'text',
      'textarea',
      'number',
      'date',
      'select',
      'radio',
      'checkbox',
      'email',
      'currency_vnd',
      'table',
      'datetime',
      'user_select',
      'department_select',
    ];

    if (!validTypes.includes(normalizedType)) {
      errors.push(`Kiểu dữ liệu "${field.type}" của trường "${key}" không được hỗ trợ.`);
    }

    // Trường SELECT hoặc RADIO bắt buộc phải có ít nhất 1 option hợp lệ
    if (['select', 'radio'].includes(normalizedType)) {
      const options = normalizeFieldOptions(field.options);
      if (options.length === 0) {
        errors.push(`Trường dạng lựa chọn "${key}" (${field.type}) phải có ít nhất một tùy chọn (options).`);
      }
    }

    // Kiểm tra tính hợp lệ của regex validation (tránh ReDoS hoặc biểu thức độc hại)
    const regexPattern = field.validation?.pattern || field.validation?.regex;
    if (regexPattern) {
      try {
        new RegExp(regexPattern);
      } catch {
        errors.push(`Biểu thức chính quy (pattern) của trường "${key}" không hợp lệ.`);
      }
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Xác thực dữ liệu người dùng nhập (formData) dựa trên danh sách fields của template:
 * - Kiểm tra các trường bắt buộc (required)
 * - Kiểm tra kiểu dữ liệu (number, email, date)
 * - Kiểm tra giới hạn min, max, minLength, maxLength
 * - Kiểm tra giá trị lựa chọn phải nằm trong options (whitelist)
 */
export function validateFormData(
  fields: FormFieldDefinition[],
  formData: Record<string, any>
): {
  valid: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const safeData = formData || {};

  for (const field of fields) {
    const key = (field.key || field.name || '').trim();
    if (!key) continue;

    const value = safeData[key];
    const isMissing =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim() === '') ||
      (Array.isArray(value) && value.length === 0);

    // 1. Kiểm tra trường bắt buộc
    if (field.required && isMissing) {
      errors[key] = `Vui lòng nhập/chọn "${field.label}".`;
      continue;
    }

    // Nếu không bắt buộc và để trống thì bỏ qua các bước kiểm tra định dạng sau
    if (isMissing) continue;

    const normalizedType = field.type.toLowerCase();

    // 2. Kiểm tra theo kiểu dữ liệu
    switch (normalizedType) {
      case 'number':
      case 'currency_vnd': {
        const num = Number(value);
        if (isNaN(num)) {
          errors[key] = `"${field.label}" phải là một chữ số hợp lệ.`;
          break;
        }
        if (field.validation?.min !== undefined && num < field.validation.min) {
          errors[key] = `"${field.label}" không được nhỏ hơn ${field.validation.min.toLocaleString('vi-VN')}.`;
          break;
        }
        if (field.validation?.max !== undefined && num > field.validation.max) {
          errors[key] = `"${field.label}" không được lớn hơn ${field.validation.max.toLocaleString('vi-VN')}.`;
          break;
        }
        break;
      }

      case 'email': {
        const emailStr = String(value).trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(emailStr)) {
          errors[key] = `"${field.label}" không đúng định dạng email (ví dụ: name@company.com).`;
        }
        break;
      }

      case 'date': {
        const dateVal = new Date(value);
        if (isNaN(dateVal.getTime())) {
          errors[key] = `"${field.label}" không đúng định dạng ngày tháng hợp lệ.`;
        }
        break;
      }

      case 'select':
      case 'radio': {
        const options = normalizeFieldOptions(field.options);
        const validValues = options.map((opt) => opt.value);
        if (validValues.length > 0 && !validValues.includes(String(value))) {
          errors[key] = `Giá trị "${value}" không nằm trong danh sách lựa chọn hợp lệ của "${field.label}".`;
        }
        break;
      }

      case 'checkbox': {
        // Checkbox có thể là boolean (true/false) hoặc mảng các giá trị được chọn
        if (Array.isArray(value)) {
          const options = normalizeFieldOptions(field.options);
          const validValues = options.map((opt) => opt.value);
          const hasInvalid = value.some((v) => !validValues.includes(String(v)));
          if (hasInvalid) {
            errors[key] = `Một số giá trị chọn trong "${field.label}" không hợp lệ.`;
          }
        }
        break;
      }

      case 'text':
      case 'textarea': {
        const strVal = String(value);
        if (field.validation?.minLength !== undefined && strVal.length < field.validation.minLength) {
          errors[key] = `"${field.label}" phải có độ dài tối thiểu ${field.validation.minLength} ký tự.`;
          break;
        }
        if (field.validation?.maxLength !== undefined && strVal.length > field.validation.maxLength) {
          errors[key] = `"${field.label}" không được vượt quá ${field.validation.maxLength} ký tự.`;
          break;
        }
        const pattern = field.validation?.pattern || field.validation?.regex;
        if (pattern) {
          try {
            const regex = new RegExp(pattern);
            if (!regex.test(strVal)) {
              errors[key] = `"${field.label}" không khớp với định dạng yêu cầu.`;
            }
          } catch {
            // Pattern lỗi đã được chặn ở validateTemplateSchema
          }
        }
        break;
      }

      case 'table': {
        if (!Array.isArray(value)) {
          errors[key] = `"${field.label}" phải là một danh sách bảng.`;
        }
        break;
      }

      default:
        break;
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}
