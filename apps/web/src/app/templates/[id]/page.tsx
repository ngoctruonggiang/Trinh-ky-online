'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Archive,
  Layers,
  Building,
  Calendar,
  User,
  Plus,
  RefreshCw,
  AlertCircle,
  FileSpreadsheet,
} from 'lucide-react';
import { templateService } from '@/services/api';
import { TemplateDetail, TemplateStatus } from '@/types/template';

export default function TemplateDetailPage() {
  const params = useParams();
  const router = useRouter();
  const templateId = params.id as string;

  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Publish Modal State
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [changeSummary, setChangeSummary] = useState('');

  const loadTemplate = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await templateService.getTemplateById(templateId);
      setTemplate(data);
    } catch (err: any) {
      setError(err.message || 'Không thể tải chi tiết biểu mẫu.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplate();
  }, [templateId]);

  const handlePublish = async () => {
    try {
      setActionLoading(true);
      await templateService.publishTemplate(templateId, {
        changeSummary: changeSummary.trim() || undefined,
      });
      setShowPublishModal(false);
      setChangeSummary('');
      await loadTemplate();
    } catch (err: any) {
      alert(err.message || 'Lỗi khi phát hành biểu mẫu.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleArchive = async () => {
    if (!confirm('Bạn có chắc chắn muốn lưu trữ biểu mẫu này? Biểu mẫu đã lưu trữ sẽ không thể dùng để tạo hồ sơ mới.')) {
      return;
    }
    try {
      setActionLoading(true);
      await templateService.archiveTemplate(templateId);
      await loadTemplate();
    } catch (err: any) {
      alert(err.message || 'Lỗi khi lưu trữ biểu mẫu.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateDraft = async () => {
    try {
      setActionLoading(true);
      await templateService.createDraftVersion(templateId);
      await loadTemplate();
    } catch (err: any) {
      alert(err.message || 'Lỗi khi tạo bản nháp phiên bản tiếp theo.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDiscardDraft = async () => {
    if (!confirm('Bạn có chắc chắn muốn hủy bỏ bản nháp này? Mọi thay đổi chưa xuất bản sẽ bị xóa.')) {
      return;
    }
    try {
      setActionLoading(true);
      await templateService.discardDraftVersion(templateId);
      await loadTemplate();
    } catch (err: any) {
      alert(err.message || 'Lỗi khi hủy bản nháp.');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="py-24 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-3 border-slate-200 border-t-blue-600 mb-3" />
        <div className="text-xs text-slate-500">Đang tải thông tin biểu mẫu...</div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="py-20 text-center max-w-lg mx-auto">
        <h2 className="text-base font-bold text-slate-800">Không tìm thấy biểu mẫu</h2>
        <p className="text-xs text-slate-500 mt-1 mb-4">{error || 'Biểu mẫu không tồn tại hoặc bạn không có quyền xem.'}</p>
        <Link href="/templates" className="text-xs font-semibold text-blue-600 hover:text-blue-800">
          ← Quay lại danh sách biểu mẫu
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Back button */}
      <div>
        <Link
          href="/templates"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 mb-3 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Quay lại danh sách biểu mẫu</span>
        </Link>

        {/* Header Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="font-mono text-2xs font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                {template.code}
              </span>
              {template.status === 'PUBLISHED' ? (
                <span className="inline-flex items-center gap-1 text-2xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                  Đã phát hành
                </span>
              ) : template.status === 'DRAFT' ? (
                <span className="inline-flex items-center gap-1 text-2xs font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                  <Clock className="w-3 h-3 text-amber-600" />
                  Bản nháp
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-2xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                  <Archive className="w-3 h-3 text-slate-500" />
                  Đã lưu trữ
                </span>
              )}
              <span className="text-2xs font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                Phiên bản v{template.currentVersion}
              </span>
            </div>

            <h1 className="text-lg md:text-xl font-bold text-slate-900 leading-snug">
              {template.title}
            </h1>

            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 mt-2">
              <div className="flex items-center gap-1.5">
                <Building className="w-3.5 h-3.5 text-slate-400" />
                <span>{template.organizationName}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-slate-400" />
                <span>Tạo bởi: <strong className="text-slate-700">{template.createdByName}</strong></span>
              </div>
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>Cập nhật: {new Date(template.updatedAt).toLocaleDateString('vi-VN')}</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {template.status === 'DRAFT' && (
              <button
                onClick={() => setShowPublishModal(true)}
                disabled={actionLoading}
                className="px-3.5 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors shadow-xs disabled:opacity-50"
              >
                Phát hành v1
              </button>
            )}

            {template.status === 'PUBLISHED' && template.hasDraft && (
              <>
                <button
                  onClick={() => setShowPublishModal(true)}
                  disabled={actionLoading}
                  className="px-3.5 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors shadow-xs disabled:opacity-50"
                >
                  Phát hành v{template.draftVersion?.versionNumber || template.currentVersion + 1}
                </button>
                <button
                  onClick={handleDiscardDraft}
                  disabled={actionLoading}
                  className="px-3 py-2 rounded-lg border border-rose-300 text-rose-600 text-xs font-semibold hover:bg-rose-50 transition-colors disabled:opacity-50"
                >
                  Hủy bản nháp
                </button>
              </>
            )}

            {template.status === 'PUBLISHED' && !template.hasDraft && (
              <button
                onClick={handleCreateDraft}
                disabled={actionLoading}
                className="px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors shadow-xs disabled:opacity-50"
              >
                + Tạo bản nháp phiên bản tiếp theo
              </button>
            )}

            {template.status !== 'ARCHIVED' && (
              <button
                onClick={handleArchive}
                disabled={actionLoading}
                className="px-3 py-2 rounded-lg border border-slate-300 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Lưu trữ
              </button>
            )}

            {template.status === 'PUBLISHED' && (
              <Link
                href={`/documents/new?templateId=${template.id}`}
                className="px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors shadow-xs"
              >
                Tạo hồ sơ từ mẫu này
              </Link>
            )}
          </div>
        </div>

        {/* Draft Notice Banner if hasDraft is true */}
        {template.status === 'PUBLISHED' && template.hasDraft && (
          <div className="mt-3 p-4 rounded-xl border border-amber-200 bg-amber-50/80 flex items-start justify-between gap-3 shadow-xs">
            <div className="flex items-start gap-2.5">
              <Clock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <h4 className="text-xs font-bold text-amber-900">
                  Đang có bản nháp chuẩn bị cho Phiên bản v{template.draftVersion?.versionNumber || template.currentVersion + 1}
                </h4>
                <p className="text-2xs text-amber-700 mt-0.5">
                  Snapshot v{template.currentVersion} vẫn đang được phục vụ người dùng tạo hồ sơ mà không bị ảnh hưởng. Bản nháp này sẽ chỉ có hiệu lực khi bạn xác nhận phát hành.
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowPublishModal(true)}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-2xs font-bold hover:bg-amber-700 transition-colors"
            >
              Phát hành ngay
            </button>
          </div>
        )}
      </div>

      {/* Grid: Fields List & Version History */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Schema Fields */}
        <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-800">
              Cấu trúc trường dữ liệu ({template.fields.length} trường)
            </h2>
            <span className="text-2xs text-slate-400 font-mono">Phiên bản hiện tại v{template.currentVersion}</span>
          </div>

          <div className="divide-y divide-slate-100">
            {template.fields.map((field, idx) => (
              <div key={field.id || idx} className="py-3 flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-800">{field.label}</span>
                    {field.required && (
                      <span className="text-2xs font-semibold text-rose-600 bg-rose-50 px-1.5 py-0.2 rounded">
                        Bắt buộc
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-2xs text-slate-500 font-mono">
                    <span>Key: <strong className="text-slate-700">{field.key}</strong></span>
                    <span>Type: <strong className="text-blue-600 uppercase">{field.type}</strong></span>
                  </div>
                  {field.placeholder && (
                    <p className="text-2xs text-slate-400 italic">Placeholder: &ldquo;{field.placeholder}&rdquo;</p>
                  )}
                </div>

                {field.options && field.options.length > 0 && (
                  <span className="text-2xs px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                    {field.options.length} tùy chọn
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right: Version History */}
        <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-blue-600" />
              Lịch sử phiên bản phát hành
            </h2>
          </div>

          {template.versions.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              Chưa có phiên bản nào được phát hành chính thức (Đang ở bản nháp ban đầu).
            </div>
          ) : (
            <div className="space-y-3">
              {template.versions.map((ver) => (
                <div
                  key={ver.id}
                  className="p-3.5 rounded-lg border border-slate-100 bg-slate-50/70 space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900">
                      Phiên bản v{ver.versionNumber}
                    </span>
                    <span className="text-2xs text-slate-400">
                      {new Date(ver.createdAt).toLocaleDateString('vi-VN')}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">
                    {ver.changeSummary || 'Không có mô tả thay đổi'}
                  </p>
                  <div className="flex items-center justify-between text-2xs text-slate-400 pt-1">
                    <span>Phát hành bởi: {ver.createdByName}</span>
                    <span>{ver.fieldCount} trường</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Publish Modal */}
      {showPublishModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">
              {template.status === 'DRAFT' ? 'Phát hành biểu mẫu' : 'Phát hành phiên bản mới'}
            </h3>
            <p className="text-xs text-slate-500">
              {template.status === 'DRAFT'
                ? 'Biểu mẫu sau khi phát hành sẽ có thể sử dụng để nộp hồ sơ trình ký.'
                : `Hệ thống sẽ tạo phiên bản v${template.currentVersion + 1} và lưu trữ bất biến phiên bản cũ.`}
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tóm tắt thay đổi (Ghi chú phiên bản)
              </label>
              <textarea
                rows={3}
                placeholder="Mô tả ngắn gọn điểm mới trong phiên bản này..."
                value={changeSummary}
                onChange={(e) => setChangeSummary(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowPublishModal(false)}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handlePublish}
                disabled={actionLoading}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {actionLoading ? 'Đang phát hành...' : 'Xác nhận phát hành'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
