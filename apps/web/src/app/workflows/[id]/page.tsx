'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Calendar,
  Building,
  User,
  GitFork,
  CheckCircle2,
  Clock,
  Archive,
  Layers,
  AlertTriangle,
  RefreshCw,
  Edit2,
  Trash2,
  Plus,
  HelpCircle,
  FileCheck2,
} from 'lucide-react';
import { workflowTemplateService } from '@/services/api';
import { WorkflowTemplateDetail, TemplateStatus } from '@/types/workflow-template';
import { WorkflowStepConfig } from '@trinh-ky/shared';
import { WorkflowChainPreview } from '@/components/workflow-builder/workflow-chain-preview';
import { WorkflowStepCard } from '@/components/workflow-builder/workflow-step-card';
import { WorkflowStepModal } from '@/components/workflow-builder/workflow-step-modal';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function WorkflowDetailPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const workflowId = resolvedParams.id;

  const [workflow, setWorkflow] = useState<WorkflowTemplateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'steps' | 'versions'>('steps');

  // Modal Publish State
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [releaseNotes, setReleaseNotes] = useState('');

  // Modal Step Edit State
  const [isStepModalOpen, setIsStepModalOpen] = useState(false);
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);

  const loadWorkflow = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await workflowTemplateService.getWorkflowTemplateById(workflowId);
      setWorkflow(res);
    } catch (err: any) {
      setError(err.message || 'Không thể tải thông tin quy trình.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWorkflow();
  }, [workflowId]);

  // Hành động 1: Tạo bản nháp phiên bản tiếp theo
  const handleCreateDraft = async () => {
    try {
      setActionLoading(true);
      await workflowTemplateService.createDraftVersion(workflowId);
      await loadWorkflow();
    } catch (err: any) {
      alert(err.message || 'Lỗi khi tạo bản nháp');
    } finally {
      setActionLoading(false);
    }
  };

  // Hành động 2: Hủy bỏ bản nháp
  const handleDiscardDraft = async () => {
    if (!confirm('Bạn có chắc chắn muốn hủy bỏ bản nháp này? Các thay đổi chưa phát hành sẽ bị mất.')) {
      return;
    }
    try {
      setActionLoading(true);
      await workflowTemplateService.discardDraftVersion(workflowId);
      await loadWorkflow();
    } catch (err: any) {
      alert(err.message || 'Lỗi khi hủy bản nháp');
    } finally {
      setActionLoading(false);
    }
  };

  // Hành động 3: Phát hành (v1 hoặc v2, v3...)
  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setActionLoading(true);
      await workflowTemplateService.publishWorkflowTemplate(workflowId, {
        changeSummary: releaseNotes.trim() || undefined,
        releaseNotes: releaseNotes.trim() || undefined,
      });
      setShowPublishModal(false);
      setReleaseNotes('');
      await loadWorkflow();
    } catch (err: any) {
      alert(err.message || 'Lỗi khi phát hành quy trình');
    } finally {
      setActionLoading(false);
    }
  };

  // Hành động 4: Lưu trữ quy trình
  const handleArchive = async () => {
    if (!confirm('Bạn có chắc chắn muốn lưu trữ quy trình này? Người dùng sẽ không thể chọn quy trình đã lưu trữ.')) {
      return;
    }
    try {
      setActionLoading(true);
      await workflowTemplateService.archiveWorkflowTemplate(workflowId);
      await loadWorkflow();
    } catch (err: any) {
      alert(err.message || 'Lỗi khi lưu trữ quy trình');
    } finally {
      setActionLoading(false);
    }
  };

  // Step modal save handler for Draft
  const handleSaveStep = async (step: WorkflowStepConfig) => {
    if (!workflow) return;
    const currentSteps = workflow.hasDraft && workflow.draftVersion
      ? [...workflow.draftVersion.steps]
      : [...workflow.steps];

    let newSteps: WorkflowStepConfig[] = [];
    if (editingStepIndex !== null) {
      currentSteps[editingStepIndex] = {
        ...step,
        stepOrder: editingStepIndex + 1,
      };
      newSteps = currentSteps;
    } else {
      newSteps = [...currentSteps, { ...step, stepOrder: currentSteps.length + 1 }];
    }

    try {
      setActionLoading(true);
      if (workflow.status === 'DRAFT') {
        await workflowTemplateService.updateWorkflowTemplate(workflow.id, {
          steps: newSteps,
        });
      } else if (workflow.hasDraft) {
        await workflowTemplateService.updateDraftVersion(workflow.id, {
          steps: newSteps,
        });
      }
      await loadWorkflow();
    } catch (err: any) {
      alert(err.message || 'Lỗi khi lưu bước');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteStep = async (idx: number) => {
    if (!workflow) return;
    const currentSteps = workflow.hasDraft && workflow.draftVersion
      ? [...workflow.draftVersion.steps]
      : [...workflow.steps];

    const updated = currentSteps.filter((_, i) => i !== idx).map((s, i) => ({
      ...s,
      stepOrder: i + 1,
    }));

    try {
      setActionLoading(true);
      if (workflow.status === 'DRAFT') {
        await workflowTemplateService.updateWorkflowTemplate(workflow.id, {
          steps: updated,
        });
      } else if (workflow.hasDraft) {
        await workflowTemplateService.updateDraftVersion(workflow.id, {
          steps: updated,
        });
      }
      await loadWorkflow();
    } catch (err: any) {
      alert(err.message || 'Lỗi khi xóa bước');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mb-3" />
        <p className="text-sm font-medium text-slate-600">Đang tải thông tin quy trình...</p>
      </div>
    );
  }

  if (error || !workflow) {
    return (
      <div className="min-h-screen bg-slate-50 py-12 px-4 text-center">
        <div className="max-w-md mx-auto bg-white p-8 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <AlertTriangle className="w-10 h-10 text-rose-500 mx-auto" />
          <h2 className="text-lg font-bold text-slate-800">Không thể xem quy trình</h2>
          <p className="text-sm text-slate-500">{error || 'Quy trình không tồn tại hoặc đã bị xóa.'}</p>
          <Link
            href="/workflows"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold"
          >
            Quay lại danh sách
          </Link>
        </div>
      </div>
    );
  }

  const isEditable = workflow.status === 'DRAFT' || workflow.hasDraft;
  const activeSteps = workflow.hasDraft && workflow.draftVersion
    ? workflow.draftVersion.steps
    : workflow.steps;

  return (
    <div className="min-h-screen bg-slate-50/50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between">
          <Link
            href="/workflows"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Quay lại danh sách quy trình
          </Link>

          <span className="text-2xs font-mono text-slate-400">ID: {workflow.id}</span>
        </div>

        {/* Warning Banner: Draft Version is currently active */}
        {workflow.hasDraft && workflow.draftVersion && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-fadeIn">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-amber-100 rounded-xl text-amber-800 shrink-0 mt-0.5">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-amber-900">
                  Bản nháp phiên bản v{workflow.draftVersion.versionNumber} đang được chuẩn bị
                </h3>
                <p className="text-xs text-amber-700 mt-0.5">
                  Các chỉnh sửa bước duyệt dưới đây thuộc bản nháp v{workflow.draftVersion.versionNumber}. Snapshot v{workflow.currentVersion} đã phát hành vẫn được bảo vệ an toàn cho các hồ sơ đang xử lý.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={() => setShowPublishModal(true)}
                disabled={actionLoading}
                className="px-4 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
              >
                Phát hành v{workflow.draftVersion.versionNumber}
              </button>
              <button
                type="button"
                onClick={handleDiscardDraft}
                disabled={actionLoading}
                className="px-3.5 py-2 rounded-xl border border-amber-300 text-amber-800 hover:bg-amber-100/60 text-xs font-semibold transition-colors cursor-pointer"
              >
                Hủy bản nháp
              </button>
            </div>
          </div>
        )}

        {/* Main Header Card */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="space-y-3 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-bold px-2.5 py-0.5 rounded-md bg-slate-100 text-slate-800 border border-slate-200">
                {workflow.code}
              </span>
              <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-200">
                Phiên bản v{workflow.currentVersion}
              </span>
              <span
                className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full border ${
                  workflow.status === 'PUBLISHED'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : workflow.status === 'DRAFT'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}
              >
                {workflow.status === 'PUBLISHED' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                {workflow.status === 'DRAFT' && <Clock className="w-3.5 h-3.5 text-amber-600" />}
                {workflow.status === 'ARCHIVED' && <Archive className="w-3.5 h-3.5 text-slate-500" />}
                {workflow.status === 'PUBLISHED' ? 'Đã phát hành' : workflow.status === 'DRAFT' ? 'Bản nháp' : 'Đã lưu trữ'}
              </span>
            </div>

            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              {workflow.title}
            </h1>

            {workflow.description && (
              <p className="text-xs sm:text-sm text-slate-500 leading-relaxed max-w-3xl">
                {workflow.description}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 pt-2 border-t border-slate-100">
              <span className="flex items-center gap-1.5">
                <Building className="w-3.5 h-3.5 text-slate-400" />
                {workflow.organizationName}
              </span>
              <span className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-slate-400" />
                Tạo bởi: <strong className="text-slate-700">{workflow.createdByName}</strong>
              </span>
              <span className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                Cập nhật: {new Date(workflow.updatedAt).toLocaleDateString('vi-VN')}
              </span>
            </div>
          </div>

          {/* Action Buttons Toolbar */}
          <div className="flex flex-wrap sm:flex-col gap-2.5 shrink-0 items-stretch sm:min-w-[180px]">
            {workflow.status === 'DRAFT' && (
              <button
                type="button"
                onClick={() => setShowPublishModal(true)}
                disabled={actionLoading}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                Phát hành v1
              </button>
            )}

            {workflow.status === 'PUBLISHED' && !workflow.hasDraft && (
              <button
                type="button"
                onClick={handleCreateDraft}
                disabled={actionLoading}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Tạo bản nháp v{workflow.currentVersion + 1}
              </button>
            )}

            {workflow.status !== 'ARCHIVED' && (
              <button
                type="button"
                onClick={handleArchive}
                disabled={actionLoading}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50 text-xs font-medium transition-colors cursor-pointer"
              >
                <Archive className="w-3.5 h-3.5" />
                Lưu trữ quy trình
              </button>
            )}
          </div>
        </div>

        {/* Visual Flowchart Component */}
        <WorkflowChainPreview steps={activeSteps} />

        {/* Tabs: Cấu hình bước vs Lịch sử phiên bản */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="flex items-center border-b border-slate-200 px-6">
            <button
              onClick={() => setActiveTab('steps')}
              className={`py-4 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors mr-6 ${
                activeTab === 'steps'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Các bước duyệt ({activeSteps.length})
            </button>
            <button
              onClick={() => setActiveTab('versions')}
              className={`py-4 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${
                activeTab === 'versions'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Lịch sử phiên bản ({workflow.versions.length})
            </button>
          </div>

          <div className="p-6">
            {activeTab === 'steps' ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-500">
                    {isEditable
                      ? 'Bạn có thể chỉnh sửa cấu hình các bước trong bản nháp này trước khi phát hành chính thức.'
                      : 'Quy trình đã phát hành. Vui lòng bấm "Tạo bản nháp phiên bản tiếp theo" nếu muốn thay đổi.'}
                  </p>

                  {isEditable && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingStepIndex(null);
                        setIsStepModalOpen(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-semibold cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" /> Thêm bước duyệt
                    </button>
                  )}
                </div>

                <div className="space-y-3">
                  {activeSteps.map((st, idx) => (
                    <WorkflowStepCard
                      key={st.stepKey || idx}
                      step={st}
                      index={idx}
                      totalSteps={activeSteps.length}
                      readOnly={!isEditable}
                      onEdit={() => {
                        setEditingStepIndex(idx);
                        setIsStepModalOpen(true);
                      }}
                      onDelete={() => handleDeleteStep(idx)}
                      onMoveUp={() => {}}
                      onMoveDown={() => {}}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">Phiên bản</th>
                      <th className="py-3 px-4">Tiêu đề snapshot</th>
                      <th className="py-3 px-4">Ghi chú phát hành</th>
                      <th className="py-3 px-4">Số bước</th>
                      <th className="py-3 px-4">Người phát hành</th>
                      <th className="py-3 px-4">Ngày phát hành</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {workflow.versions.map((ver) => (
                      <tr key={ver.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-blue-600">
                          v{ver.versionNumber}
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-800">
                          {ver.title}
                        </td>
                        <td className="py-3 px-4 text-slate-500">
                          {ver.changeSummary || 'Không có ghi chú'}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-700">
                          {ver.stepCount} bước
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          {ver.createdByName}
                        </td>
                        <td className="py-3 px-4 text-slate-400 font-mono text-2xs">
                          {new Date(ver.createdAt).toLocaleString('vi-VN')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Modal Publish */}
        {showPublishModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
              <h3 className="text-base font-bold text-slate-900">
                Phát hành phiên bản {workflow.hasDraft && workflow.draftVersion ? `v${workflow.draftVersion.versionNumber}` : 'v1'}
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Sau khi phát hành, cấu hình quy trình này sẽ được chốt bất biến (immutable snapshot). Mọi hồ sơ tạo mới sẽ tự động sử dụng phiên bản này.
              </p>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Tóm tắt thay đổi & Ghi chú phát hành
                </label>
                <textarea
                  rows={3}
                  value={releaseNotes}
                  onChange={(e) => setReleaseNotes(e.target.value)}
                  placeholder="VD: Điều chỉnh cấp duyệt Giám đốc, cập nhật hạn mức..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPublishModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  onClick={handlePublish}
                  disabled={actionLoading}
                  className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-xs cursor-pointer"
                >
                  {actionLoading ? 'Đang phát hành...' : 'Xác nhận phát hành'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step Edit Modal */}
        <WorkflowStepModal
          isOpen={isStepModalOpen}
          onClose={() => setIsStepModalOpen(false)}
          onSave={handleSaveStep}
          initialStep={editingStepIndex !== null ? activeSteps[editingStepIndex] : null}
          existingKeys={activeSteps.map((s) => s.stepKey)}
          currentOrder={editingStepIndex !== null ? editingStepIndex + 1 : activeSteps.length + 1}
        />
      </div>
    </div>
  );
}
