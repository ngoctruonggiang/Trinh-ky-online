import React from 'react';
import { DocumentStatus, UrgencyLevel, StepStatus } from '@/types/document';

interface StatusBadgeProps {
  status: DocumentStatus | StepStatus;
  className?: string;
}

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  let label = status as string;
  let colorStyles = 'bg-slate-100 text-slate-700 border-slate-200';

  switch (status) {
    case DocumentStatus.DRAFT:
      label = 'Bản nháp';
      colorStyles = 'bg-slate-100 text-slate-700 border-slate-200';
      break;
    case DocumentStatus.SUBMITTED:
      label = 'Đã gửi duyệt';
      colorStyles = 'bg-blue-50 text-blue-700 border-blue-200';
      break;
    case DocumentStatus.IN_REVIEW:
    case StepStatus.IN_PROGRESS:
      label = 'Đang xử lý';
      colorStyles = 'bg-indigo-50 text-indigo-700 border-indigo-200';
      break;
    case DocumentStatus.REVISION_REQUESTED:
    case StepStatus.REVISION_REQUESTED:
      label = 'Cần chỉnh sửa';
      colorStyles = 'bg-amber-50 text-amber-700 border-amber-300';
      break;
    case DocumentStatus.APPROVED:
    case StepStatus.COMPLETED:
      label = 'Đã phê duyệt';
      colorStyles = 'bg-emerald-50 text-emerald-700 border-emerald-300';
      break;
    case DocumentStatus.REJECTED:
    case StepStatus.REJECTED:
      label = 'Đã từ chối';
      colorStyles = 'bg-rose-50 text-rose-700 border-rose-200';
      break;
    case DocumentStatus.CANCELLED:
    case StepStatus.CANCELLED:
      label = 'Đã hủy';
      colorStyles = 'bg-gray-100 text-gray-500 border-gray-200';
      break;
    case StepStatus.WAITING:
      label = 'Chờ xử lý';
      colorStyles = 'bg-slate-50 text-slate-500 border-slate-200';
      break;
  }

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${colorStyles} ${className}`}
    >
      <span className="w-1.5 h-1.5 mr-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}

interface UrgencyBadgeProps {
  urgency: UrgencyLevel;
  className?: string;
}

export function UrgencyBadge({ urgency, className = '' }: UrgencyBadgeProps) {
  let label = 'Bình thường';
  let styles = 'bg-slate-50 text-slate-600 border-slate-200';

  switch (urgency) {
    case UrgencyLevel.LOW:
      label = 'Thấp';
      styles = 'bg-slate-50 text-slate-500 border-slate-200';
      break;
    case UrgencyLevel.NORMAL:
      label = 'Bình thường';
      styles = 'bg-blue-50 text-blue-600 border-blue-200';
      break;
    case UrgencyLevel.URGENT:
      label = 'Gấp';
      styles = 'bg-orange-50 text-orange-700 border-orange-300 font-semibold';
      break;
    case UrgencyLevel.EMERGENCY:
      label = 'Hỏa tốc';
      styles = 'bg-red-50 text-red-700 border-red-300 font-bold animate-pulse';
      break;
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${styles} ${className}`}
    >
      {label}
    </span>
  );
}
