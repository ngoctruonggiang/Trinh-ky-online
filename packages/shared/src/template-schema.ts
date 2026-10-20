import { z } from 'zod';

/**
 * Các loại trường dữ liệu người dùng nhập liệu (Input Fields)
 */
export const FormFieldTypeSchema = z.enum([
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'CURRENCY_VND',
  'DATE',
  'DATETIME',
  'SELECT',
  'RADIO',
  'CHECKBOX',
  'USER_SELECT',
  'DEPARTMENT_SELECT',
  'TABLE', // Bảng nhiều dòng (Line items / Expense items)
]);
export type FormFieldType = z.infer<typeof FormFieldTypeSchema>;

/**
 * Cấu hình cột trong bảng nhiều dòng
 */
export const TableColumnSchema = z.object({
  id: z.string(),
  name: z.string(), // key trong object dòng
  label: z.string(), // Tiêu đề cột
  type: z.enum(['TEXT', 'NUMBER', 'CURRENCY_VND', 'DATE', 'SELECT']),
  options: z.array(z.string()).optional(),
  required: z.boolean().default(false),
  width: z.string().optional(), // '20%', '150px'
});
export type TableColumn = z.infer<typeof TableColumnSchema>;

/**
 * Định nghĩa một trường dữ liệu (Field)
 */
export const FormFieldDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(), // key dữ liệu (ví dụ: 'so_tien', 'ly_do')
  label: z.string(), // Nhãn hiển thị cho người dùng
  type: FormFieldTypeSchema,
  placeholder: z.string().optional(),
  defaultValue: z.any().optional(),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(), // Cho SELECT, RADIO, CHECKBOX
  columns: z.array(TableColumnSchema).optional(), // Cho TABLE
  helpText: z.string().optional(),
  validation: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
      regex: z.string().optional(),
    })
    .optional(),
});
export type FormFieldDefinition = z.infer<typeof FormFieldDefinitionSchema>;

/**
 * Các loại Khối (Block Types) trong trình soạn thảo Bố cục Tài liệu / PDF (TopCV style)
 */
export const LayoutBlockTypeSchema = z.enum([
  'HEADER_BLOCK',       // Tiêu đề văn bản, tên công ty, số hiệu
  'PARAGRAPH_BLOCK',    // Đoạn văn có thể chèn biến động {{ten_truong}}
  'KEY_VALUE_GRID',     // Lưới thông tin nhãn - giá trị (ví dụ: Người đề nghị, Phòng ban, Ngày tạo)
  'DYNAMIC_TABLE',      // Bảng dữ liệu lấy từ field dạng TABLE
  'SIGNATURE_BOX_GRID', // Khối chứa các ô chữ ký theo bước duyệt
  'PAGE_BREAK',         // Ngắt trang khi in PDF
  'DIVIDER',            // Đường kẻ ngang phân cách
]);
export type LayoutBlockType = z.infer<typeof LayoutBlockTypeSchema>;

/**
 * Cấu hình một khối bố cục (Block)
 */
export const LayoutBlockSchema = z.object({
  id: z.string(),
  type: LayoutBlockTypeSchema,
  title: z.string().optional(),
  order: z.number(),
  settings: z.record(z.any()).default({}),
  // Ví dụ settings:
  // - KEY_VALUE_GRID: { fieldIds: ['nguoi_de_nghi', 'phong_ban', 'so_tien'], columns: 2 }
  // - DYNAMIC_TABLE: { tableFieldId: 'danh_sach_chi_phi', showTotalRow: true }
  // - SIGNATURE_BOX_GRID: { stepOrders: [1, 2, 3], columns: 3 }
});
export type LayoutBlock = z.infer<typeof LayoutBlockSchema>;

/**
 * Định nghĩa hoàn chỉnh của Biểu mẫu (FormTemplate Schema)
 */
export const FormTemplateSchema = z.object({
  id: z.string().optional(),
  code: z.string().min(2), // Ví dụ: 'TAM_UNG', 'NGHI_PHEP', 'THANH_TOAN'
  title: z.string().min(2),
  description: z.string().optional(),
  category: z.string().default('Hành chính - Nhân sự'),
  fields: z.array(FormFieldDefinitionSchema),
  layoutBlocks: z.array(LayoutBlockSchema),
  defaultWorkflowSteps: z.array(
    z.object({
      stepOrder: z.number(),
      stepName: z.string(),
      stepType: z.enum(['SEQUENTIAL', 'PARALLEL']).default('SEQUENTIAL'),
      completionRule: z
        .enum(['ALL_MUST_APPROVE', 'ANY_CAN_APPROVE'])
        .default('ALL_MUST_APPROVE'),
      assigneeRoleIds: z.array(z.string()).optional(),
    })
  ),
});
export type FormTemplate = z.infer<typeof FormTemplateSchema>;
