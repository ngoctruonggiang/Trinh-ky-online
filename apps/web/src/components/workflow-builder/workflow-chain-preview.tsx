'use client';

import React from 'react';
import {
  ArrowRight,
  ArrowDown,
  CheckCircle2,
  FileText,
  Users,
  Building2,
  ShieldCheck,
  CheckCheck,
  UserCheck,
} from 'lucide-react';
import { WorkflowStepConfig, ApproverConfig } from '@trinh-ky/shared';

interface WorkflowChainPreviewProps {
  steps: WorkflowStepConfig[];
}

export function WorkflowChainPreview({ steps }: WorkflowChainPreviewProps) {
  if (!steps || steps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-slate-50 border border-dashed border-slate-300 rounded-xl text-center">
        <FileText className="w-10 h-10 text-slate-300 mb-2" />
        <p className="text-sm font-medium text-slate-600">Chưa có bước duyệt nào được định cấu hình</p>
        <p className="text-xs text-slate-400 mt-1">
          Bấm &quot;Thêm bước phê duyệt&quot; để thiết lập sơ đồ quy trình động.
        </p>
      </div>
    );
  }

  const renderApproverText = (cfg: ApproverConfig) => {
    switch (cfg.type) {
      case 'SPECIFIC_USERS':
        return `${cfg.userIds?.length || 0} người chỉ định`;
      case 'DEPARTMENT_ROLE':
        return cfg.role === 'MANAGER'
          ? 'Trưởng phòng'
          : cfg.role === 'ACCOUNTANT'
          ? 'Kế toán phòng'
          : cfg.role === 'DIRECTOR'
          ? 'Phụ trách phòng'
          : 'Admin phòng';
      case 'ORGANIZATION_ROLE':
        return cfg.role === 'DIRECTOR'
          ? 'Ban Giám đốc'
          : cfg.role === 'ACCOUNTANT'
          ? 'Kế toán trưởng'
          : 'Cấp quản lý';
      default:
        return 'Chưa cấu hình';
    }
  };

  return (
    <div className="bg-slate-900 rounded-2xl p-6 text-white shadow-xl overflow-hidden relative">
      <div className="flex items-center justify-between mb-6 border-b border-slate-800 pb-4">
        <div>
          <h3 className="text-sm font-bold tracking-wide uppercase text-slate-300 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Sơ đồ luồng phê duyệt trực quan (Visual Flowchart)
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Quy trình tuần tự gồm {steps.length} cấp phê duyệt
          </p>
        </div>
        <span className="text-xs font-mono bg-slate-800 px-3 py-1 rounded-full text-slate-300 border border-slate-700">
          Chế độ tuần tự (Sequential)
        </span>
      </div>

      {/* Horizontal Chain for desktop, vertical for mobile */}
      <div className="flex flex-col md:flex-row items-center justify-start gap-3 overflow-x-auto py-2">
        {/* Node Bắt đầu */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex flex-col items-center justify-center w-28 h-24 rounded-xl bg-slate-800/90 border border-slate-700 p-2 text-center shadow-md">
            <div className="w-7 h-7 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center mb-1.5">
              <FileText className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs font-bold text-slate-200">Khởi tạo</span>
            <span className="text-3xs text-slate-400">Nộp hồ sơ</span>
          </div>

          <div className="text-slate-600 hidden md:block">
            <ArrowRight className="w-5 h-5 animate-pulse text-slate-500" />
          </div>
          <div className="text-slate-600 md:hidden my-1">
            <ArrowDown className="w-5 h-5 animate-pulse text-slate-500" />
          </div>
        </div>

        {/* Step Nodes */}
        {steps.map((st, idx) => (
          <React.Fragment key={st.stepKey || idx}>
            <div className="flex items-center gap-3 shrink-0">
              <div className="flex flex-col justify-between w-48 h-28 rounded-xl bg-gradient-to-b from-slate-800 to-slate-800/80 border border-slate-700/80 p-3 shadow-md hover:border-slate-500 transition-all group">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-bold text-2xs flex items-center justify-center">
                      {st.stepOrder}
                    </span>
                    <span className="text-2xs font-mono text-slate-400 truncate max-w-[90px]">
                      {st.stepKey}
                    </span>
                  </div>
                  <span
                    className={`text-3xs font-semibold px-1.5 py-0.5 rounded border ${
                      st.completionRule === 'ALL_MUST_APPROVE'
                        ? 'bg-indigo-950 text-indigo-300 border-indigo-800'
                        : 'bg-teal-950 text-teal-300 border-teal-800'
                    }`}
                  >
                    {st.completionRule === 'ALL_MUST_APPROVE' ? 'ALL' : 'ANY'}
                  </span>
                </div>

                <div className="my-1">
                  <h4 className="text-xs font-bold text-slate-100 line-clamp-1 group-hover:text-blue-300 transition-colors">
                    {st.stepName}
                  </h4>
                </div>

                <div className="flex items-center justify-between text-2xs text-slate-400 pt-1 border-t border-slate-700/60">
                  <span className="truncate flex items-center gap-1">
                    {st.approverConfig.type === 'DEPARTMENT_ROLE' && <Building2 className="w-3 h-3 text-purple-400" />}
                    {st.approverConfig.type === 'ORGANIZATION_ROLE' && <ShieldCheck className="w-3 h-3 text-amber-400" />}
                    {st.approverConfig.type === 'SPECIFIC_USERS' && <Users className="w-3 h-3 text-blue-400" />}
                    {renderApproverText(st.approverConfig)}
                  </span>
                </div>
              </div>

              {/* Arrow */}
              <div className="text-slate-600 hidden md:block">
                <ArrowRight className="w-5 h-5 text-slate-500" />
              </div>
              <div className="text-slate-600 md:hidden my-1">
                <ArrowDown className="w-5 h-5 text-slate-500" />
              </div>
            </div>
          </React.Fragment>
        ))}

        {/* Node Hoàn tất */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex flex-col items-center justify-center w-28 h-24 rounded-xl bg-emerald-950/40 border border-emerald-700/50 p-2 text-center shadow-md">
            <div className="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-1.5">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-emerald-300">Hoàn tất</span>
            <span className="text-3xs text-emerald-400/80">Ban hành hồ sơ</span>
          </div>
        </div>
      </div>
    </div>
  );
}
