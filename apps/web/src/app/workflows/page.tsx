'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  GitFork,
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
  GitBranch,
} from 'lucide-react';
import { workflowTemplateService } from '@/services/api';
import { WorkflowTemplateSummary, TemplateStatus } from '@/types/workflow-template';

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<WorkflowTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const loadWorkflows = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await workflowTemplateService.getWorkflowTemplates({
        status: selectedStatus === 'ALL' ? undefined : (selectedStatus as any),
        search: searchQuery.trim() || undefined,
      });
      setWorkflows(res.items);
    } catch (err: any) {
      setError(err.message || 'Không thể tải danh sách quy trình phê duyệt.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWorkflows();
  }, [selectedStatus]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadWorkflows();
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
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-blue-600 uppercase tracking-wider mb-1">
              <GitFork className="w-4 h-4" />
              Workflow Engine
            </div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Quản lý quy trình phê duyệt
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Thiết kế luồng ký duyệt động, phân quyền theo vai trò tổ chức và quản lý phiên bản bất biến
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/workflows/new"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold shadow-xs hover:shadow transition-all"
            >
              <Plus className="w-4 h-4" />
              Tạo quy trình mới
            </Link>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col sm:flex-row gap-4 items-center justify-between">
          {/* Status Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-2 sm:pb-0">
            {[
              { id: 'ALL', label: 'Tất cả quy trình' },
              { id: 'PUBLISHED', label: 'Đã phát hành' },
              { id: 'DRAFT', label: 'Bản nháp' },
              { id: 'ARCHIVED', label: 'Đã lưu trữ' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSelectedStatus(tab.id)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  selectedStatus === tab.id
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <form onSubmit={handleSearch} className="relative w-full sm:w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Tìm theo tên hoặc mã quy trình..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 bg-slate-50/50"
            />
          </form>
        </div>

        {/* Content Section */}
        {loading ? (
          <div className="flex flex-col items-center justify-center p-16 bg-white rounded-2xl border border-slate-200/80 shadow-xs">
            <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mb-3" />
            <p className="text-sm font-medium text-slate-600">Đang tải danh sách quy trình...</p>
          </div>
        ) : error ? (
          <div className="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-center">
            <p className="text-sm font-semibold text-rose-800">{error}</p>
            <button
              onClick={loadWorkflows}
              className="mt-3 px-4 py-2 text-xs font-semibold bg-white border border-rose-300 text-rose-700 rounded-lg shadow-2xs hover:bg-rose-50/50"
            >
              Thử lại
            </button>
          </div>
        ) : workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-16 bg-white rounded-2xl border border-slate-200/80 text-center">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mb-3 text-slate-400">
              <GitBranch className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold text-slate-900">Không tìm thấy quy trình nào</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm">
              Chưa có quy trình phê duyệt nào phù hợp với điều kiện tìm kiếm hiện tại.
            </p>
            <Link
              href="/workflows/new"
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium shadow-xs"
            >
              <Plus className="w-4 h-4" />
              Tạo quy trình đầu tiên
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {workflows.map((wf) => (
              <div
                key={wf.id}
                className="group bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs hover:shadow-md hover:border-slate-300 transition-all flex flex-col justify-between"
              >
                <div>
                  {/* Top Bar: Code & Status */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="font-mono text-2xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                      {wf.code}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-2xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">
                        v{wf.currentVersion}
                      </span>
                      {getStatusBadge(wf.status)}
                    </div>
                  </div>

                  {/* Title & Description */}
                  <h3 className="text-base font-bold text-slate-900 group-hover:text-blue-600 transition-colors line-clamp-1 mb-1.5">
                    {wf.title}
                  </h3>
                  <p className="text-xs text-slate-500 line-clamp-2 min-h-[32px] mb-4">
                    {wf.description || 'Chưa có mô tả chi tiết cho quy trình này.'}
                  </p>

                  {/* Badges / Stats */}
                  <div className="space-y-2 pt-3 border-t border-slate-100 text-xs text-slate-600">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5" /> Số bước duyệt:
                      </span>
                      <span className="font-semibold text-slate-800">{wf.stepCount} cấp</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <Building className="w-3.5 h-3.5" /> Phạm vi áp dụng:
                      </span>
                      <span className="font-medium text-slate-700 truncate max-w-[150px]">
                        {wf.organizationName}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" /> Cập nhật:
                      </span>
                      <span className="text-slate-500">
                        {new Date(wf.updatedAt).toLocaleDateString('vi-VN')}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Footer Action */}
                <div className="pt-4 mt-4 border-t border-slate-100">
                  <Link
                    href={`/workflows/${wf.id}`}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 hover:text-slate-900 rounded-xl transition-colors"
                  >
                    Xem chi tiết & Phiên bản
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
