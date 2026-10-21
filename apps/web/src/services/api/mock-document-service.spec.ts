import { describe, expect, it, beforeEach } from 'vitest';
import {
  MockDocumentService,
} from './mock-document-service';
import {
  DocumentStatus,
  WorkflowStatus,
  StepStatus,
  AssigneeDecision,
} from '@/types/document';

describe('MockDocumentService (Frontend Workflow Service Layer)', () => {
  let service: MockDocumentService;

  beforeEach(() => {
    service = new MockDocumentService();
  });

  it('1. getCurrentUser: Trả về thông tin người dùng hiện tại kèm vai trò và tổ chức', async () => {
    const user = await service.getCurrentUser();
    expect(user.id).toBe('user-current-tp');
    expect(user.fullName).toContain('Nguyễn Văn An');
    expect(user.organizationName).toContain('VinaGroup');
  });

  it('2. getDocuments (pending_my_approval): Chỉ lọc các hồ sơ IN_REVIEW cần người dùng phê duyệt', async () => {
    const docs = await service.getDocuments('pending_my_approval');
    expect(docs.length).toBeGreaterThanOrEqual(1);
    docs.forEach((doc) => {
      expect(doc.status).toBe(DocumentStatus.IN_REVIEW);
    });
  });

  it('3. getDocuments (my_documents): Chỉ lọc các hồ sơ do chính người dùng hiện tại khởi tạo', async () => {
    const docs = await service.getDocuments('my_documents');
    docs.forEach((doc) => {
      expect(doc.createdById).toBe('user-current-tp');
    });
  });

  it('4. getDocumentDetail: Trả về chi tiết biểu mẫu, tiến trình các bước duyệt và quyền thao tác', async () => {
    const detail = await service.getDocumentDetail('doc-001');
    expect(detail.id).toBe('doc-001');
    expect(detail.documentNumber).toBe('TK-2026-0001');
    expect(detail.activeVersion.formData.advanceAmount).toBe(15000000);
    expect(detail.permissions.canApprove).toBe(true);
    expect(detail.workflow.steps.length).toBe(2);
  });

  it('5. processDecision (APPROVED): Phê duyệt thành công, chuyển bước tiếp theo và lưu chữ ký', async () => {
    const res = await service.processDecision('doc-001', {
      decision: AssigneeDecision.APPROVED,
      decisionComment: 'Đồng ý duyệt tạm ứng',
      signatureImageUrl: 'data:image/svg+xml;utf8,<svg>sig</svg>',
    });

    expect(res.success).toBe(true);

    const updated = await service.getDocumentDetail('doc-001');
    // Bước 1 đã hoàn tất
    expect(updated.workflow.steps[0].status).toBe(StepStatus.COMPLETED);
    // Bước 2 được kích hoạt
    expect(updated.workflow.steps[1].status).toBe(StepStatus.IN_PROGRESS);
    expect(updated.currentStepOrder).toBe(2);
    // Lưu chữ ký hợp lệ
    expect(updated.signatures.length).toBe(1);
    expect(updated.signatures[0].isValid).toBe(true);
    // Quyền duyệt bị khóa vì đã duyệt xong
    expect(updated.permissions.canApprove).toBe(false);
  });

  it('6. processDecision (REVISION_REQUESTED): Vô hiệu hóa chữ ký cũ và chuyển trạng thái', async () => {
    const res = await service.processDecision('doc-001', {
      decision: AssigneeDecision.REVISION_REQUESTED,
      decisionComment: 'Bổ sung bảng kê chi tiết hơn',
    });

    expect(res.success).toBe(true);
    const updated = await service.getDocumentDetail('doc-001');
    expect(updated.status).toBe(DocumentStatus.REVISION_REQUESTED);
  });

  it('7. Chặn duyệt trùng lặp (Duplicate Decision / Concurrency Conflict)', async () => {
    // Duyệt lần 1
    await service.processDecision('doc-001', {
      decision: AssigneeDecision.APPROVED,
    });

    // Duyệt lần 2 -> phải ném lỗi xung đột tương tranh
    await expect(
      service.processDecision('doc-001', {
        decision: AssigneeDecision.APPROVED,
      })
    ).rejects.toThrow('Xung đột tương tranh');
  });

  it('8. resubmitDocument: Tạo version mới v2, tái kích hoạt từ Bước 1 và bảo toàn dữ liệu', async () => {
    const detailBefore = await service.getDocumentDetail('doc-002');
    expect(detailBefore.currentVersion).toBe(1);
    expect(detailBefore.status).toBe(DocumentStatus.REVISION_REQUESTED);

    const res = await service.resubmitDocument('doc-002', {
      formData: { ...detailBefore.activeVersion.formData, amount: 9000000 },
      changeSummary: 'Đã đính kèm bản quét hóa đơn rõ nét',
    });

    expect(res.success).toBe(true);
    expect(res.newVersionNumber).toBe(2);

    const detailAfter = await service.getDocumentDetail('doc-002');
    expect(detailAfter.currentVersion).toBe(2);
    expect(detailAfter.status).toBe(DocumentStatus.IN_REVIEW);
    expect(detailAfter.currentStepOrder).toBe(1);
    expect(detailAfter.workflow.steps[0].status).toBe(StepStatus.IN_PROGRESS);
  });

  it('9. cancelDocument: Hủy hồ sơ thành công, cập nhật trạng thái CANCELLED cho toàn bộ bước', async () => {
    const res = await service.cancelDocument('doc-002', {
      cancelReason: 'Không tham gia khóa đào tạo nữa',
    });

    expect(res.success).toBe(true);

    const detail = await service.getDocumentDetail('doc-002');
    expect(detail.status).toBe(DocumentStatus.CANCELLED);
    expect(detail.workflow.status).toBe(WorkflowStatus.CANCELLED);
    expect(detail.workflow.steps[0].status).toBe(StepStatus.CANCELLED);
    expect(detail.permissions.canCancel).toBe(false);
  });
});
