import { z } from 'zod';

export type ApproverType = 'SPECIFIC_USERS' | 'DEPARTMENT_ROLE' | 'ORGANIZATION_ROLE';
export type ApproverRole = 'ADMIN' | 'MANAGER' | 'ACCOUNTANT' | 'DIRECTOR';
export type DepartmentPolicy = 'SAME_AS_DOCUMENT' | 'SPECIFIC_DEPARTMENT';

export const ApproverConfigSchema = z.object({
  type: z.enum(['SPECIFIC_USERS', 'DEPARTMENT_ROLE', 'ORGANIZATION_ROLE']),
  userIds: z.array(z.string()).optional(),
  role: z.enum(['ADMIN', 'MANAGER', 'ACCOUNTANT', 'DIRECTOR']).optional(),
  departmentPolicy: z.enum(['SAME_AS_DOCUMENT', 'SPECIFIC_DEPARTMENT']).optional(),
  departmentId: z.string().optional(),
});

export type ApproverConfig = z.infer<typeof ApproverConfigSchema>;

export const WorkflowStepConfigSchema = z.object({
  id: z.string().optional(),
  stepKey: z
    .string()
    .min(1, 'Mã bước (stepKey) không được để trống')
    .max(50, 'Mã bước tối đa 50 ký tự')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Mã bước chỉ được chứa chữ, số, gạch ngang và gạch dưới'),
  stepName: z.string().min(1, 'Tên bước không được để trống').max(150, 'Tên bước tối đa 150 ký tự'),
  stepOrder: z.number().int().min(1, 'Thứ tự bước phải là số nguyên dương từ 1'),
  stepType: z.enum(['SEQUENTIAL', 'PARALLEL']).default('SEQUENTIAL'),
  completionRule: z.enum(['ALL_MUST_APPROVE', 'ANY_CAN_APPROVE']).default('ALL_MUST_APPROVE'),
  approverConfig: ApproverConfigSchema,
  reviewerUserIds: z.array(z.string()).default([]),
  dueDays: z.number().int().min(1).max(365).optional(),
  description: z.string().max(500).optional(),
});

export type WorkflowStepConfig = z.infer<typeof WorkflowStepConfigSchema>;

export const WorkflowTemplateDefinitionSchema = z.object({
  code: z
    .string()
    .min(2, 'Mã quy trình tối thiểu 2 ký tự')
    .max(50, 'Mã quy trình tối đa 50 ký tự')
    .regex(/^[A-Z0-9_-]+$/, 'Mã quy trình chỉ gồm chữ in hoa, số và gạch dưới'),
  title: z.string().min(3, 'Tên quy trình tối thiểu 3 ký tự').max(200, 'Tên quy trình tối đa 200 ký tự'),
  description: z.string().max(1000).optional().nullable(),
  category: z.string().max(100).default('Chung'),
  organizationId: z.string().optional().nullable(),
  steps: z.array(WorkflowStepConfigSchema).min(1, 'Quy trình phải có ít nhất 1 bước phê duyệt'),
});

export type WorkflowTemplateDefinition = z.infer<typeof WorkflowTemplateDefinitionSchema>;

/**
 * Thẩm định nghiệp vụ toàn diện cho cấu hình quy trình phê duyệt
 */
export function validateWorkflowSchema(definition: unknown): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  const parseResult = WorkflowTemplateDefinitionSchema.safeParse(definition);
  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      errors.push(`${issue.path.join('.')}: ${issue.message}`);
    }
    return { valid: false, errors };
  }

  const { steps } = parseResult.data;

  // 1. Kiểm tra trùng lặp stepKey
  const stepKeySet = new Set<string>();
  for (const step of steps) {
    const normalizedKey = step.stepKey.toLowerCase();
    if (stepKeySet.has(normalizedKey)) {
      errors.push(`Mã bước "${step.stepKey}" bị trùng lặp trong quy trình.`);
    }
    stepKeySet.add(normalizedKey);
  }

  // 2. Kiểm tra tính liên tục của thứ tự bước (1, 2, 3...)
  const sortedSteps = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);
  for (let i = 0; i < sortedSteps.length; i++) {
    const expectedOrder = i + 1;
    if (sortedSteps[i].stepOrder !== expectedOrder) {
      errors.push(
        `Thứ tự bước không hợp lệ hoặc bị ngắt quãng: Bước "${sortedSteps[i].stepName}" có thứ tự ${sortedSteps[i].stepOrder}, kỳ vọng là ${expectedOrder}.`
      );
      break;
    }
  }

  // 3. Kiểm tra cấu hình người duyệt từng bước
  for (const step of steps) {
    const { approverConfig, stepName } = step;

    if (approverConfig.type === 'SPECIFIC_USERS') {
      if (!approverConfig.userIds || approverConfig.userIds.length === 0) {
        errors.push(
          `Bước "${stepName}" chọn hình thức chỉ định người duyệt đích danh nhưng danh sách userIds đang rỗng.`
        );
      } else {
        // Kiểm tra userIds không chứa chuỗi rỗng
        const hasEmptyId = approverConfig.userIds.some((id) => !id || !id.trim());
        if (hasEmptyId) {
          errors.push(`Bước "${stepName}" chứa userId không hợp lệ (chuỗi rỗng).`);
        }
      }
    } else if (approverConfig.type === 'DEPARTMENT_ROLE') {
      if (!approverConfig.role) {
        errors.push(`Bước "${stepName}" theo vai trò phòng ban yêu cầu chọn chức danh duyệt (role).`);
      }
      if (approverConfig.departmentPolicy === 'SPECIFIC_DEPARTMENT' && !approverConfig.departmentId) {
        errors.push(
          `Bước "${stepName}" chọn phòng ban cố định nhưng chưa chỉ định departmentId.`
        );
      }
    } else if (approverConfig.type === 'ORGANIZATION_ROLE') {
      if (!approverConfig.role) {
        errors.push(`Bước "${stepName}" theo vai trò công ty yêu cầu chọn chức danh duyệt (role).`);
      }
    }

    // 4. Kiểm tra người giám sát trùng người duyệt đích danh
    if (
      approverConfig.type === 'SPECIFIC_USERS' &&
      approverConfig.userIds &&
      step.reviewerUserIds &&
      step.reviewerUserIds.length > 0
    ) {
      const approverSet = new Set(approverConfig.userIds);
      for (const revId of step.reviewerUserIds) {
        if (approverSet.has(revId)) {
          errors.push(
            `Bước "${stepName}": Người dùng "${revId}" vừa được gán làm Người duyệt vừa làm Người giám sát.`
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
