'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Bell,
  ShieldCheck,
  CheckCheck,
  Clock,
  UserCheck,
  AlertTriangle,
  RotateCcw,
  CheckCircle,
  XCircle,
  FileText,
} from 'lucide-react';
import { InAppNotification } from '@/types/document';
import { notificationService } from '@/services/api';

export function Header() {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load unread count initially
  const loadUnreadCount = async () => {
    try {
      const count = await notificationService.getUnreadCount();
      setUnreadCount(count);
    } catch {
      // Ignore background error
    }
  };

  useEffect(() => {
    loadUnreadCount();
    const interval = setInterval(loadUnreadCount, 30000); // 30s poll
    return () => clearInterval(interval);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleToggle = async () => {
    const nextState = !isOpen;
    setIsOpen(nextState);
    if (nextState) {
      setLoading(true);
      try {
        const res = await notificationService.getNotifications();
        setNotifications(res.items);
        setUnreadCount(res.unreadCount);
      } catch {
        // Ignore fetch error
      } finally {
        setLoading(false);
      }
    }
  };

  const handleMarkAsRead = async (n: InAppNotification) => {
    if (!n.isRead) {
      try {
        await notificationService.markAsRead(n.id);
        setNotifications((prev) =>
          prev.map((item) => (item.id === n.id ? { ...item, isRead: true } : item))
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch {
        // Ignore error
      }
    }
    if (n.documentId) {
      setIsOpen(false);
      router.push(`/documents/${n.documentId}`);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationService.markAllAsRead();
      setNotifications((prev) => prev.map((item) => ({ ...item, isRead: true })));
      setUnreadCount(0);
    } catch {
      // Ignore error
    }
  };

  const renderIcon = (type: string) => {
    switch (type) {
      case 'ASSIGNED_STEP':
        return <Clock className="w-3.5 h-3.5 text-blue-600" />;
      case 'REASSIGNED_STEP':
        return <UserCheck className="w-3.5 h-3.5 text-indigo-600" />;
      case 'REVISION_REQUESTED':
        return <RotateCcw className="w-3.5 h-3.5 text-amber-600" />;
      case 'DOCUMENT_APPROVED':
        return <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />;
      case 'DOCUMENT_REJECTED':
        return <XCircle className="w-3.5 h-3.5 text-rose-600" />;
      case 'SLA_WARNING':
      case 'SLA_OVERDUE':
        return <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />;
      default:
        return <FileText className="w-3.5 h-3.5 text-slate-500" />;
    }
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200/80 px-8 flex items-center justify-between shrink-0 sticky top-0 z-30 shadow-2xs">
      <div className="flex items-center gap-3">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>Xác thực an toàn (Bearer JWT)</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Notification Bell & Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={handleToggle}
            className="relative p-2 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors"
            title="Thông báo"
            aria-label="Thông báo"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-blue-600 text-white text-3xs font-bold ring-2 ring-white">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {/* Dropdown Menu */}
          {isOpen && (
            <div className="absolute right-0 mt-2 w-80 md:w-96 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden z-50 text-xs">
              <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <div className="font-semibold text-slate-800 flex items-center gap-2">
                  <span>Thông báo hệ thống</span>
                  {unreadCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-bold text-3xs">
                      {unreadCount} chưa đọc
                    </span>
                  )}
                </div>
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    className="text-2xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    Đọc tất cả
                  </button>
                )}
              </div>

              <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                {loading ? (
                  <div className="py-8 text-center text-slate-400">Đang tải thông báo...</div>
                ) : notifications.length === 0 ? (
                  <div className="py-8 text-center text-slate-400">Không có thông báo nào.</div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => handleMarkAsRead(n)}
                      className={`p-3 cursor-pointer transition-colors flex items-start gap-2.5 ${
                        !n.isRead ? 'bg-blue-50/40 hover:bg-blue-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="mt-0.5 shrink-0 p-1 rounded bg-slate-100 border border-slate-200">
                        {renderIcon(n.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className={`truncate font-medium ${!n.isRead ? 'text-slate-900 font-semibold' : 'text-slate-700'}`}>
                            {n.title}
                          </span>
                          {!n.isRead && (
                            <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0" />
                          )}
                        </div>
                        <p className="text-2xs text-slate-500 line-clamp-2 mt-0.5">
                          {n.content}
                        </p>
                        <span className="text-3xs text-slate-400 mt-1 block">
                          {new Date(n.createdAt).toLocaleString('vi-VN')}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

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
