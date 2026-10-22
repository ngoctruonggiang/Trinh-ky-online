'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Eye,
  Sliders,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  FileSpreadsheet,
} from 'lucide-react';
import { templateService } from '@/services/api';
import { FormFieldDefinition, FormFieldType, normalizeFieldKey } from '@trinh-ky/shared';
import { DynamicFormRenderer } from '@/components/form-builder/dynamic-form-renderer';

export default function NewTemplatePage() {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<'designer' | 'preview'>('designer');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Template General Info
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Hành chính - Nhân sự');
  const [description, setDescription] = useState('');

  // Fields List
  const [fields, setFields] = useState<FormFieldDefinition[]>([
    {
      id: 'f_default_1',
      key: 'ho_ten',
      label: 'Họ và tên người đề xuất',
      type: 'text',
      required: true,
      order: 1,
      placeholder: 'Nguyễn Văn A',
    },
    {
      id: 'f_default_2',
      key: 'ly_do',
      label: 'Lý do & Nội dung đề xuất',
      type: 'textarea',
      required: true,
      order: 2,
      placeholder: 'Nêu rõ lý do và mục đích...',
    },
  ]);

  // Preview form test state
  const [previewData, setPreviewData] = useState<Record<string, any>>({});
  const [previewErrors, setPreviewErrors] = useState<Record<string, string>>({});

  // Field manipulation helpers
  const handleAddField = () => {
    const newFieldOrder = fields.length + 1;
    const newKey = `truong_${newFieldOrder}`;
    const newField: FormFieldDefinition = {
      id: `field_${Date.now()}`,
      key: newKey,
      label: `Trường dữ liệu ${newFieldOrder}`,
      type: 'text',
      required: false,
      order: newFieldOrder,
      placeholder: '',
      helpText: '',
      options: [],
    };
    setFields([...fields, newField]);
  };

  const handleUpdateField = (index: number, updates: Partial<FormFieldDefinition>) => {
    const updated = [...fields];
    updated[index] = { ...updated[index], ...updates };
    setFields(updated);
  };

  const handleDeleteField = (index: number) => {
    if (fields.length <= 1) {
      alert('Biểu mẫu phải có ít nhất 1 trường dữ liệu!');
      return;
    }
    const updated = fields.filter((_, i) => i !== index);
    // Cập nhật lại thứ tự
    setFields(updated.map((f, i) => ({ ...f, order: i + 1 })));
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const updated = [...fields];
    const temp = updated[index];
    updated[index] = updated[index - 1];
    updated[index - 1] = temp;
    setFields(updated.map((f, i) => ({ ...f, order: i + 1 })));
  };

  const handleMoveDown = (index: number) => {
    if (index === fields.length - 1) return;
    const updated = [...fields];
    const temp = updated[index];
    updated[index] = updated[index + 1];
    updated[index + 1] = temp;
    setFields(updated.map((f, i) => ({ ...f, order: i + 1 })));
  };

  // Add Option to Select/Radio Field
  const handleAddOption = (fieldIndex: number) => {
    const field = fields[fieldIndex];
    const currentOptions = Array.isArray(field.options) ? [...field.options] : [];
    currentOptions.push({
      label: `Lựa chọn ${currentOptions.length + 1}`,
      value: `OPT_${currentOptions.length + 1}`,
    });
    handleUpdateField(fieldIndex, { options: currentOptions });
  };

  const handleUpdateOption = (fieldIndex: number, optionIndex: number, label: string, value: string) => {
    const field = fields[fieldIndex];
    const currentOptions = Array.isArray(field.options) ? [...field.options] : [];
    currentOptions[optionIndex] = { label, value };
    handleUpdateField(fieldIndex, { options: currentOptions });
  };

  const handleDeleteOption = (fieldIndex: number, optionIndex: number) => {
    const field = fields[fieldIndex];
    const currentOptions = Array.isArray(field.options) ? [...field.options] : [];
    currentOptions.splice(optionIndex, 1);
    handleUpdateField(fieldIndex, { options: currentOptions });
  };

  // Submit Handler
  const handleSave = async (publishImmediately: boolean) => {
    try {
      setSubmitting(true);
      setErrorMessage(null);

      if (!code.trim()) {
        throw new Error('Vui lòng nhập Mã biểu mẫu (viết hoa không dấu, ví dụ: TAM_UNG).');
      }
      if (!title.trim()) {
        throw new Error('Vui lòng nhập Tiêu đề biểu mẫu.');
      }
      if (fields.length === 0) {
        throw new Error('Biểu mẫu phải có ít nhất 1 trường dữ liệu.');
      }

      // 1. Tạo template ở DRAFT
      const created = await templateService.createTemplate({
        code: code.trim().toUpperCase(),
        title: title.trim(),
        category,
        description: description.trim() || undefined,
        fields,
      });

      // 2. Nếu chọn phát hành ngay
      if (publishImmediately) {
        await templateService.publishTemplate(created.id, {
          changeSummary: 'Phát hành biểu mẫu lần đầu',
        });
      }

      // Điều hướng về danh sách
      router.push('/templates');
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi khi lưu biểu mẫu.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* Top Navigation */}
      <div>
        <Link
          href="/templates"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 mb-3 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Quay lại danh sách biểu mẫu</span>
        </Link>

        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-blue-600" />
              Thiết kế Biểu mẫu Động Mới (Form Builder)
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Định nghĩa cấu hình các trường nhập liệu, kiểu dữ liệu và quy tắc hợp lệ.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleSave(false)}
              disabled={submitting}
              className="px-3.5 py-2 rounded-lg border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              {submitting ? 'Đang lưu...' : 'Lưu bản nháp'}
            </button>
            <button
              onClick={() => handleSave(true)}
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 shadow-xs transition-colors disabled:opacity-50"
            >
              {submitting ? 'Đang phát hành...' : 'Phát hành ngay (Publish)'}
            </button>
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2.5 text-xs text-rose-700 font-medium">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Mode Switcher Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab('designer')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'designer'
              ? 'bg-blue-50 text-blue-700 font-bold'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Trình thiết kế (Designer)</span>
        </button>

        <button
          onClick={() => setActiveTab('preview')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'preview'
              ? 'bg-blue-50 text-blue-700 font-bold'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Eye className="w-3.5 h-3.5" />
          <span>Xem trước thời gian thực (Live Preview)</span>
        </button>
      </div>

      {/* TAB 1: DESIGNER */}
      {activeTab === 'designer' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* General Information Card */}
          <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <h2 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2">
              1. Thông tin chung
            </h2>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Mã biểu mẫu <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                placeholder="VD: TAM_UNG, NGHI_PHEP"
                value={code}
                onChange={(e) => setCode(normalizeFieldKey(e.target.value).toUpperCase())}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white font-mono uppercase focus:outline-hidden focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
              />
              <p className="text-2xs text-slate-400 mt-1">Chỉ chứa chữ in hoa, số và gạch dưới.</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tiêu đề biểu mẫu <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                placeholder="VD: Giấy đề nghị tạm ứng công tác"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Danh mục phân loại
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
              >
                <option value="Hành chính - Nhân sự">Hành chính - Nhân sự</option>
                <option value="Tài chính - Kế toán">Tài chính - Kế toán</option>
                <option value="Kinh doanh - Dự án">Kinh doanh - Dự án</option>
                <option value="Vật tư - Thiết bị">Vật tư - Thiết bị</option>
                <option value="Khác">Khác</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Mô tả hướng dẫn
              </label>
              <textarea
                rows={3}
                placeholder="Ghi chú hướng dẫn cán bộ nhân viên khi điền biểu mẫu này..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Fields Configuration List */}
          <div className="lg:col-span-8 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-800">
                2. Cấu hình các trường nhập liệu ({fields.length} trường)
              </h2>
              <button
                type="button"
                onClick={handleAddField}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-semibold hover:bg-blue-100 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Thêm trường dữ liệu</span>
              </button>
            </div>

            {fields.map((field, index) => {
              const isSelectOrRadio = ['select', 'radio', 'checkbox'].includes(field.type.toLowerCase());
              const currentOptions = Array.isArray(field.options) ? field.options : [];

              return (
                <div
                  key={field.id}
                  className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4 hover:border-slate-300 transition-colors"
                >
                  {/* Field Header & Controls */}
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-700 text-2xs font-bold flex items-center justify-center">
                        {index + 1}
                      </span>
                      <span className="text-xs font-bold text-slate-900">{field.label || 'Chưa đặt tên'}</span>
                      <span className="font-mono text-2xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                        {field.key}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleMoveUp(index)}
                        disabled={index === 0}
                        title="Di chuyển lên"
                        className="p-1 rounded text-slate-400 hover:text-slate-700 disabled:opacity-20 hover:bg-slate-100"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveDown(index)}
                        disabled={index === fields.length - 1}
                        title="Di chuyển xuống"
                        className="p-1 rounded text-slate-400 hover:text-slate-700 disabled:opacity-20 hover:bg-slate-100"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteField(index)}
                        title="Xóa trường"
                        className="p-1 rounded text-rose-400 hover:text-rose-600 hover:bg-rose-50 transition-colors ml-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Field Settings Form */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-2xs font-semibold text-slate-600 mb-1">
                        Nhãn trường (Label) <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={field.label}
                        onChange={(e) => {
                          const newLabel = e.target.value;
                          handleUpdateField(index, {
                            label: newLabel,
                            // Tự động sinh key nếu key đang là mặc định
                            key: field.key.startsWith('truong_') ? normalizeFieldKey(newLabel) : field.key,
                          });
                        }}
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-2xs font-semibold text-slate-600 mb-1">
                        Định danh duy nhất (Key) <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={field.key}
                        onChange={(e) => handleUpdateField(index, { key: normalizeFieldKey(e.target.value) })}
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-2xs font-semibold text-slate-600 mb-1">
                        Kiểu dữ liệu (Type)
                      </label>
                      <select
                        value={field.type}
                        onChange={(e) => handleUpdateField(index, { type: e.target.value as FormFieldType })}
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white"
                      >
                        <option value="text">Văn bản ngắn (Text)</option>
                        <option value="textarea">Văn bản nhiều dòng (Textarea)</option>
                        <option value="number">Chữ số (Number)</option>
                        <option value="currency_vnd">Tiền tệ VNĐ</option>
                        <option value="date">Ngày tháng (Date)</option>
                        <option value="select">Danh sách chọn (Select Dropdown)</option>
                        <option value="radio">Chọn một (Radio Buttons)</option>
                        <option value="checkbox">Hộp kiểm (Checkbox)</option>
                        <option value="email">Email</option>
                      </select>
                    </div>
                  </div>

                  {/* Extra options row */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-2xs font-semibold text-slate-600 mb-1">
                        Chữ gợi ý (Placeholder)
                      </label>
                      <input
                        type="text"
                        placeholder="VD: Nhập số tiền..."
                        value={field.placeholder || ''}
                        onChange={(e) => handleUpdateField(index, { placeholder: e.target.value })}
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white"
                      />
                    </div>

                    <div className="flex items-center gap-4 pt-4">
                      <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(e) => handleUpdateField(index, { required: e.target.checked })}
                          className="w-4 h-4 text-blue-600 rounded border-slate-300"
                        />
                        <span>Bắt buộc nhập (Required)</span>
                      </label>
                    </div>
                  </div>

                  {/* If SELECT or RADIO, show Options Manager */}
                  {isSelectOrRadio && (
                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80 space-y-2 mt-2">
                      <div className="flex items-center justify-between">
                        <span className="text-2xs font-bold text-slate-700 uppercase tracking-wide">
                          Danh sách tùy chọn lựa chọn (Options)
                        </span>
                        <button
                          type="button"
                          onClick={() => handleAddOption(index)}
                          className="text-2xs font-semibold text-blue-600 hover:text-blue-800"
                        >
                          + Thêm tùy chọn
                        </button>
                      </div>

                      {currentOptions.length === 0 ? (
                        <p className="text-2xs text-rose-500 italic">
                          Chưa có tùy chọn nào. Vui lòng bấm &ldquo;+ Thêm tùy chọn&rdquo;.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {currentOptions.map((opt: any, optIdx: number) => {
                            const optLabel = typeof opt === 'string' ? opt : opt.label;
                            const optVal = typeof opt === 'string' ? opt : opt.value;
                            return (
                              <div key={optIdx} className="flex items-center gap-2">
                                <input
                                  type="text"
                                  placeholder="Nhãn hiển thị..."
                                  value={optLabel}
                                  onChange={(e) =>
                                    handleUpdateOption(index, optIdx, e.target.value, optVal)
                                  }
                                  className="flex-1 px-2.5 py-1 text-xs rounded border border-slate-300 bg-white"
                                />
                                <input
                                  type="text"
                                  placeholder="Giá trị (value)..."
                                  value={optVal}
                                  onChange={(e) =>
                                    handleUpdateOption(index, optIdx, optLabel, e.target.value)
                                  }
                                  className="w-32 px-2.5 py-1 text-xs font-mono rounded border border-slate-300 bg-white"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleDeleteOption(index, optIdx)}
                                  className="text-slate-400 hover:text-rose-500 p-1"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* TAB 2: LIVE PREVIEW */
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs max-w-2xl mx-auto space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <span className="text-2xs font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-mono">
              {code || 'MA_BIEU_MAU'}
            </span>
            <h2 className="text-base font-bold text-slate-900 mt-1">
              {title || 'Tiêu đề biểu mẫu'}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {description || 'Xem trước giao diện khi người dùng điền biểu mẫu thực tế.'}
            </p>
          </div>

          {/* Dynamic Form Renderer */}
          <DynamicFormRenderer
            fields={fields}
            value={previewData}
            onChange={(key, val) => setPreviewData({ ...previewData, [key]: val })}
            errors={previewErrors}
          />

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setPreviewData({});
                setPreviewErrors({});
              }}
              className="text-xs font-medium text-slate-500 hover:text-slate-800"
            >
              Xóa sạch form thử nghiệm
            </button>
            <span className="text-2xs text-slate-400">
              Chế độ xem trước — Dữ liệu nhập ở đây sẽ không lưu vào database
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
