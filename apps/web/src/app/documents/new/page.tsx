'use client';

import React, { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  FileText,
  FileSignature,
  CheckCircle2,
  Clock,
  AlertCircle,
  Building,
  Layers,
  ArrowRight,
  Send,
  Save,
} from 'lucide-react';
import { templateService, documentService } from '@/services/api';
import { TemplateSummary, TemplateDetail } from '@/types/template';
import { DynamicFormRenderer } from '@/components/form-builder/dynamic-form-renderer';
import { validateFormData } from '@trinh-ky/shared';

export default function NewDocumentPage() {
  return (
    <React.Suspense
      fallback={
        <div className="py-20 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-slate-200 border-t-blue-600 mb-3" />
          <div className="text-xs text-slate-500">Đang chuẩn bị biểu mẫu khởi tạo hồ sơ...</div>
        </div>
      }
    >
      <NewDocumentContent />
    </React.Suspense>
  );
}

function NewDocumentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedTemplateId = searchParams.get('templateId');

  // Templates list state
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);

  // Selected Template state
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(preselectedTemplateId);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateDetail | null>(null);
  const [loadingTemplateDetail, setLoadingTemplateDetail] = useState(false);

  // Document form fields state
  const [title, setTitle] = useState('');
  const [urgency, setUrgency] = useState<'LOW' | 'NORMAL' | 'URGENT' | 'EMERGENCY'>('NORMAL');
  const [dueDate, setDueDate] = useState('');
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Load published templates list
  useEffect(() => {
    async function loadPublishedTemplates() {
      try {
        setLoadingTemplates(true);
        const res = await templateService.getTemplates({ status: 'PUBLISHED' });
        setTemplates(res.items);
      } catch (err: any) {
        setGeneralError(err.message || 'Không thể tải danh sách biểu mẫu.');
      } finally {
        setLoadingTemplates(false);
      }
    }
    loadPublishedTemplates();
  }, []);

  // When selectedTemplateId changes, load its details
  useEffect(() => {
    if (!selectedTemplateId) {
      setSelectedTemplate(null);
      return;
    }
    async function loadDetail() {
      try {
        setLoadingTemplateDetail(true);
        setGeneralError(null);
        const data = await templateService.getTemplateById(selectedTemplateId!);
        setSelectedTemplate(data);
        if (!title) {
          setTitle(`${data.title} - ${new Date().toLocaleDateString('vi-VN')}`);
        }
      } catch (err: any) {
        setGeneralError(err.message || 'Không thể tải chi tiết biểu mẫu được chọn.');
      } finally {
        setLoadingTemplateDetail(false);
      }
    }
    loadDetail();
  }, [selectedTemplateId]);

  // Form field value change handler
  const handleFieldChange = (key: string, val: any) => {
    setFormData((prev) => ({ ...prev, [key]: val }));
    // Xóa lỗi của trường đó nếu người dùng đã nhập
    if (validationErrors[key]) {
      setValidationErrors((prev) => {
        const updated = { ...prev };
        delete updated[key];
        return updated;
      });
    }
  };

  // Submit Handler
  const handleCreateDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplate) return;

    try {
      setSubmitting(true);
      setGeneralError(null);

      if (!title.trim()) {
        throw new Error('Vui lòng nhập Tiêu đề hồ sơ trình ký.');
      }

      // 1. Client-side validation using shared engine
      const clientValidation = validateFormData(selectedTemplate.fields, formData);
      if (!clientValidation.valid) {
        setValidationErrors(clientValidation.errors);
        throw new Error('Vui lòng kiểm tra lại các trường thông tin biểu mẫu được đánh dấu màu đỏ.');
      }

      // 2. Call document service createDocument
      if (!documentService.createDocument) {
        throw new Error('Hàm tạo hồ sơ chưa được hỗ trợ trên service layer.');
      }

      const res = await documentService.createDocument({
        templateId: selectedTemplate.id,
        title: title.trim(),
        urgency,
        dueDate: dueDate || undefined,
        formData,
      });

      // 3. Chuyển hướng tới trang chi tiết hồ sơ vừa tạo
      router.push(`/documents/${res.id}`);
    } catch (err: any) {
      setGeneralError(err.message || 'Lỗi khi tạo hồ sơ trình ký.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      {/* Navigation */}
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 mb-3 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Quay lại trang chủ</span>
        </Link>

        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <FileSignature className="w-5 h-5 text-blue-600" />
            Khởi Tạo Hồ Sơ Trình Ký Mới
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Chọn mẫu biểu mẫu phù hợp và điền các trường thông tin theo quy chuẩn nội bộ.
          </p>
        </div>
      </div>

      {/* General Error Banner */}
      {generalError && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2.5 text-xs text-rose-700 font-medium">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{generalError}</span>
        </div>
      )}

      {/* BƯỚC 1: CHỌN MẪU BIỂU MẪU (NẾU CHƯA CHỌN) */}
      {!selectedTemplate ? (
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-800">
                Bước 1: Chọn loại hồ sơ / Mẫu biểu mẫu
              </h2>
              <p className="text-xs text-slate-500">
                Các mẫu biểu mẫu đã được phát hành chính thức cho tổ chức của bạn.
              </p>
            </div>
            <Link
              href="/templates"
              className="text-xs font-semibold text-blue-600 hover:text-blue-800"
            >
              Quản lý biểu mẫu →
            </Link>
          </div>

          {loadingTemplates ? (
            <div className="py-12 text-center text-xs text-slate-400">
              Đang tải danh sách mẫu biểu mẫu...
            </div>
          ) : templates.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500 space-y-3">
              <p>Chưa có mẫu biểu mẫu nào được phát hành.</p>
              <Link
                href="/templates/new"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white font-semibold text-xs"
              >
                Tạo mẫu biểu mới
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              {templates.map((tmpl) => (
                <div
                  key={tmpl.id}
                  onClick={() => setSelectedTemplateId(tmpl.id)}
                  className="p-4 rounded-xl border border-slate-200 hover:border-blue-500 hover:shadow-xs transition-all cursor-pointer bg-slate-50/50 hover:bg-blue-50/20 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="font-mono text-2xs font-bold px-2 py-0.5 rounded bg-white text-slate-700 border border-slate-200">
                        {tmpl.code}
                      </span>
                      <span className="text-2xs font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700">
                        {tmpl.category}
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 mb-1">{tmpl.title}</h3>
                    <p className="text-xs text-slate-500 line-clamp-2 mb-3">
                      {tmpl.description || 'Không có mô tả'}
                    </p>
                  </div>

                  <div className="flex items-center justify-between text-2xs text-slate-400 pt-2 border-t border-slate-100">
                    <span>{tmpl.fieldCount} trường dữ liệu</span>
                    <span className="text-blue-600 font-semibold inline-flex items-center gap-1">
                      <span>Chọn mẫu này</span>
                      <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* BƯỚC 2: ĐIỀN BIỂU MẪU ĐỘNG */
        <form onSubmit={handleCreateDocument} className="space-y-6">
          {/* Selected Template Badge & Change Button */}
          <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-white text-blue-700 border border-blue-200">
                {selectedTemplate.code}
              </span>
              <div>
                <h2 className="text-xs font-bold text-blue-900">{selectedTemplate.title}</h2>
                <p className="text-2xs text-blue-700">
                  Phiên bản biểu mẫu: v{selectedTemplate.currentVersion} • {selectedTemplate.fields.length} trường
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedTemplateId(null)}
              className="text-xs font-semibold text-blue-700 hover:text-blue-900"
            >
              Đổi mẫu khác
            </button>
          </div>

          {/* Document General Information */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
            <h2 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2">
              1. Thông tin chung hồ sơ
            </h2>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tiêu đề hồ sơ trình ký <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                placeholder="VD: Đề nghị tạm ứng công tác Hải Phòng..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Độ khẩn cấp
                </label>
                <select
                  value={urgency}
                  onChange={(e) => setUrgency(e.target.value as any)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                >
                  <option value="LOW">Thấp</option>
                  <option value="NORMAL">Bình thường</option>
                  <option value="URGENT">Khẩn cấp (Gấp)</option>
                  <option value="EMERGENCY">Hỏa tốc</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Hạn hoàn tất (nếu có)
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Dynamic Form Fields */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
            <h2 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2">
              2. Nội dung biểu mẫu chi tiết ({selectedTemplate.fields.length} trường)
            </h2>

            <DynamicFormRenderer
              fields={selectedTemplate.fields}
              value={formData}
              onChange={handleFieldChange}
              errors={validationErrors}
              disabled={submitting}
            />
          </div>

          {/* Action Footer */}
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setSelectedTemplateId(null)}
              className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
            >
              Hủy bỏ
            </button>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 shadow-xs transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{submitting ? 'Đang tạo hồ sơ...' : 'Tạo hồ sơ (Lưu nháp DRAFT)'}</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
