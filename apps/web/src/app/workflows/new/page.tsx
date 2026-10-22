'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Save,
  Plus,
  AlertCircle,
  Layers,
  Sparkles,
  GitFork,
  HelpCircle,
} from 'lucide-react';
import { workflowTemplateService } from '@/services/api';
import { WorkflowStepConfig } from '@trinh-ky/shared';
import { WorkflowStepCard } from '@/components/workflow-builder/workflow-step-card';
import { WorkflowStepModal } from '@/components/workflow-builder/workflow-step-modal';
import { WorkflowChainPreview } from '@/components/workflow-builder/workflow-chain-preview';

export default function NewWorkflowPage() {
  const router = useRouter();

  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Chung');

  const [steps, setSteps] = useState<WorkflowStepConfig[]>([
    {
      stepKey: 'step_mgr',
      stepName: 'Trưởng phòng chuyên môn duyệt',
      stepOrder: 1,
      stepType: 'SEQUENTIAL',
      completionRule: 'ALL_MUST_APPROVE',
      approverConfig: {
        type: 'DEPARTMENT_ROLE',
        role: 'MANAGER',
        departmentPolicy: 'SAME_AS_DOCUMENT',
      },
      reviewerUserIds: [],
      description: 'Kiểm tra tính cần thiết và kế hoạch phòng ban',
    },
    {
      stepKey: 'step_dir',
      stepName: 'Ban Giám đốc phê duyệt',
      stepOrder: 2,
      stepType: 'SEQUENTIAL',
      completionRule: 'ANY_CAN_APPROVE',
      approverConfig: {
        type: 'ORGANIZATION_ROLE',
        role: 'DIRECTOR',
      },
      reviewerUserIds: [],
      description: 'Phê duyệt hạn mức và chủ trương thực hiện',
    },
  ]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal actions
  const handleOpenAddModal = () => {
    setEditingStepIndex(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (idx: number) => {
    setEditingStepIndex(idx);
    setIsModalOpen(true);
  };

  const handleSaveStep = (step: WorkflowStepConfig) => {
    if (editingStepIndex !== null) {
      // Edit step
      const updated = [...steps];
      updated[editingStepIndex] = {
        ...step,
        stepOrder: editingStepIndex + 1,
      };
      setSteps(updated);
    } else {
      // Add new step
      const newStep = {
        ...step,
        stepOrder: steps.length + 1,
      };
      setSteps([...steps, newStep]);
    }
  };

  const handleDeleteStep = (idx: number) => {
    const updated = steps.filter((_, i) => i !== idx).map((st, i) => ({
      ...st,
      stepOrder: i + 1,
    }));
    setSteps(updated);
  };

  const handleMoveUp = (idx: number) => {
    if (idx === 0) return;
    const updated = [...steps];
    const temp = updated[idx - 1];
    updated[idx - 1] = { ...updated[idx], stepOrder: idx };
    updated[idx] = { ...temp, stepOrder: idx + 1 };
    setSteps(updated);
  };

  const handleMoveDown = (idx: number) => {
    if (idx === steps.length - 1) return;
    const updated = [...steps];
    const temp = updated[idx + 1];
    updated[idx + 1] = { ...updated[idx], stepOrder: idx + 2 };
    updated[idx] = { ...temp, stepOrder: idx + 1 };
    setSteps(updated);
  };

  // Submit action
  const handleSaveWorkflow = async () => {
    try {
      setError(null);
      if (!code.trim()) {
        setError('Vui lòng nhập mã quy trình (VD: WF_EXPENSE, WF_LEAVE)');
        return;
      }
      if (!title.trim()) {
        setError('Vui lòng nhập tên quy trình phê duyệt');
        return;
      }
      if (steps.length === 0) {
        setError('Quy trình phải có ít nhất 1 bước phê duyệt');
        return;
      }

      setSaving(true);
      const res = await workflowTemplateService.createWorkflowTemplate({
        code: code.trim().toUpperCase(),
        title: title.trim(),
        description: description.trim() || null,
        category: category.trim() || 'Chung',
        steps,
      });

      router.push(`/workflows/${res.id}`);
    } catch (err: any) {
      setError(err.message || 'Lỗi khi lưu quy trình phê duyệt.');
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Top Navigation */}
        <div className="flex items-center justify-between">
          <Link
            href="/workflows"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Quay lại danh sách quy trình
          </Link>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSaveWorkflow}
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold shadow-xs disabled:opacity-50 transition-all cursor-pointer"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Đang lưu...' : 'Lưu quy trình bản nháp'}
            </button>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-3 text-rose-800 text-xs font-medium">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Main Grid: Left metadata & steps, Right visual flowchart */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Form Metadata Section */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <GitFork className="w-4 h-4 text-blue-600" />
                Thông tin chung quy trình
              </h2>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Mã quy trình (viết hoa, không dấu) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="VD: WF_PURCHASE_M3"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Tên quy trình phê duyệt <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="VD: Quy trình mua sắm máy chủ & phần cứng"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Danh mục phân loại
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="Chung">Chung</option>
                    <option value="Tài chính">Tài chính & Kế toán</option>
                    <option value="Nhân sự">Nhân sự & Hành chính</option>
                    <option value="Vận hành">Vận hành & Kỹ thuật</option>
                    <option value="Kinh doanh">Kinh doanh & Bán hàng</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Trạng thái ban đầu
                  </label>
                  <input
                    type="text"
                    disabled
                    value="Bản nháp (DRAFT v1)"
                    className="w-full px-3 py-2 text-sm border border-slate-200 bg-slate-100 rounded-lg text-slate-500 font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Mô tả mục đích áp dụng
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Mô tả phạm vi các loại hồ sơ áp dụng quy trình duyệt này..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </div>

            {/* Help & Guidelines Card */}
            <div className="bg-blue-50/70 border border-blue-200/80 rounded-2xl p-5 text-blue-950 space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-blue-900">
                <HelpCircle className="w-4 h-4 text-blue-700" />
                Hướng dẫn thiết kế quy trình
              </h4>
              <ul className="text-2xs space-y-1.5 text-blue-800 list-disc list-inside leading-relaxed">
                <li>Các bước duyệt được xử lý tuần tự (Sequential) theo thứ tự từ 1 đến N.</li>
                <li>Hỗ trợ 3 loại cấu hình: Theo chức vụ phòng ban, Theo lãnh đạo công ty, hoặc Chỉ định người cụ thể.</li>
                <li>Tùy chọn ALL (tất cả cùng duyệt) hoặc ANY (chỉ cần 1 người đồng ý).</li>
                <li>Quy trình sau khi phát hành sẽ tạo một snapshot bất biến đảm bảo giá trị pháp lý.</li>
              </ul>
            </div>
          </div>

          {/* Steps List Section */}
          <div className="lg:col-span-7 space-y-6">
            {/* Visual Flowchart Preview Banner */}
            <WorkflowChainPreview steps={steps} />

            {/* Steps Container */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-slate-700" />
                    Danh sách các bước phê duyệt ({steps.length} cấp)
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Kéo thả hoặc di chuyển thứ tự để sắp xếp trình tự phê duyệt
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleOpenAddModal}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100/80 text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Thêm bước duyệt
                </button>
              </div>

              {steps.length === 0 ? (
                <div className="py-12 text-center text-slate-400">
                  Chưa có bước duyệt nào. Bấm &quot;Thêm bước duyệt&quot; để bắt đầu.
                </div>
              ) : (
                <div className="space-y-3">
                  {steps.map((st, idx) => (
                    <WorkflowStepCard
                      key={st.stepKey || idx}
                      step={st}
                      index={idx}
                      totalSteps={steps.length}
                      onEdit={() => handleOpenEditModal(idx)}
                      onDelete={() => handleDeleteStep(idx)}
                      onMoveUp={() => handleMoveUp(idx)}
                      onMoveDown={() => handleMoveDown(idx)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Modal config step */}
        <WorkflowStepModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSaveStep}
          initialStep={editingStepIndex !== null ? steps[editingStepIndex] : null}
          existingKeys={steps.map((s) => s.stepKey)}
          currentOrder={editingStepIndex !== null ? editingStepIndex + 1 : steps.length + 1}
        />
      </div>
    </div>
  );
}
