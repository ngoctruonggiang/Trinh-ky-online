'use client';

import React from 'react';
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  Eye,
  UserCheck,
  RotateCcw,
} from 'lucide-react';
import {
  WorkflowStepView,
  StepStatus,
  AssigneeRole,
  AssigneeDecision,
  StepCompletionRule,
} from '@/types/document';
import { StatusBadge } from '@/components/ui/badge';

interface WorkflowStepperProps {
  steps: WorkflowStepView[];
  currentStepOrder: number;
}

export function WorkflowStepper({ steps, currentStepOrder }: WorkflowStepperProps) {
  return (
    <div className="flow-root">
      <ul role="list" className="-mb-8">
        {steps.map((step, stepIdx) => {
          const isLast = stepIdx === steps.length - 1;
          const isCurrent = step.stepOrder === currentStepOrder && step.status === StepStatus.IN_PROGRESS;
          const isCompleted = step.status === StepStatus.COMPLETED;
          const isRevision = step.status === StepStatus.REVISION_REQUESTED;
          const isRejected = step.status === StepStatus.REJECTED;

          return (
            <li key={step.id}>
              <div className="relative pb-8">
                {!isLast && (
                  <span
                    className={`absolute left-4 top-4 -ml-px h-full w-0.5 ${
                      isCompleted ? 'bg-emerald-500' : 'bg-slate-200'
                    }`}
                    aria-hidden="true"
                  />
                )}

                <div className="relative flex items-start space-x-3">
                  {/* Step Icon Badge */}
                  <div>
                    {isCompleted ? (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-white ring-4 ring-white shadow-xs">
                        <CheckCircle2 className="h-5 w-5" />
                      </span>
                    ) : isCurrent ? (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white ring-4 ring-blue-100 shadow-xs animate-pulse">
                        <Clock className="h-5 w-5" />
                      </span>
                    ) : isRevision ? (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500 text-white ring-4 ring-amber-100 shadow-xs">
                        <RotateCcw className="h-5 w-5" />
                      </span>
                    ) : isRejected ? (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-500 text-white ring-4 ring-rose-100 shadow-xs">
                        <XCircle className="h-5 w-5" />
                      </span>
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-400 border border-slate-300 ring-4 ring-white">
                        <span className="text-xs font-semibold">{step.stepOrder}</span>
                      </span>
                    )}
                  </div>

                  {/* Step Details Box */}
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">
                          Bước {step.stepOrder}: {step.stepName}
                        </span>
                        <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                          {step.completionRule === StepCompletionRule.ANY_CAN_APPROVE
                            ? 'Duyệt 1 trong nhiều người'
                            : 'Tất cả phải duyệt'}
                        </span>
                      </div>
                      <StatusBadge status={step.status} />
                    </div>

                    {/* Danh sách Assignees trong bước */}
                    <div className="mt-3 space-y-2">
                      {step.assignees.map((assignee) => {
                        const isReviewer = assignee.role === AssigneeRole.REVIEWER;
                        const hasDecided = assignee.decision !== AssigneeDecision.PENDING;

                        return (
                          <div
                            key={assignee.id}
                            className={`rounded-lg border p-3 text-xs transition-colors ${
                              hasDecided
                                ? 'bg-slate-50 border-slate-200'
                                : 'bg-white border-slate-200 shadow-2xs'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-2">
                                <div className="h-7 w-7 rounded-full bg-slate-200 text-slate-700 font-semibold flex items-center justify-center text-xs shrink-0">
                                  {assignee.userName.charAt(0)}
                                </div>
                                <div>
                                  <div className="font-medium text-slate-800">
                                    {assignee.userName}
                                  </div>
                                  <div className="text-slate-400 text-2xs">
                                    {assignee.userEmail}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                {isReviewer ? (
                                  <span className="inline-flex items-center gap-1 text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 text-2xs">
                                    <Eye className="w-3 h-3" /> Giám sát (Reviewer)
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 text-2xs">
                                    <UserCheck className="w-3 h-3" /> Người duyệt
                                  </span>
                                )}

                                {assignee.decision === AssigneeDecision.APPROVED && (
                                  <span className="text-emerald-700 font-medium bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                    ✓ Đã duyệt
                                  </span>
                                )}
                                {assignee.decision === AssigneeDecision.REJECTED && (
                                  <span className="text-rose-700 font-medium bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                                    ✗ Đã từ chối
                                  </span>
                                )}
                                {assignee.decision === AssigneeDecision.REVISION_REQUESTED && (
                                  <span className="text-amber-700 font-medium bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                    ✎ Yêu cầu sửa
                                  </span>
                                )}
                                {assignee.decision === AssigneeDecision.PENDING && (
                                  <span className="text-slate-400 italic">
                                    Đang chờ...
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Ý kiến ghi chú nếu có */}
                            {assignee.decisionComment && (
                              <div className="mt-2 text-slate-600 bg-white p-2 rounded border border-slate-200 text-xs">
                                <span className="font-medium text-slate-700">Ghi chú:</span>{' '}
                                {assignee.decisionComment}
                              </div>
                            )}

                            {assignee.decidedAt && (
                              <div className="mt-1 text-slate-400 text-2xs text-right">
                                Thời gian: {new Date(assignee.decidedAt).toLocaleString('vi-VN')}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
