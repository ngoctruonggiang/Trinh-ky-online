'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  FileText,
  Plus,
  Search,
  Building,
  Calendar,
  CheckCircle2,
  Clock,
  Archive,
  Layers,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { templateService, isMockMode } from '@/services/api';
import { TemplateSummary, TemplateStatus } from '@/types/template';

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const loadTemplates = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await templateService.getTemplates({
        status: selectedStatus === 'ALL' ? undefined : selectedStatus,
        search: searchQuery.trim() || undefined,
      });
      setTemplates(res.items);
    } catch (err: any) {
      setError(err.message || 'Không thể tải danh sách biểu mẫu từ máy chủ.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, [selectedStatus]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadTemplates();
  };

  const getStatusBadge = (status: TemplateStatus) => {
    switch (status) {
      case 'PUBLISHED':
        return (
          <span className="inline-flex items-center gap-1 text-2xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            Đã phát hành
          </span>
        );
      case 'DRAFT':
        return (
          <span className="inline-flex items-center gap-1 text-2xs font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
            <Clock className="w-3 h-3 text-amber-600" />
            Bản nháp
          </span>
        );
      case 'ARCHIVED':
        return (
          <span className="inline-flex items-center gap-1 text-2xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
            <Archive className="w-3 h-3 text-slate-500" />
            Đã lưu trữ
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Banner & Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Quản lý Mẫu Biểu mẫu (Form Templates)
            </h1>
            {isMockMode ? (
              <span className="text-2xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                Chế độ Thử nghiệm (Mock)
              </span>
            ) : error ? (
              <span className="text-2xs font-medium px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                API Thật (Lỗi kết nối)
              </span>
            ) : (
              <span className="text-2xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                API Thật (Đã kết nối)
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Định nghĩa cấu trúc trường dữ liệu, phiên bản và quy trình duyệt cho từng loại biểu mẫu nội bộ.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/templates/new"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 shadow-xs transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Tạo mẫu biểu mới</span>
          </Link>
        </div>
      </div>

      {/* Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Status Tabs */}
        <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-lg border border-slate-200/80 w-fit">
          {[
            { id: 'ALL', label: 'Tất cả' },
            { id: 'PUBLISHED', label: 'Đã phát hành' },
            { id: 'DRAFT', label: 'Bản nháp' },
            { id: 'ARCHIVED', label: 'Đã lưu trữ' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedStatus(tab.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                selectedStatus === tab.id
                  ? 'bg-white text-blue-600 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="relative w-full sm:w-72">
          <input
            type="text"
            placeholder="Tìm theo tên hoặc mã mẫu..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-colors"
          />
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
        </form>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-between">
          <div className="text-xs text-rose-700 font-medium">{error}</div>
          <button
            onClick={loadTemplates}
            className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 hover:text-rose-900"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Thử lại</span>
          </button>
        </div>
      )}

      {/* Template Cards Grid */}
      {loading ? (
        <div className="py-20 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-3 border-slate-200 border-t-blue-600 mb-3" />
          <div className="text-xs text-slate-500">Đang tải danh sách biểu mẫu...</div>
        </div>
      ) : templates.length === 0 ? (
        <div className="py-16 text-center bg-white rounded-xl border border-slate-200 p-8">
          <FileText className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <h3 className="text-sm font-bold text-slate-800">Không tìm thấy mẫu biểu mẫu nào</h3>
          <p className="text-xs text-slate-500 mt-1 mb-4">
            {searchQuery
              ? 'Thử tìm kiếm với từ khóa khác hoặc xóa bộ lọc.'
              : 'Hãy bắt đầu thiết kế biểu mẫu đầu tiên cho tổ chức của bạn.'}
          </p>
          <Link
            href="/templates/new"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Tạo mẫu ngay</span>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {templates.map((tmpl) => (
            <div
              key={tmpl.id}
              className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs hover:shadow-md hover:border-slate-300 transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="font-mono text-2xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                    {tmpl.code}
                  </span>
                  {getStatusBadge(tmpl.status)}
                </div>

                <Link
                  href={`/templates/${tmpl.id}`}
                  className="text-sm font-bold text-slate-900 hover:text-blue-600 transition-colors line-clamp-1 mb-1.5"
                >
                  {tmpl.title}
                </Link>

                <p className="text-xs text-slate-500 line-clamp-2 mb-4 leading-relaxed">
                  {tmpl.description || 'Chưa có mô tả chi tiết cho biểu mẫu này.'}
                </p>
              </div>

              <div className="pt-4 border-t border-slate-100 space-y-2.5">
                <div className="flex items-center justify-between text-2xs text-slate-500">
                  <div className="flex items-center gap-1.5">
                    <Layers className="w-3 h-3 text-slate-400" />
                    <span>Phiên bản v{tmpl.currentVersion} ({tmpl.fieldCount} trường)</span>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-medium">
                    {tmpl.category}
                  </span>
                </div>

                <div className="flex items-center justify-between text-2xs text-slate-400">
                  <div className="flex items-center gap-1 truncate max-w-[150px]">
                    <Building className="w-3 h-3 shrink-0" />
                    <span className="truncate">{tmpl.organizationName}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Calendar className="w-3 h-3 shrink-0" />
                    <span>{new Date(tmpl.updatedAt).toLocaleDateString('vi-VN')}</span>
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-between gap-2">
                  <Link
                    href={`/templates/${tmpl.id}`}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-800 inline-flex items-center gap-1"
                  >
                    <span>Xem & Sửa</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>

                  {tmpl.status === 'PUBLISHED' && (
                    <Link
                      href={`/documents/new?templateId=${tmpl.id}`}
                      className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-white text-2xs font-semibold transition-colors"
                    >
                      Dùng mẫu này
                    </Link>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
