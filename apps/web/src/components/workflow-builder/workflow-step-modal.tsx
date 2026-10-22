'use client';

import React, { useState, useEffect } from 'react';
import { X, Check, AlertCircle, Users, Building, ShieldCheck } from 'lucide-react';
import { WorkflowStepConfig, ApproverType, ApproverRole, DepartmentPolicy } from '@trinh-ky/shared';

interface WorkflowStepModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (step: WorkflowStepConfig) => void;
  initialStep?: WorkflowStepConfig | null;
  existingKeys?: string[];
  currentOrder: number;
}

export function WorkflowStepModal({
  isOpen,
  onClose,
  onSave,
  initialStep,
  existingKeys = [],
  currentOrder,
}: WorkflowStepModalProps) {
  const [stepKey, setStepKey] = useState('');
  const [stepName, setStepName] = useState('');
  const [description, setDescription] = useState('');
  const [completionRule, setCompletionRule] = useState<'ALL_MUST_APPROVE' | 'ANY_CAN_APPROVE'>('ALL_MUST_APPROVE');
  const [dueDays, setDueDays] = useState<number | undefined>(undefined);

  // Approver config
  const [approverType, setApproverType] = useState<ApproverType>('DEPARTMENT_ROLE');
  const [approverRole, setApproverRole] = useState<ApproverRole>('MANAGER');
  const [departmentPolicy, setDepartmentPolicy] = useState<DepartmentPolicy>('SAME_AS_DOCUMENT');
  const [specificDepartmentId, setSpecificDepartmentId] = useState('');
  const [specificUserIdsText, setSpecificUserIdsText] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (initialStep) {
      setStepKey(initialStep.stepKey);
      setStepName(initialStep.stepName);
      setDescription(initialStep.description || '');
      setCompletionRule(initialStep.completionRule);
      setDueDays(initialStep.dueDays);
      setApproverType(initialStep.approverConfig.type);
      setApproverRole(initialStep.approverConfig.role || 'MANAGER');
      setDepartmentPolicy(initialStep.approverConfig.departmentPolicy || 'SAME_AS_DOCUMENT');
      setSpecificDepartmentId(initialStep.approverConfig.departmentId || '');
      setSpecificUserIdsText(initialStep.approverConfig.userIds?.join(', ') || '');
    } else {
      setStepKey(`step_${currentOrder}`);
      setStepName(`Bước ${currentOrder}: Phê duyệt`);
      setDescription('');
      setCompletionRule('ALL_MUST_APPROVE');
      setDueDays(undefined);
      setApproverType('DEPARTMENT_ROLE');
      setApproverRole('MANAGER');
      setDepartmentPolicy('SAME_AS_DOCUMENT');
      setSpecificDepartmentId('');
      setSpecificUserIdsText('');
    }
    setErrors({});
  }, [initialStep, isOpen, currentOrder]);

  if (!isOpen) return null;

  const validate = () => {
    const errs: Record<string, string> = {};

    if (!stepKey.trim()) {
      errs.stepKey = 'Mã bước (stepKey) không được để trống';
    } else if (!/^[a-zA-Z0-9_-]+$/.test(stepKey.trim())) {
      errs.stepKey = 'Mã bước chỉ được chứa chữ, số, gạch ngang và gạch dưới';
    } else {
      const isDuplicate = existingKeys.includes(stepKey.trim()) && (!initialStep || initialStep.stepKey !== stepKey.trim());
      if (isDuplicate) {
        errs.stepKey = 'Mã bước này đã tồn tại trong quy trình';
      }
    }

    if (!stepName.trim()) {
      errs.stepName = 'Tên bước duyệt không được để trống';
    }

    if (approverType === 'SPECIFIC_USERS') {
      const uids = specificUserIdsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (uids.length === 0) {
        errs.userIds = 'Vui lòng nhập ít nhất 1 mã người dùng (UserId)';
      }
    }

    if (approverType === 'DEPARTMENT_ROLE' && departmentPolicy === 'SPECIFIC_DEPARTMENT' && !specificDepartmentId.trim()) {
      errs.departmentId = 'Vui lòng nhập mã phòng ban áp dụng';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    let approverConfig: any = { type: approverType };

    if (approverType === 'SPECIFIC_USERS') {
      approverConfig.userIds = specificUserIdsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (approverType === 'DEPARTMENT_ROLE') {
      approverConfig.role = approverRole;
      approverConfig.departmentPolicy = departmentPolicy;
      if (departmentPolicy === 'SPECIFIC_DEPARTMENT' && specificDepartmentId.trim()) {
        approverConfig.departmentId = specificDepartmentId.trim();
      }
    } else if (approverType === 'ORGANIZATION_ROLE') {
      approverConfig.role = approverRole;
    }

    const stepResult: WorkflowStepConfig = {
      stepKey: stepKey.trim(),
      stepName: stepName.trim(),
      stepOrder: initialStep ? initialStep.stepOrder : currentOrder,
      stepType: 'SEQUENTIAL',
      completionRule,
      approverConfig,
      reviewerUserIds: [],
      dueDays: dueDays ? Number(dueDays) : undefined,
      description: description.trim() || undefined,
    };

    onSave(stepResult);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <div>
            <h3 className="text-base font-bold text-slate-800">
              {initialStep ? 'Chỉnh sửa bước phê duyệt' : `Thêm bước phê duyệt số ${currentOrder}`}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Cấu hình thông tin người duyệt và quy tắc hoàn thành bước
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Tên bước & StepKey */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Mã bước (stepKey) <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={stepKey}
                onChange={(e) => setStepKey(e.target.value)}
                placeholder="VD: step_manager, step_director"
                className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 font-mono ${
                  errors.stepKey
                    ? 'border-rose-300 focus:ring-rose-200'
                    : 'border-slate-300 focus:ring-blue-200 focus:border-blue-500'
                }`}
              />
              {errors.stepKey && (
                <p className="text-2xs text-rose-600 mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {errors.stepKey}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Tên hiển thị của bước <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={stepName}
                onChange={(e) => setStepName(e.target.value)}
                placeholder="VD: Trưởng bộ phận phê duyệt"
                className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 ${
                  errors.stepName
                    ? 'border-rose-300 focus:ring-rose-200'
                    : 'border-slate-300 focus:ring-blue-200 focus:border-blue-500'
                }`}
              />
              {errors.stepName && (
                <p className="text-2xs text-rose-600 mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {errors.stepName}
                </p>
              )}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Mô tả & Hướng dẫn cho người duyệt
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="VD: Kiểm tra tính hợp lệ của hóa đơn và đối soát ngân sách còn lại..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500"
            />
          </div>

          {/* Approver Resolution Type Selection */}
          <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 space-y-4">
            <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
              Cấu hình chỉ định người duyệt (Approver Resolution)
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <label
                className={`flex flex-col items-center justify-center p-3 rounded-xl border cursor-pointer transition-all ${
                  approverType === 'DEPARTMENT_ROLE'
                    ? 'bg-purple-50/80 border-purple-500 text-purple-900 shadow-sm'
                    : 'bg-white border-slate-200 hover:border-slate-300 text-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="approverType"
                  value="DEPARTMENT_ROLE"
                  checked={approverType === 'DEPARTMENT_ROLE'}
                  onChange={() => setApproverType('DEPARTMENT_ROLE')}
                  className="sr-only"
                />
                <Building className="w-5 h-5 mb-1.5 text-purple-600" />
                <span className="text-xs font-semibold text-center">Vai trò phòng ban</span>
                <span className="text-3xs text-slate-500 text-center mt-0.5">Theo phòng của hồ sơ</span>
              </label>

              <label
                className={`flex flex-col items-center justify-center p-3 rounded-xl border cursor-pointer transition-all ${
                  approverType === 'ORGANIZATION_ROLE'
                    ? 'bg-amber-50/80 border-amber-500 text-amber-900 shadow-sm'
                    : 'bg-white border-slate-200 hover:border-slate-300 text-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="approverType"
                  value="ORGANIZATION_ROLE"
                  checked={approverType === 'ORGANIZATION_ROLE'}
                  onChange={() => setApproverType('ORGANIZATION_ROLE')}
                  className="sr-only"
                />
                <ShieldCheck className="w-5 h-5 mb-1.5 text-amber-600" />
                <span className="text-xs font-semibold text-center">Toàn công ty</span>
                <span className="text-3xs text-slate-500 text-center mt-0.5">Giám đốc, Kế toán...</span>
              </label>

              <label
                className={`flex flex-col items-center justify-center p-3 rounded-xl border cursor-pointer transition-all ${
                  approverType === 'SPECIFIC_USERS'
                    ? 'bg-blue-50/80 border-blue-500 text-blue-900 shadow-sm'
                    : 'bg-white border-slate-200 hover:border-slate-300 text-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="approverType"
                  value="SPECIFIC_USERS"
                  checked={approverType === 'SPECIFIC_USERS'}
                  onChange={() => setApproverType('SPECIFIC_USERS')}
                  className="sr-only"
                />
                <Users className="w-5 h-5 mb-1.5 text-blue-600" />
                <span className="text-xs font-semibold text-center">Người dùng cụ thể</span>
                <span className="text-3xs text-slate-500 text-center mt-0.5">Chỉ định chính xác</span>
              </label>
            </div>

            {/* Dynamic Options based on Approver Type */}
            {approverType === 'DEPARTMENT_ROLE' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Vai trò / Chức vụ trong phòng
                  </label>
                  <select
                    value={approverRole}
                    onChange={(e) => setApproverRole(e.target.value as ApproverRole)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    <option value="MANAGER">Trưởng phòng (MANAGER)</option>
                    <option value="ACCOUNTANT">Kế toán phòng (ACCOUNTANT)</option>
                    <option value="DIRECTOR">Phụ trách khối (DIRECTOR)</option>
                    <option value="ADMIN">Quản trị viên (ADMIN)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Phạm vi phòng ban áp dụng
                  </label>
                  <select
                    value={departmentPolicy}
                    onChange={(e) => setDepartmentPolicy(e.target.value as DepartmentPolicy)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    <option value="SAME_AS_DOCUMENT">Cùng phòng ban với người tạo hồ sơ</option>
                    <option value="SPECIFIC_DEPARTMENT">Chỉ định phòng ban cụ thể</option>
                  </select>
                </div>

                {departmentPolicy === 'SPECIFIC_DEPARTMENT' && (
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Mã hoặc ID phòng ban cụ thể
                    </label>
                    <input
                      type="text"
                      value={specificDepartmentId}
                      onChange={(e) => setSpecificDepartmentId(e.target.value)}
                      placeholder="VD: IT, HR, ACCT hoặc UUID"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                    {errors.departmentId && (
                      <p className="text-2xs text-rose-600 mt-1">{errors.departmentId}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {approverType === 'ORGANIZATION_ROLE' && (
              <div className="pt-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Chức danh quản lý toàn công ty
                </label>
                <select
                  value={approverRole}
                  onChange={(e) => setApproverRole(e.target.value as ApproverRole)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <option value="DIRECTOR">Ban Giám đốc điều hành (DIRECTOR)</option>
                  <option value="ACCOUNTANT">Kế toán trưởng công ty (ACCOUNTANT)</option>
                  <option value="MANAGER">Cấp quản lý điều hành (MANAGER)</option>
                  <option value="ADMIN">Quản trị viên công ty (ADMIN)</option>
                </select>
                <p className="text-2xs text-slate-500 mt-1.5">
                  Hệ thống sẽ tự động quét danh sách nhân sự giữ chức danh này trong công ty tại thời điểm nộp hồ sơ.
                </p>
              </div>
            )}

            {approverType === 'SPECIFIC_USERS' && (
              <div className="pt-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Danh sách User ID chỉ định (cách nhau bởi dấu phẩy)
                </label>
                <input
                  type="text"
                  value={specificUserIdsText}
                  onChange={(e) => setSpecificUserIdsText(e.target.value)}
                  placeholder="VD: user-id-1, user-id-2"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 font-mono"
                />
                {errors.userIds && (
                  <p className="text-2xs text-rose-600 mt-1">{errors.userIds}</p>
                )}
                <p className="text-2xs text-slate-500 mt-1.5">
                  Lưu ý: Mọi user được chỉ định phải đang hoạt động (ACTIVE) trong hệ thống.
                </p>
              </div>
            )}
          </div>

          {/* Completion Rule & Due Days */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Quy tắc hoàn thành bước duyệt (Completion Rule)
              </label>
              <select
                value={completionRule}
                onChange={(e) => setCompletionRule(e.target.value as any)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                <option value="ALL_MUST_APPROVE">Tất cả người duyệt phải đồng ý (ALL)</option>
                <option value="ANY_CAN_APPROVE">1 người duyệt là hoàn thành bước (ANY)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Hạn xử lý bước duyệt (Số ngày)
              </label>
              <input
                type="number"
                min={1}
                max={365}
                value={dueDays || ''}
                onChange={(e) => setDueDays(e.target.value ? Number(e.target.value) : undefined)}
                placeholder="Không giới hạn"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200/70 rounded-lg transition-colors"
          >
            Hủy bỏ
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="px-5 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-sm transition-all"
          >
            {initialStep ? 'Lưu thay đổi' : 'Thêm bước duyệt'}
          </button>
        </div>
      </div>
    </div>
  );
}
