'use client';

import React from 'react';
import { Bell, ShieldCheck, User } from 'lucide-react';

export function Header() {
  return (
    <header className="h-16 bg-white border-b border-slate-200/80 px-8 flex items-center justify-between shrink-0 sticky top-0 z-30 shadow-2xs">
      <div className="flex items-center gap-3">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>Xác thực an toàn (Bearer JWT)</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Notification Bell */}
        <button
          className="relative p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          title="Thông báo"
        >
          <Bell className="w-4 h-4" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-blue-600 ring-2 ring-white" />
        </button>

        <div className="h-6 w-px bg-slate-200" />

        {/* User Info Avatar */}
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-xs font-semibold text-slate-800">
              Nguyễn Văn An
            </div>
            <div className="text-2xs text-slate-500">
              Trưởng phòng CNTT • VinaGroup HQ
            </div>
          </div>
          <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-xs border border-blue-200">
            A
          </div>
        </div>
      </div>
    </header>
  );
}
