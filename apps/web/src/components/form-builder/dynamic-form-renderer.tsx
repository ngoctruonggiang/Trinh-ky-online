'use client';

import React from 'react';
import { FormFieldDefinition, normalizeFieldOptions } from '@trinh-ky/shared';
import { AlertCircle, Calendar, Hash, Mail, FileText } from 'lucide-react';

interface DynamicFormRendererProps {
  fields: FormFieldDefinition[];
  value: Record<string, any>;
  onChange: (key: string, val: any) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
}

export function DynamicFormRenderer({
  fields,
  value,
  onChange,
  errors = {},
  disabled = false,
}: DynamicFormRendererProps) {
  // Sắp xếp các trường theo thuộc tính order tăng dần
  const sortedFields = [...fields].sort((a, b) => (a.order || 0) - (b.order || 0));

  if (!sortedFields || sortedFields.length === 0) {
    return (
      <div className="py-8 text-center text-xs text-slate-400 bg-slate-50 rounded-lg border border-dashed border-slate-200">
        Biểu mẫu này chưa có trường dữ liệu nào.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {sortedFields.map((field) => {
        const key = (field.key || field.name || '').trim();
        if (!key) return null;

        const fieldValue = value[key] !== undefined ? value[key] : (field.defaultValue ?? '');
        const error = errors[key];
        const normalizedType = (field.type || 'text').toLowerCase();
        const options = normalizeFieldOptions(field.options);

        return (
          <div key={key} className="space-y-1.5">
            {/* Field Label */}
            <label className="block text-xs font-semibold text-slate-700">
              {field.label}
              {field.required && <span className="text-rose-500 ml-1 font-bold">*</span>}
            </label>

            {/* Field Inputs */}
            {(() => {
              switch (normalizedType) {
                case 'textarea':
                  return (
                    <textarea
                      disabled={disabled}
                      rows={3}
                      placeholder={field.placeholder || `Nhập ${field.label.toLowerCase()}...`}
                      value={fieldValue}
                      onChange={(e) => onChange(key, e.target.value)}
                      className={`w-full px-3 py-2 text-xs rounded-lg border bg-white focus:outline-hidden focus:ring-2 transition-colors ${
                        error
                          ? 'border-rose-400 focus:ring-rose-200'
                          : 'border-slate-300 focus:border-blue-500 focus:ring-blue-100'
                      } ${disabled ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : 'text-slate-800'}`}
                    />
                  );

                case 'number':
                case 'currency_vnd':
                  return (
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                        <Hash className="w-3.5 h-3.5" />
                      </div>
                      <input
                        type="number"
                        disabled={disabled}
                        min={field.validation?.min}
                        max={field.validation?.max}
                        placeholder={field.placeholder || '0'}
                        value={fieldValue}
                        onChange={(e) => onChange(key, e.target.value === '' ? '' : Number(e.target.value))}
                        className={`w-full pl-9 pr-3 py-2 text-xs rounded-lg border bg-white focus:outline-hidden focus:ring-2 transition-colors ${
                          error
                            ? 'border-rose-400 focus:ring-rose-200'
                            : 'border-slate-300 focus:border-blue-500 focus:ring-blue-100'
                        } ${disabled ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : 'text-slate-800'}`}
                      />
                    </div>
                  );

                case 'email':
                  return (
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                        <Mail className="w-3.5 h-3.5" />
                      </div>
                      <input
                        type="email"
                        disabled={disabled}
                        placeholder={field.placeholder || 'email@congty.vn'}
                        value={fieldValue}
                        onChange={(e) => onChange(key, e.target.value)}
                        className={`w-full pl-9 pr-3 py-2 text-xs rounded-lg border bg-white focus:outline-hidden focus:ring-2 transition-colors ${
                          error
                            ? 'border-rose-400 focus:ring-rose-200'
                            : 'border-slate-300 focus:border-blue-500 focus:ring-blue-100'
                        } ${disabled ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : 'text-slate-800'}`}
                      />
                    </div>
                  );

                case 'date':
                  return (
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                        <Calendar className="w-3.5 h-3.5" />
                      </div>
                      <input
                        type="date"
                        disabled={disabled}
                        value={fieldValue}
                        onChange={(e) => onChange(key, e.target.value)}
                        className={`w-full pl-9 pr-3 py-2 text-xs rounded-lg border bg-white focus:outline-hidden focus:ring-2 transition-colors ${
                          error
                            ? 'border-rose-400 focus:ring-rose-200'
                            : 'border-slate-300 focus:border-blue-500 focus:ring-blue-100'
                        } ${disabled ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : 'text-slate-800'}`}
                      />
                    </div>
                  );

                case 'select':
                  return (
                    <select
                      disabled={disabled}
                      value={fieldValue}
                      onChange={(e) => onChange(key, e.target.value)}
                      className={`w-full px-3 py-2 text-xs rounded-lg border bg-white focus:outline-hidden focus:ring-2 transition-colors ${
                        error
                          ? 'border-rose-400 focus:ring-rose-200'
                          : 'border-slate-300 focus:border-blue-500 focus:ring-blue-100'
                      } ${disabled ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : 'text-slate-800'}`}
                    >
                      <option value="">-- Vui lòng chọn --</option>
                      {options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  );

                case 'radio':
                  return (
                    <div className="flex flex-wrap gap-4 pt-1">
                      {options.map((opt) => (
                        <label
                          key={opt.value}
                          className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                        >
                          <input
                            type="radio"
                            name={key}
                            disabled={disabled}
                            value={opt.value}
                            checked={fieldValue === opt.value}
                            onChange={() => onChange(key, opt.value)}
                            className="w-3.5 h-3.5 text-blue-600 focus:ring-blue-500 border-slate-300"
                          />
                          <span>{opt.label}</span>
                        </label>
                      ))}
                    </div>
                  );

                case 'checkbox':
                  return (
                    <div className="pt-1">
                      {options.length > 0 ? (
                        <div className="flex flex-wrap gap-4">
                          {options.map((opt) => {
                            const isChecked = Array.isArray(fieldValue) && fieldValue.includes(opt.value);
                            return (
                              <label
                                key={opt.value}
                                className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  disabled={disabled}
                                  checked={isChecked}
                                  onChange={(e) => {
                                    const currentArray = Array.isArray(fieldValue) ? [...fieldValue] : [];
                                    if (e.target.checked) {
                                      currentArray.push(opt.value);
                                    } else {
                                      const idx = currentArray.indexOf(opt.value);
                                      if (idx > -1) currentArray.splice(idx, 1);
                                    }
                                    onChange(key, currentArray);
                                  }}
                                  className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
                                />
                                <span>{opt.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            disabled={disabled}
                            checked={Boolean(fieldValue)}
                            onChange={(e) => onChange(key, e.target.checked)}
                            className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
                          />
                          <span>{field.placeholder || 'Đồng ý / Xác nhận'}</span>
                        </label>
                      )}
                    </div>
                  );

                case 'text':
                default:
                  return (
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                        <FileText className="w-3.5 h-3.5" />
                      </div>
                      <input
                        type="text"
                        disabled={disabled}
                        placeholder={field.placeholder || `Nhập ${field.label.toLowerCase()}...`}
                        value={fieldValue}
                        onChange={(e) => onChange(key, e.target.value)}
                        className={`w-full pl-9 pr-3 py-2 text-xs rounded-lg border bg-white focus:outline-hidden focus:ring-2 transition-colors ${
                          error
                            ? 'border-rose-400 focus:ring-rose-200'
                            : 'border-slate-300 focus:border-blue-500 focus:ring-blue-100'
                        } ${disabled ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : 'text-slate-800'}`}
                      />
                    </div>
                  );
              }
            })()}

            {/* Help Text */}
            {field.helpText && !error && (
              <p className="text-2xs text-slate-500 mt-0.5">{field.helpText}</p>
            )}

            {/* Validation Error Message */}
            {error && (
              <div className="flex items-center gap-1 text-2xs text-rose-600 mt-0.5 font-medium">
                <AlertCircle className="w-3 h-3 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
