'use client';

import React from 'react';
import {
  ShieldCheck,
  Download,
  SearchCheck,
  Clock,
  Building2,
  FileCheck2,
  Lock,
  Layers,
} from 'lucide-react';
import { DocumentDetail } from '@/types/document';
import { PadesBadge } from '@/components/ui/badge';

interface PadesSealCardProps {
  document: DocumentDetail;
  onOpenLtv: () => void;
}

export function PadesSealCard({ document, onOpenLtv }: PadesSealCardProps) {
  const artifact = document.signedPdfArtifact;
  if (!artifact) return null;

  const padesLevel = artifact.padesLevel || (artifact.hasLtv ? 'PADES_B_LT' : artifact.hasTimestamp ? 'PADES_B_T' : 'PADES_B_B');
  const isBlt = padesLevel === 'PADES_B_LT';
  const isBt = padesLevel === 'PADES_B_T';

  return (
    <div className="bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-slate-50 rounded-xl border border-emerald-200/80 p-5 shadow-xs relative overflow-hidden">
      {/* Background Decorative Stamp Emblem */}
      <div className="absolute -right-6 -bottom-6 w-36 h-36 border-4 border-dashed border-emerald-500/15 rounded-full flex items-center justify-center pointer-events-none select-none">
        <div className="w-24 h-24 border border-emerald-500/20 rounded-full flex items-center justify-center text-emerald-600/20 font-serif font-black text-xs rotate-[-20deg]">
          PAdES B-LT
        </div>
      </div>

      <div className="relative space-y-4">
        {/* Header with Badges */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900 text-sm">
                  Con dấu Điện tử & Chữ ký số Mật mã
                </h3>
                <PadesBadge
                  level={padesLevel}
                  hasLtv={artifact.hasLtv}
                  hasTimestamp={artifact.hasTimestamp}
                />
              </div>
              <p className="text-2xs text-slate-500 mt-0.5">
                Chuẩn ISO 32000-1 / ETSI EN 319 142-1 (Bảo toàn pháp lý lâu dài)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-2xs font-semibold text-emerald-800 bg-emerald-100/80 px-2.5 py-1 rounded-md border border-emerald-200">
            <Lock className="w-3.5 h-3.5 text-emerald-700" />
            <span>Niêm phong toàn vẹn</span>
          </div>
        </div>

        {/* Key Verification Details Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1">
          {/* Signer Info */}
          <div className="p-3 bg-white/80 rounded-lg border border-slate-200/70 space-y-1">
            <div className="flex items-center gap-1.5 text-slate-400 text-2xs uppercase font-medium">
              <Building2 className="w-3.5 h-3.5 text-slate-500" />
              <span>Đơn vị / Người ký niêm phong</span>
            </div>
            <div className="font-semibold text-slate-800 text-xs truncate" title={artifact.signerSubject || artifact.signerName}>
              {artifact.signerName || document.organizationName || 'Tổ chức / Cơ quan Trình Ký'}
            </div>
            {artifact.signingTime && (
              <div className="text-2xs text-slate-500">
                Ký lúc: {new Date(artifact.signingTime).toLocaleString('vi-VN')}
              </div>
            )}
          </div>

          {/* Timestamping & LTV status */}
          <div className="p-3 bg-white/80 rounded-lg border border-slate-200/70 space-y-1">
            <div className="flex items-center gap-1.5 text-slate-400 text-2xs uppercase font-medium">
              <Clock className="w-3.5 h-3.5 text-teal-600" />
              <span>Dấu thời gian & Xác thực Dài hạn</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 text-2xs font-semibold ${artifact.hasTimestamp ? 'text-teal-700' : 'text-slate-400'}`}>
                {artifact.hasTimestamp ? '✓ RFC 3161 TSA' : 'Chưa có TSA'}
              </span>
              <span className="text-slate-300">•</span>
              <span className={`inline-flex items-center gap-1 text-2xs font-semibold ${artifact.hasLtv ? 'text-emerald-700' : 'text-slate-400'}`}>
                {artifact.hasLtv ? '✓ LTV / DSS Enabled' : 'Chưa nhúng LTV'}
              </span>
            </div>
            {artifact.hasLtv && (
              <div className="text-2xs text-slate-500 flex items-center gap-2 pt-0.5 font-mono">
                <span>{artifact.dssCertsCount || 0} Certs</span>
                <span>•</span>
                <span>{artifact.dssOcspsCount || 0} OCSPs</span>
                <span>•</span>
                <span>{artifact.dssCrlsCount || 0} CRLs</span>
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <a
            href={`/api/documents/${document.id}/pdf?type=SIGNED_PDF`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition-colors shadow-xs text-xs"
          >
            <Download className="w-4 h-4" />
            <span>Tải tệp PDF đã ký ({isBlt ? 'PAdES B-LT' : isBt ? 'PAdES B-T' : 'PAdES B-B'})</span>
          </a>

          <button
            onClick={onOpenLtv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-2xs text-xs"
          >
            <SearchCheck className="w-4 h-4 text-emerald-600" />
            <span>Thẩm định chi tiết LTV / DSS</span>
          </button>
        </div>
      </div>
    </div>
  );
}
