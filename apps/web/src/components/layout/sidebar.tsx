'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  FileText,
  Clock,
  FolderOpen,
  FileSignature,
  Building2,
  CheckCircle2,
  SlidersHorizontal,
} from 'lucide-react';

export function Sidebar() {
  const pathname = usePathname();

  const navigation = [
    {
      name: 'Chờ tôi duyệt',
      href: '/?tab=pending_my_approval',
      icon: Clock,
      badge: '1',
      badgeColor: 'bg-blue-600 text-white',
    },
    {
      name: 'Hồ sơ của tôi',
      href: '/?tab=my_documents',
      icon: FileText,
    },
    {
      name: 'Tất cả hồ sơ',
      href: '/?tab=all',
      icon: FolderOpen,
    },
  ];

  return (
    <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col shrink-0 min-h-screen border-r border-slate-800">
      {/* Brand Header */}
      <div className="h-16 flex items-center px-6 gap-3 border-b border-slate-800/80 bg-slate-950/40">
        <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold shadow-md shadow-blue-500/20">
          <FileSignature className="w-5 h-5" />
        </div>
        <div>
          <div className="text-sm font-bold text-white tracking-tight">TRÌNH KÝ ONLINE</div>
          <div className="text-2xs text-slate-400 font-medium tracking-wide">VINAGROUP ENTERPRISE</div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 py-6 px-3 space-y-1">
        <div className="px-3 mb-2 text-2xs font-semibold text-slate-500 uppercase tracking-wider">
          Quản lý quy trình
        </div>
        {navigation.map((item) => {
          const isActive = pathname === '/' || pathname.startsWith('/documents');
          const Icon = item.icon;

          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                item.name === 'Chờ tôi duyệt'
                  ? 'bg-blue-600/15 text-blue-400 font-semibold border border-blue-500/20'
                  : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.name}</span>
              </div>
              {item.badge && (
                <span className={`px-1.5 py-0.5 rounded-full text-2xs font-bold ${item.badgeColor}`}>
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}

        <div className="pt-6 px-3 mb-2 text-2xs font-semibold text-slate-500 uppercase tracking-wider">
          Quản trị hệ thống
        </div>
        <div className="flex items-center gap-3 px-3 py-2 text-xs text-slate-500 cursor-not-allowed">
          <SlidersHorizontal className="w-4 h-4 shrink-0" />
          <span>Biểu mẫu & FSM (Sắp ra mắt)</span>
        </div>
      </div>

      {/* Bottom Company Info */}
      <div className="p-4 border-t border-slate-800/80 bg-slate-950/20 text-xs">
        <div className="flex items-center gap-2 text-slate-400 mb-1">
          <Building2 className="w-3.5 h-3.5 text-blue-400" />
          <span className="font-medium text-slate-300">Công ty thành viên:</span>
        </div>
        <div className="text-2xs text-slate-400 bg-slate-800/60 px-2 py-1 rounded border border-slate-700/60 truncate">
          VinaGroup HQ (Mã: VGR-HQ)
        </div>
        <div className="mt-2 text-3xs text-slate-500 flex items-center justify-between">
          <span>Phiên bản: Phase 8 (Clean FSM)</span>
          <span className="text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="w-2.5 h-2.5" /> 56 Tests
          </span>
        </div>
      </div>
    </aside>
  );
}
