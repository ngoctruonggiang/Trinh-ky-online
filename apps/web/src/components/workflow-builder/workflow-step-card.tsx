'use client';

import React from 'react';
import {
  ArrowDown,
  ArrowUp,
  Trash2,
  Edit2,
  Users,
  Building2,
  UserCheck,
  CheckCheck,
  User,
  Clock,
} from 'lucide-react';
import { WorkflowStepConfig, ApproverConfig } from '@trinh-ky/shared';

interface WorkflowStepCardProps {
  step: WorkflowStepConfig;
  index: number;
  totalSteps: number;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  readOnly?: boolean;
}

export function WorkflowStepCard({
  step,
  index,
  totalSteps,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  readOnly = false,
}: WorkflowStepCardProps) {
  const renderApproverBadge = (cfg: ApproverConfig) => {
    switch (cfg.type) {
      case 'SPECIFIC_USERS':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
            <User className="w-3.5 h-3.5" />
            Cá nhân chỉ định ({cfg.userIds?.length || 0} người)
          </span>
        );
      case 'DEPARTMENT_ROLE':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
            <Building2 className="w-3.5 h-3.5" />
            {cfg.role === 'MANAGER'
              ? 'Trưởng phòng'
              : cfg.role === 'ACCOUNTANT'
              ? 'Kế toán phòng'
              : cfg.role === 'DIRECTOR'
              ? 'Phụ trách phòng'
              : 'Admin phòng'}{' '}
            ({cfg.departmentPolicy === 'SPECIFIC_DEPARTMENT' ? 'Phòng ban cố định' : 'Cùng phòng hồ sơ'})
          </span>
        );
      case 'ORGANIZATION_ROLE':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200">
            <Users className="w-3.5 h-3.5" />
            {cfg.role === 'DIRECTOR'
              ? 'Ban Giám đốc công ty'
              : cfg.role === 'ACCOUNTANT'
              ? 'Kế toán trưởng công ty'
              : cfg.role === 'MANAGER'
              ? 'Cấp quản lý toàn công ty'
              : 'Quản trị viên công ty'}
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow relative">
      <div className="flex items-start justify-between gap-4">
        {/* Step Indicator & Info */}
        <div className="flex items-start gap-3 flex-1">
          <div className="w-8 h-8 rounded-full bg-slate-900 text-white font-bold text-xs flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
            {step.stepOrder}
          </div>

          <div className="flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold text-slate-800 text-sm">{step.stepName}</h4>
              <span className="text-2xs font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded border border-slate-200">
                {step.stepKey}
              </span>
            </div>

            {step.description && (
              <p className="text-xs text-slate-500 line-clamp-2">{step.description}</p>
            )}

            {/* Badges / Metadata */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {renderApproverBadge(step.approverConfig)}

              <span
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border ${
                  step.completionRule === 'ALL_MUST_APPROVE'
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    : 'bg-teal-50 text-teal-700 border-teal-200'
                }`}
              >
                {step.completionRule === 'ALL_MUST_APPROVE' ? (
                  <>
                    <CheckCheck className="w-3.5 h-3.5" />
                    Tất cả phải duyệt (ALL)
                  </>
                ) : (
                  <>
                    <UserCheck className="w-3.5 h-3.5" />
                    Bất kỳ ai duyệt là xong (ANY)
                  </>
                )}
              </span>

              {step.dueDays && (
                <span className="inline-flex items-center gap-1 text-xs text-slate-500 bg-slate-50 px-2 py-1 rounded border border-slate-200">
                  <Clock className="w-3 h-3 text-slate-400" />
                  Hạn xử lý: {step.dueDays} ngày
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        {!readOnly && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={index === 0}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg disabled:opacity-30 disabled:hover:bg-transparent"
              title="Di chuyển lên trên"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={index === totalSteps - 1}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg disabled:opacity-30 disabled:hover:bg-transparent"
              title="Di chuyển xuống dưới"
            >
              <ArrowDown className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"
              title="Chỉnh sửa cấu hình bước"
            >
              <Edit2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg"
              title="Xóa bước duyệt"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
