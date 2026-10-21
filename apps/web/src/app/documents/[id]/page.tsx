'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Calendar,
  Building,
  User,
  Fingerprint,
  FileSpreadsheet,
  History,
  CheckCircle2,
  FileCheck,
} from 'lucide-react';
import {
  DocumentDetail,
  ProcessDecisionPayload,
  ResubmitPayload,
  CancelPayload,
} from '@/types/document';
import { documentService, isMockMode } from '@/services/api';
import { StatusBadge, UrgencyBadge } from '@/components/ui/badge';
import { WorkflowStepper } from '@/components/documents/workflow-stepper';
import { WorkflowActionBox } from '@/components/documents/workflow-action-box';

export default function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const documentId = resolvedParams.id;
  const router = useRouter();

  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConflictError, setIsConflictError] = useState(false);

  const loadDocument = async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      setIsConflictError(false);
      const data = await documentService.getDocumentDetail(documentId);
      setDocument(data);
    } catch (err: any) {
      if (err.statusCode === 403) {
        setErrorMessage('Bạn không có quyền truy cập hồ sơ này hoặc hồ sơ thuộc tổ chức khác (403 Forbidden).');
      } else if (err.statusCode === 404) {
        setErrorMessage('Không tìm thấy hồ sơ được yêu cầu (404 Not Found).');
      } else if (err.statusCode === 401) {
        setErrorMessage('Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại (401 Unauthorized).');
      } else {
        setErrorMessage(err.message || 'Không thể tải chi tiết hồ sơ từ máy chủ.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocument();
  }, [documentId]);

  const handleDecision = async (payload: ProcessDecisionPayload) => {
    try {
      setActionLoading(true);
      setErrorMessage(null);
      setIsConflictError(false);
      await documentService.processDecision(documentId, payload);
      await loadDocument();
    } catch (err: any) {
      if (err.code === 'CONCURRENCY_CONFLICT' || err.statusCode === 409 || err.message?.includes('Xung đột')) {
        setIsConflictError(true);
        setErrorMessage(err.message || 'Bước duyệt này đã được người duyệt khác xử lý trước đó.');
      } else {
        setErrorMessage(err.message || 'Lỗi khi ra quyết định phê duyệt');
      }
      throw err;
    } finally {
      setActionLoading(false);
    }
  };

  const handleResubmit = async (payload: ResubmitPayload) => {
    try {
      setActionLoading(true);
      setErrorMessage(null);
      await documentService.resubmitDocument(documentId, payload);
      await loadDocument();
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi khi nộp lại hồ sơ');
      throw err;
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async (payload: CancelPayload) => {
    try {
      setActionLoading(true);
      setErrorMessage(null);
      await documentService.cancelDocument(documentId, payload);
      await loadDocument();
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi khi hủy hồ sơ');
      throw err;
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="py-24 text-center">
        <div className="inline-block animate-spin rounded-full h-9 w-9 border-4 border-slate-200 border-t-blue-600 mb-3" />
        <div className="text-sm text-slate-500">Đang tải chi tiết hồ sơ...</div>
      </div>
    );
  }

  if (!document) {
    return (
      <div className="py-20 text-center">
        <h2 className="text-base font-bold text-slate-800">Không tìm thấy hồ sơ</h2>
        <p className="text-xs text-slate-500 mt-1 mb-4">
          Hồ sơ có thể đã bị xóa hoặc bạn không có quyền truy cập.
        </p>
        <Link
          href="/"
          className="text-xs font-semibold text-blue-600 hover:text-blue-800"
        >
          ← Quay lại danh sách
        </Link>
      </div>
    );
  }

  const formData = document.activeVersion?.formData || {};

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Navigation & Header */}
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 mb-3 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Quay lại danh sách</span>
        </Link>

        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                {document.documentNumber}
              </span>
              <StatusBadge status={document.status} />
              <UrgencyBadge urgency={document.urgency} />
              <span className="text-2xs font-medium px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                Phiên bản v{document.currentVersion}
              </span>
              {isMockMode ? (
                <span className="text-2xs font-medium px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                  Giả lập (Mock)
                </span>
              ) : (
                <span className="text-2xs font-medium px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                  API Thật
                </span>
              )}
            </div>
            <h1 className="text-lg md:text-xl font-bold text-slate-900 leading-snug">
              {document.title}
            </h1>
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 mt-2">
              <div className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-slate-400" />
                <span>Người tạo: <strong className="text-slate-700">{document.createdByName}</strong></span>
              </div>
              <div className="flex items-center gap-1.5">
                <Building className="w-3.5 h-3.5 text-slate-400" />
                <span>{document.organizationName}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>Khởi tạo: {new Date(document.createdAt).toLocaleDateString('vi-VN')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: 2 Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Form Content & Decision History (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Form Content Card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2 font-semibold text-sm text-slate-800">
                <FileSpreadsheet className="w-4 h-4 text-blue-600" />
                <span>Nội dung biểu mẫu: {document.templateTitle}</span>
              </div>
              <div className="flex items-center gap-1 text-2xs font-mono text-slate-400" title="Mã băm toàn vẹn nội dung SHA-256">
                <Fingerprint className="w-3.5 h-3.5 text-slate-400" />
                <span>{document.activeVersion?.sha256Hash?.substring(0, 16)}...</span>
              </div>
            </div>

            <div className="p-6 space-y-4 text-xs">
              {/* Fields Display */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-4 border-b border-slate-100">
                {formData.employeeName && (
                  <div>
                    <label className="text-slate-400 text-2xs block uppercase font-medium">Nhân viên đề nghị</label>
                    <span className="font-semibold text-slate-800 text-sm">{formData.employeeName}</span>
                  </div>
                )}
                {formData.department && (
                  <div>
                    <label className="text-slate-400 text-2xs block uppercase font-medium">Bộ phận / Phòng ban</label>
                    <span className="font-semibold text-slate-800">{formData.department}</span>
                  </div>
                )}
                {formData.advanceAmount !== undefined && (
                  <div>
                    <label className="text-slate-400 text-2xs block uppercase font-medium">Số tiền tạm ứng</label>
                    <span className="font-bold text-blue-600 text-base">
                      {Number(formData.advanceAmount).toLocaleString('vi-VN')} ₫
                    </span>
                  </div>
                )}
                {formData.amount !== undefined && (
                  <div>
                    <label className="text-slate-400 text-2xs block uppercase font-medium">Số tiền đề nghị</label>
                    <span className="font-bold text-blue-600 text-base">
                      {Number(formData.amount).toLocaleString('vi-VN')} ₫
                    </span>
                  </div>
                )}
                {formData.reimbursementDeadline && (
                  <div>
                    <label className="text-slate-400 text-2xs block uppercase font-medium">Hạn thanh toán hoàn ứng</label>
                    <span className="font-medium text-slate-700">{formData.reimbursementDeadline}</span>
                  </div>
                )}
              </div>

              {formData.reason && (
                <div>
                  <label className="text-slate-400 text-2xs block uppercase font-medium mb-1">Mục đích & Lý do đề xuất</label>
                  <p className="text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-200/80 leading-relaxed">
                    {formData.reason}
                  </p>
                </div>
              )}

              {/* Bảng kê chi phí nếu có */}
              {Array.isArray(formData.breakdown) && formData.breakdown.length > 0 && (
                <div>
                  <label className="text-slate-400 text-2xs block uppercase font-medium mb-1.5">Bảng kê chi tiết các khoản chi</label>
                  <div className="rounded-lg border border-slate-200 overflow-hidden">
                    <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                      <thead className="bg-slate-50 text-2xs font-semibold text-slate-500 uppercase">
                        <tr>
                          <th className="px-3 py-2">Khoản mục</th>
                          <th className="px-3 py-2 text-right">Chi phí ước tính</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {formData.breakdown.map((item: any, idx: number) => (
                          <tr key={idx}>
                            <td className="px-3 py-2">{item.item}</td>
                            <td className="px-3 py-2 text-right font-medium">
                              {Number(item.cost).toLocaleString('vi-VN')} ₫
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Lịch sử xử lý & Chữ ký điện tử Card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-6">
            <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <History className="w-4 h-4 text-blue-600" />
              Lịch sử Phê duyệt & Chữ ký Xác thực
            </h3>

            {document.decisionHistories.length === 0 ? (
              <div className="text-xs text-slate-400 text-center py-6">
                Chưa có quyết định nào được ghi nhận cho hồ sơ này.
              </div>
            ) : (
              <div className="space-y-3">
                {document.decisionHistories.map((hist) => (
                  <div key={hist.id} className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/50 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-slate-800">
                        {hist.stepName} — {hist.userName}
                      </span>
                      <span className="text-2xs text-slate-400">
                        {new Date(hist.decidedAt).toLocaleString('vi-VN')}
                      </span>
                    </div>
                    {hist.decisionComment && (
                      <div className="text-slate-600 mt-1 italic">
                        "{hist.decisionComment}"
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Chữ ký số điện tử hợp lệ */}
            {document.signatures.length > 0 && (
              <div className="mt-6 pt-5 border-t border-slate-100">
                <h4 className="text-xs font-semibold text-slate-800 mb-3 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  Chữ ký số điện tử hợp lệ
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {document.signatures.map((sig) => (
                    <div key={sig.id} className="p-3 rounded-lg border border-emerald-200 bg-emerald-50/30 flex items-center gap-3">
                      <div className="h-10 w-24 bg-white border border-slate-200 rounded flex items-center justify-center p-1">
                        <span className="font-serif italic text-blue-900 font-bold text-xs">
                          {sig.userName}
                        </span>
                      </div>
                      <div className="text-2xs">
                        <div className="font-semibold text-slate-800">{sig.userName}</div>
                        <div className="text-slate-500">Đã ký: {new Date(sig.signedAt).toLocaleDateString('vi-VN')}</div>
                        <div className="text-emerald-700 font-medium mt-0.5">✓ Chữ ký xác thực hợp lệ</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Workflow Action & Timeline (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Action Box */}
          <WorkflowActionBox
            document={document}
            onDecision={handleDecision}
            onResubmit={handleResubmit}
            onCancel={handleCancel}
            onReload={loadDocument}
            isLoading={actionLoading}
            errorMessage={errorMessage}
            isConflictError={isConflictError}
          />

          {/* Workflow Stepper Card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-6">
            <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <FileCheck className="w-4 h-4 text-blue-600" />
              Tiến trình quy trình duyệt
            </h3>
            <WorkflowStepper
              steps={document.workflow.steps}
              currentStepOrder={document.workflow.currentStepOrder}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
