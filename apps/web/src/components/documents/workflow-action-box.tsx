'use client';

import React, { useState } from 'react';
import {
  CheckCircle,
  XCircle,
  RotateCcw,
  Ban,
  AlertTriangle,
  FileCheck2,
  RefreshCw,
  UserCheck,
  ShieldAlert,
} from 'lucide-react';
import {
  DocumentDetail,
  AssigneeDecision,
  ProcessDecisionPayload,
  ResubmitPayload,
  CancelPayload,
} from '@/types/document';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

interface WorkflowActionBoxProps {
  document: DocumentDetail;
  onDecision: (payload: ProcessDecisionPayload) => Promise<void>;
  onResubmit: (payload: ResubmitPayload) => Promise<void>;
  onCancel: (payload: CancelPayload) => Promise<void>;
  onReassign?: (payload: { stepId?: string; oldUserId: string; newUserId: string; reason: string }) => Promise<void>;
  onReload: () => void;
  isLoading: boolean;
  errorMessage?: string | null;
  isConflictError?: boolean;
}

export function WorkflowActionBox({
  document,
  onDecision,
  onResubmit,
  onCancel,
  onReassign,
  onReload,
  isLoading,
  errorMessage,
  isConflictError,
}: WorkflowActionBoxProps) {
  const { permissions } = document;

  const currentStep = document.workflow?.steps?.find(
    (s) => s.stepOrder === document.currentStepOrder
  );
  const pendingAssignees =
    currentStep?.assignees?.filter(
      (a) => a.decision === AssigneeDecision.PENDING
    ) || [];

  // Modals state
  const [modalType, setModalType] = useState<
    'approve' | 'reject' | 'revision' | 'resubmit' | 'cancel' | 'reassign' | null
  >(null);
  const [comment, setComment] = useState('');
  const [changeSummary, setChangeSummary] = useState('');
  const [reassignOldUserId, setReassignOldUserId] = useState('');
  const [reassignNewUserId, setReassignNewUserId] = useState('');
  const [reassignReason, setReassignReason] = useState('');
  const [validationError, setValidationError] = useState('');

  const handleOpenModal = (type: typeof modalType) => {
    setModalType(type);
    setComment('');
    setChangeSummary('');
    setValidationError('');
    if (type === 'reassign') {
      setReassignOldUserId(pendingAssignees[0]?.userId || '');
      setReassignNewUserId('');
      setReassignReason('');
    }
  };

  const handleCloseModal = () => {
    if (isLoading) return;
    setModalType(null);
  };

  const handleConfirmDecision = async (decision: AssigneeDecision) => {
    if ((decision === AssigneeDecision.REJECTED || decision === AssigneeDecision.REVISION_REQUESTED) && !comment.trim()) {
      setValidationError('Vui lòng nhập lý do/ghi chú cụ thể.');
      return;
    }

    try {
      await onDecision({
        decision,
        decisionComment: comment.trim() || undefined,
        signatureImageUrl:
          decision === AssigneeDecision.APPROVED
            ? 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><text x="20" y="50" font-family="cursive" font-size="28" fill="%231e3a8a">An.NV</text></svg>'
            : undefined,
      });
      setModalType(null);
    } catch {
      // Error handled by parent
    }
  };

  const handleConfirmResubmit = async () => {
    try {
      // Tạo bản sao formData và áp dụng ghi chú
      const updatedFormData = {
        ...document.activeVersion.formData,
        updatedAt: new Date().toISOString(),
      };

      await onResubmit({
        formData: updatedFormData,
        changeSummary: changeSummary.trim() || 'Cập nhật lại thông tin theo yêu cầu',
      });
      setModalType(null);
    } catch {
      // Error handled by parent
    }
  };

  const handleConfirmCancel = async () => {
    if (!comment.trim()) {
      setValidationError('Vui lòng nhập lý do hủy hồ sơ.');
      return;
    }

    try {
      await onCancel({
        cancelReason: comment.trim(),
      });
      setModalType(null);
    } catch {
      // Error handled by parent
    }
  };

  const handleConfirmReassign = async () => {
    if (!reassignOldUserId) {
      setValidationError('Vui lòng chọn người duyệt cần chuyển giao.');
      return;
    }
    if (!reassignNewUserId.trim()) {
      setValidationError('Vui lòng nhập ID/Mã người duyệt mới.');
      return;
    }
    if (reassignOldUserId === reassignNewUserId.trim()) {
      setValidationError('Người duyệt mới không được trùng với người duyệt cũ.');
      return;
    }
    if (!reassignReason.trim()) {
      setValidationError('Vui lòng nhập lý do chuyển giao.');
      return;
    }

    try {
      if (onReassign) {
        await onReassign({
          stepId: currentStep?.id,
          oldUserId: reassignOldUserId,
          newUserId: reassignNewUserId.trim(),
          reason: reassignReason.trim(),
        });
        setModalType(null);
      }
    } catch {
      // Error handled by parent
    }
  };

  const hasAnyAction =
    permissions.canApprove ||
    permissions.canResubmit ||
    permissions.canCancel ||
    (permissions.canReassign && !!onReassign && pendingAssignees.length > 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
        <FileCheck2 className="w-4 h-4 text-blue-600" />
        Thao tác trên hồ sơ
      </h3>

      {/* Thông báo quyền phê duyệt ủy quyền */}
      {permissions.isDelegatedApproval && (
        <div className="mb-4 rounded-lg p-3 text-xs bg-amber-50 text-amber-900 border border-amber-200 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            Bạn đang thao tác với tư cách <strong>người được ủy quyền</strong> thay mặt cho{' '}
            <strong>{permissions.delegatedFromUserName || 'người phê duyệt'}</strong> theo chính sách ủy quyền còn hiệu lực.
          </span>
        </div>
      )}

      {/* Thông báo lỗi xung đột hoặc lỗi mạng nếu có */}
      {errorMessage && (
        <div
          className={`mb-4 rounded-lg p-3.5 text-xs flex items-start gap-2.5 border ${
            isConflictError
              ? 'bg-amber-50 text-amber-900 border-amber-300'
              : 'bg-rose-50 text-rose-900 border-rose-300'
          }`}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold">
              {isConflictError ? 'Xung đột dữ liệu đồng thời (HTTP 409)' : 'Đã xảy ra lỗi thao tác'}
            </div>
            <div className="mt-0.5">{errorMessage}</div>
            {isConflictError && (
              <div className="mt-2">
                <Button size="sm" variant="outline" onClick={onReload} icon={<RefreshCw className="w-3.5 h-3.5" />}>
                  Tải lại dữ liệu mới nhất
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {!hasAnyAction && (
        <div className="text-xs text-slate-500 bg-slate-50 p-3.5 rounded-lg border border-slate-200 text-center">
          Bạn không có quyền hoặc hồ sơ hiện không có thao tác khả dụng ở bước này.
        </div>
      )}

      {/* Các nút hành động chính */}
      <div className="flex flex-wrap items-center gap-3">
        {permissions.canApprove && (
          <>
            <Button
              variant="success"
              onClick={() => handleOpenModal('approve')}
              icon={<CheckCircle className="w-4 h-4" />}
            >
              Chấp thuận phê duyệt
            </Button>
            <Button
              variant="warning"
              onClick={() => handleOpenModal('revision')}
              icon={<RotateCcw className="w-4 h-4" />}
            >
              Yêu cầu chỉnh sửa
            </Button>
            <Button
              variant="danger"
              onClick={() => handleOpenModal('reject')}
              icon={<XCircle className="w-4 h-4" />}
            >
              Từ chối hồ sơ
            </Button>
          </>
        )}

        {permissions.canResubmit && (
          <Button
            variant="primary"
            onClick={() => handleOpenModal('resubmit')}
            icon={<RotateCcw className="w-4 h-4" />}
          >
            Nộp lại hồ sơ sau chỉnh sửa
          </Button>
        )}

        {permissions.canCancel && (
          <Button
            variant="outline"
            className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300"
            onClick={() => handleOpenModal('cancel')}
            icon={<Ban className="w-4 h-4" />}
          >
            Hủy hồ sơ này
          </Button>
        )}

        {permissions.canReassign && onReassign && pendingAssignees.length > 0 && (
          <Button
            variant="outline"
            className="border-indigo-300 text-indigo-700 hover:bg-indigo-50"
            onClick={() => handleOpenModal('reassign')}
            icon={<UserCheck className="w-4 h-4" />}
          >
            Chuyển giao người duyệt
          </Button>
        )}
      </div>

      {/* Modal: Xác nhận Duyệt */}
      <Modal
        isOpen={modalType === 'approve'}
        onClose={handleCloseModal}
        title="Xác nhận Chấp thuận Phê duyệt"
        description="Quyết định của bạn sẽ được ghi nhận và bước duyệt tiếp theo sẽ được kích hoạt."
        footer={
          <>
            <Button variant="ghost" onClick={handleCloseModal} disabled={isLoading}>
              Đóng
            </Button>
            <Button
              variant="success"
              onClick={() => handleConfirmDecision(AssigneeDecision.APPROVED)}
              isLoading={isLoading}
              icon={<CheckCircle className="w-4 h-4" />}
            >
              Ký duyệt hồ sơ
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Ghi chú phê duyệt (Tùy chọn)
            </label>
            <textarea
              className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              rows={3}
              placeholder="Nhập nhận xét hoặc chỉ dẫn nếu có..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
          <div className="rounded-lg bg-slate-50 p-3 border border-slate-200">
            <span className="text-2xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">
              Ảnh chữ ký điện tử sẽ gắn kèm
            </span>
            <div className="h-12 w-36 border border-dashed border-slate-300 rounded bg-white flex items-center justify-center text-xs italic font-serif text-blue-900">
              An.NV
            </div>
          </div>
        </div>
      </Modal>

      {/* Modal: Yêu cầu sửa */}
      <Modal
        isOpen={modalType === 'revision'}
        onClose={handleCloseModal}
        title="Yêu cầu Chỉnh sửa Hồ sơ"
        description="Hồ sơ sẽ chuyển về cho người tạo bổ sung, toàn bộ chữ ký đã ký trước đó sẽ bị vô hiệu hóa."
        footer={
          <>
            <Button variant="ghost" onClick={handleCloseModal} disabled={isLoading}>
              Hủy
            </Button>
            <Button
              variant="warning"
              onClick={() => handleConfirmDecision(AssigneeDecision.REVISION_REQUESTED)}
              isLoading={isLoading}
            >
              Gửi yêu cầu sửa
            </Button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Nội dung chi tiết cần sửa đổi <span className="text-rose-500">*</span>
          </label>
          <textarea
            className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-800 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
            rows={4}
            placeholder="Nêu rõ các mục dữ liệu hoặc chứng từ cần bổ sung..."
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
              setValidationError('');
            }}
          />
          {validationError && (
            <p className="mt-1 text-2xs text-rose-600">{validationError}</p>
          )}
        </div>
      </Modal>

      {/* Modal: Từ chối */}
      <Modal
        isOpen={modalType === 'reject'}
        onClose={handleCloseModal}
        title="Xác nhận Từ chối Hồ sơ"
        description="Quy trình sẽ dừng lại hoàn toàn. Hồ sơ không thể tiếp tục xử lý."
        footer={
          <>
            <Button variant="ghost" onClick={handleCloseModal} disabled={isLoading}>
              Đóng
            </Button>
            <Button
              variant="danger"
              onClick={() => handleConfirmDecision(AssigneeDecision.REJECTED)}
              isLoading={isLoading}
            >
              Từ chối phê duyệt
            </Button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Lý do từ chối hồ sơ <span className="text-rose-500">*</span>
          </label>
          <textarea
            className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-800 focus:border-rose-500 focus:ring-1 focus:ring-rose-500"
            rows={4}
            placeholder="Nêu rõ căn cứ từ chối..."
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
              setValidationError('');
            }}
          />
          {validationError && (
            <p className="mt-1 text-2xs text-rose-600">{validationError}</p>
          )}
        </div>
      </Modal>

      {/* Modal: Nộp lại (Resubmit) */}
      <Modal
        isOpen={modalType === 'resubmit'}
        onClose={handleCloseModal}
        title="Nộp lại Hồ sơ sau chỉnh sửa (Tạo Version mới)"
        description="Hệ thống sẽ tạo phiên bản mới (v2) và khởi động lại luồng duyệt từ Bước 1."
        footer={
          <>
            <Button variant="ghost" onClick={handleCloseModal} disabled={isLoading}>
              Hủy
            </Button>
            <Button variant="primary" onClick={handleConfirmResubmit} isLoading={isLoading}>
              Xác nhận nộp lại
            </Button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Tóm tắt nội dung chỉnh sửa so với phiên bản trước
          </label>
          <textarea
            className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            rows={3}
            placeholder="Ví dụ: Đã bổ sung hóa đơn tài chính và cập nhật số tiền..."
            value={changeSummary}
            onChange={(e) => setChangeSummary(e.target.value)}
          />
        </div>
      </Modal>

      {/* Modal: Hủy hồ sơ (Cancel) */}
      <Modal
        isOpen={modalType === 'cancel'}
        onClose={handleCloseModal}
        title="Xác nhận Hủy Hồ sơ Trình ký"
        description="Sau khi hủy, hồ sơ sẽ chuyển sang trạng thái ĐÃ HỦY và không thể chỉnh sửa hay gửi lại."
        footer={
          <>
            <Button variant="ghost" onClick={handleCloseModal} disabled={isLoading}>
              Đóng
            </Button>
            <Button variant="danger" onClick={handleConfirmCancel} isLoading={isLoading}>
              Xác nhận hủy hồ sơ
            </Button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Lý do hủy hồ sơ <span className="text-rose-500">*</span>
          </label>
          <textarea
            className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-800 focus:border-rose-500 focus:ring-1 focus:ring-rose-500"
            rows={3}
            placeholder="Nhập lý do hủy bỏ..."
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
              setValidationError('');
            }}
          />
          {validationError && (
            <p className="mt-1 text-2xs text-rose-600">{validationError}</p>
          )}
        </div>
      </Modal>

      {/* Modal: Chuyển giao người duyệt (Reassign) */}
      <Modal
        isOpen={modalType === 'reassign'}
        onClose={handleCloseModal}
        title="Chuyển giao người duyệt (Reassign Approver)"
        description="Chuyển quyền phê duyệt bước hiện tại cho nhân sự khác cùng tổ chức. Quyết định trước đó của các bước hoặc người khác không bị ảnh hưởng."
        footer={
          <>
            <Button variant="ghost" onClick={handleCloseModal} disabled={isLoading}>
              Hủy
            </Button>
            <Button
              variant="primary"
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
              onClick={handleConfirmReassign}
              isLoading={isLoading}
              icon={<UserCheck className="w-4 h-4" />}
            >
              Xác nhận chuyển giao
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Người duyệt cần chuyển giao (Đang chờ) <span className="text-rose-500">*</span>
            </label>
            <select
              className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              value={reassignOldUserId}
              onChange={(e) => {
                setReassignOldUserId(e.target.value);
                setValidationError('');
              }}
            >
              {pendingAssignees.map((a) => (
                <option key={a.id} value={a.userId}>
                  {a.userName || a.userId} {a.userEmail ? `(${a.userEmail})` : ''} - {a.role || 'APPROVER'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Mã định danh / User ID người nhận mới <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              placeholder="Nhập User ID người duyệt mới (VD: user-admin-01)..."
              value={reassignNewUserId}
              onChange={(e) => {
                setReassignNewUserId(e.target.value);
                setValidationError('');
              }}
            />
            <p className="mt-1 text-2xs text-slate-500">
              * Người nhận phải là tài khoản đang hoạt động và thuộc cùng tổ chức với hồ sơ.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Lý do chuyển giao <span className="text-rose-500">*</span>
            </label>
            <textarea
              className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              rows={3}
              placeholder="Nhập lý do chi tiết (VD: Cán bộ nghỉ phép, chuyển vị trí công tác)..."
              value={reassignReason}
              onChange={(e) => {
                setReassignReason(e.target.value);
                setValidationError('');
              }}
            />
          </div>

          {validationError && (
            <p className="text-2xs text-rose-600 font-medium">{validationError}</p>
          )}
        </div>
      </Modal>
    </div>
  );
}
