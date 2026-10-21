'use client';

import { Suspense, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Search,
  Filter,
  Plus,
  ArrowRight,
  Clock,
  FileText,
  FolderOpen,
  Layers,
} from 'lucide-react';
import { DocumentItem, DocumentStatus, UrgencyLevel } from '@/types/document';
import { mockDocumentService } from '@/services/api/mock-document-service';
import { StatusBadge, UrgencyBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export default function DocumentListPage() {
  return (
    <Suspense
      fallback={
        <div className="py-20 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-slate-200 border-t-blue-600 mb-3" />
          <div className="text-xs text-slate-500">Đang tải danh sách hồ sơ...</div>
        </div>
      }
    >
      <DocumentListContent />
    </Suspense>
  );
}

function DocumentListContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = (searchParams.get('tab') as 'pending_my_approval' | 'my_documents' | 'all') || 'pending_my_approval';

  const [activeTab, setActiveTab] = useState(tabParam);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setActiveTab(tabParam);
  }, [tabParam]);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    mockDocumentService
      .getDocuments(activeTab)
      .then((data) => {
        if (isMounted) {
          setDocuments(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error(err);
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [activeTab]);

  const handleTabChange = (tab: typeof activeTab) => {
    setActiveTab(tab);
    startTransition(() => {
      router.push(`/?tab=${tab}`);
    });
  };

  // Filter logic
  const filteredDocuments = documents.filter((doc) => {
    const matchesSearch =
      doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.documentNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.createdByName.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'ALL' || doc.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Page Title & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Quản lý Hồ sơ Trình ký
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Theo dõi, xử lý phê duyệt văn bản và lưu trữ hồ sơ điện tử của tập đoàn
          </p>
        </div>

        <Button
          variant="primary"
          icon={<Plus className="w-4 h-4" />}
          onClick={() => alert('Chức năng tạo hồ sơ mới từ biểu mẫu động sẽ hoàn thiện ở bước tiếp theo!')}
        >
          Tạo hồ sơ mới
        </Button>
      </div>

      {/* Tabs Bar */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => handleTabChange('pending_my_approval')}
          className={`flex items-center gap-2 pb-3 px-4 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'pending_my_approval'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Hồ sơ chờ tôi duyệt</span>
          <span className="ml-1 px-1.5 py-0.2 rounded-full text-2xs bg-blue-100 text-blue-700 font-bold">
            1
          </span>
        </button>

        <button
          onClick={() => handleTabChange('my_documents')}
          className={`flex items-center gap-2 pb-3 px-4 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'my_documents'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Hồ sơ của tôi</span>
        </button>

        <button
          onClick={() => handleTabChange('all')}
          className={`flex items-center gap-2 pb-3 px-4 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'all'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FolderOpen className="w-4 h-4" />
          <span>Tất cả hồ sơ công ty</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Tìm theo mã hồ sơ, tiêu đề, người tạo..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs text-slate-500">Trạng thái:</span>
          <select
            className="rounded-lg border border-slate-300 py-1.5 px-2.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="ALL">Tất cả trạng thái</option>
            <option value={DocumentStatus.IN_REVIEW}>Đang xử lý</option>
            <option value={DocumentStatus.REVISION_REQUESTED}>Cần chỉnh sửa</option>
            <option value={DocumentStatus.APPROVED}>Đã phê duyệt</option>
            <option value={DocumentStatus.REJECTED}>Đã từ chối</option>
            <option value={DocumentStatus.CANCELLED}>Đã hủy</option>
          </select>
        </div>
      </div>

      {/* Documents Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        {loading ? (
          <div className="py-16 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-slate-200 border-t-blue-600 mb-3" />
            <div className="text-xs text-slate-500">Đang tải danh sách hồ sơ...</div>
          </div>
        ) : filteredDocuments.length === 0 ? (
          <div className="py-16 text-center">
            <Layers className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <h3 className="text-sm font-semibold text-slate-700">Không tìm thấy hồ sơ nào</h3>
            <p className="text-xs text-slate-400 mt-1">
              Thử thay đổi từ khóa tìm kiếm hoặc bộ lọc trạng thái.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left">
              <thead className="bg-slate-50/80 text-2xs uppercase tracking-wider text-slate-500 font-semibold">
                <tr>
                  <th scope="col" className="px-5 py-3">Mã & Tiêu đề hồ sơ</th>
                  <th scope="col" className="px-4 py-3">Loại biểu mẫu</th>
                  <th scope="col" className="px-4 py-3">Người tạo</th>
                  <th scope="col" className="px-4 py-3">Tiến độ duyệt</th>
                  <th scope="col" className="px-4 py-3 text-center">Độ khẩn</th>
                  <th scope="col" className="px-4 py-3 text-center">Trạng thái</th>
                  <th scope="col" className="px-4 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                {filteredDocuments.map((doc) => (
                  <tr key={doc.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="font-semibold text-slate-900 line-clamp-1 hover:text-blue-600 transition-colors">
                        <Link href={`/documents/${doc.id}`}>{doc.title}</Link>
                      </div>
                      <div className="text-2xs text-slate-400 font-mono mt-0.5">
                        {doc.documentNumber}
                      </div>
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <span className="text-slate-600 font-medium">
                        {doc.templateTitle}
                      </span>
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <div className="text-slate-800 font-medium">{doc.createdByName}</div>
                      <div className="text-2xs text-slate-400">{doc.departmentName}</div>
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-slate-800">
                          Bước {doc.currentStepOrder}/{doc.totalSteps}:
                        </span>
                        <span className="text-slate-500 truncate max-w-[150px]">
                          {doc.currentStepName}
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap text-center">
                      <UrgencyBadge urgency={doc.urgency} />
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap text-center">
                      <StatusBadge status={doc.status} />
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap text-right">
                      <Link
                        href={`/documents/${doc.id}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors"
                      >
                        <span>Chi tiết</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
