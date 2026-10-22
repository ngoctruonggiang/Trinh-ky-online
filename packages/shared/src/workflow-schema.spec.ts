import { describe, expect, it } from 'vitest';
import { validateWorkflowSchema, WorkflowTemplateDefinition } from './workflow-schema.js';

describe('Workflow Template Schema Validation Tests', () => {
  const validWorkflow: WorkflowTemplateDefinition = {
    code: 'WF_EXPENSE_CLAIM',
    title: 'Quy trình duyệt thanh toán công tác phí',
    description: 'Áp dụng cho mọi chi phí công tác dưới 50 triệu',
    category: 'Tài chính - Kế toán',
    organizationId: 'org-01',
    steps: [
      {
        stepKey: 'LINE_MANAGER',
        stepName: 'Quản lý trực tiếp phê duyệt',
        stepOrder: 1,
        stepType: 'SEQUENTIAL',
        completionRule: 'ALL_MUST_APPROVE',
        approverConfig: {
          type: 'DEPARTMENT_ROLE',
          role: 'ADMIN',
          departmentPolicy: 'SAME_AS_DOCUMENT',
        },
        reviewerUserIds: [],
        dueDays: 2,
      },
      {
        stepKey: 'ACCOUNTANT_CHECK',
        stepName: 'Kế toán viên kiểm tra hóa đơn',
        stepOrder: 2,
        stepType: 'PARALLEL',
        completionRule: 'ANY_CAN_APPROVE',
        approverConfig: {
          type: 'SPECIFIC_USERS',
          userIds: ['user-acct-01', 'user-acct-02'],
        },
        reviewerUserIds: ['user-audit-01'],
        dueDays: 3,
      },
      {
        stepKey: 'CFO_FINAL',
        stepName: 'Giám đốc tài chính duyệt chi',
        stepOrder: 3,
        stepType: 'SEQUENTIAL',
        completionRule: 'ALL_MUST_APPROVE',
        approverConfig: {
          type: 'ORGANIZATION_ROLE',
          role: 'DIRECTOR',
        },
        reviewerUserIds: [],
        dueDays: 1,
      },
    ],
  };

  it('1. Chấp nhận cấu hình quy trình đầy đủ, hợp lệ', () => {
    const res = validateWorkflowSchema(validWorkflow);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('2. Từ chối quy trình không có bước nào (rỗng)', () => {
    const res = validateWorkflowSchema({
      ...validWorkflow,
      steps: [],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('ít nhất 1 bước'))).toBe(true);
  });

  it('3. Từ chối khi có mã bước (stepKey) trùng lặp', () => {
    const res = validateWorkflowSchema({
      ...validWorkflow,
      steps: [
        {
          stepKey: 'STEP_DUPLICATE',
          stepName: 'Bước 1',
          stepOrder: 1,
          stepType: 'SEQUENTIAL',
          completionRule: 'ALL_MUST_APPROVE',
          approverConfig: { type: 'SPECIFIC_USERS', userIds: ['u1'] },
          reviewerUserIds: [],
        },
        {
          stepKey: 'step_duplicate', // Case-insensitive duplicate
          stepName: 'Bước 2',
          stepOrder: 2,
          stepType: 'SEQUENTIAL',
          completionRule: 'ALL_MUST_APPROVE',
          approverConfig: { type: 'SPECIFIC_USERS', userIds: ['u2'] },
          reviewerUserIds: [],
        },
      ],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('trùng lặp'))).toBe(true);
  });

  it('4. Từ chối khi thứ tự bước (stepOrder) bị ngắt quãng hoặc không bắt đầu từ 1', () => {
    const res = validateWorkflowSchema({
      ...validWorkflow,
      steps: [
        {
          stepKey: 'STEP_1',
          stepName: 'Bước 1',
          stepOrder: 1,
          stepType: 'SEQUENTIAL',
          completionRule: 'ALL_MUST_APPROVE',
          approverConfig: { type: 'SPECIFIC_USERS', userIds: ['u1'] },
          reviewerUserIds: [],
        },
        {
          stepKey: 'STEP_2',
          stepName: 'Bước 2',
          stepOrder: 3, // Nhảy cóc qua 2
          stepType: 'SEQUENTIAL',
          completionRule: 'ALL_MUST_APPROVE',
          approverConfig: { type: 'SPECIFIC_USERS', userIds: ['u2'] },
          reviewerUserIds: [],
        },
      ],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('ngắt quãng'))).toBe(true);
  });

  it('5. Từ chối khi SPECIFIC_USERS nhưng danh sách userIds rỗng hoặc chứa chuỗi rỗng', () => {
    const res1 = validateWorkflowSchema({
      ...validWorkflow,
      steps: [
        {
          stepKey: 'STEP_1',
          stepName: 'Bước 1',
          stepOrder: 1,
          stepType: 'SEQUENTIAL',
          completionRule: 'ALL_MUST_APPROVE',
          approverConfig: { type: 'SPECIFIC_USERS', userIds: [] },
          reviewerUserIds: [],
        },
      ],
    });
    expect(res1.valid).toBe(false);
    expect(res1.errors.some((e) => e.includes('danh sách userIds đang rỗng'))).toBe(true);

    const res2 = validateWorkflowSchema({
      ...validWorkflow,
      steps: [
        {
          stepKey: 'STEP_1',
          stepName: 'Bước 1',
          stepOrder: 1,
          stepType: 'SEQUENTIAL',
          completionRule: 'ALL_MUST_APPROVE',
          approverConfig: { type: 'SPECIFIC_USERS', userIds: ['   '] },
          reviewerUserIds: [],
        },
      ],
    });
    expect(res2.valid).toBe(false);
    expect(res2.errors.some((e) => e.includes('không hợp lệ'))).toBe(true);
  });

  it('6. Từ chối khi DEPARTMENT_ROLE thiếu role hoặc thiếu departmentId khi chọn SPECIFIC_DEPARTMENT', () => {
    const res = validateWorkflowSchema({
      ...validWorkflow,
      steps: [
        {
          stepKey: 'STEP_1',
          stepName: 'Bước 1',
          stepOrder: 1,
          stepType: 'SEQUENTIAL',
          completionRule: 'ALL_MUST_APPROVE',
          approverConfig: {
            type: 'DEPARTMENT_ROLE',
            role: 'MANAGER',
            departmentPolicy: 'SPECIFIC_DEPARTMENT',
            // thiếu departmentId
          },
          reviewerUserIds: [],
        },
      ],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('chưa chỉ định departmentId'))).toBe(true);
  });

  it('7. Từ chối khi cùng một người dùng vừa làm Người duyệt vừa làm Người giám sát', () => {
    const res = validateWorkflowSchema({
      ...validWorkflow,
      steps: [
        {
          stepKey: 'STEP_1',
          stepName: 'Bước 1',
          stepOrder: 1,
          stepType: 'SEQUENTIAL',
          completionRule: 'ALL_MUST_APPROVE',
          approverConfig: {
            type: 'SPECIFIC_USERS',
            userIds: ['user-01', 'user-02'],
          },
          reviewerUserIds: ['user-01'], // Trùng với approver
        },
      ],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('vừa được gán làm Người duyệt vừa làm Người giám sát'))).toBe(true);
  });

  it('8. Từ chối mã quy trình không đúng định dạng (chữ thường hoặc ký tự đặc biệt)', () => {
    const res = validateWorkflowSchema({
      ...validWorkflow,
      code: 'wf-lowercase-invalid',
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('chữ in hoa'))).toBe(true);
  });
});
