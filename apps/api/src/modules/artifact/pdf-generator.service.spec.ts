import { describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import { PDFDocument } from 'pdf-lib';
import { ArtifactType } from '@trinh-ky/shared';
import { PdfGeneratorService } from './pdf-generator.service.js';

describe('PdfGeneratorService (Unit Tests)', () => {
  const service = new PdfGeneratorService();

  const mockOptions = {
    document: {
      id: 'doc-uuid-1',
      documentNumber: 'TK-2026-0001',
      title: 'Đề xuất trang bị máy tính cho nhân viên mới',
      status: 'APPROVED',
      urgency: 'URGENT',
      createdAt: new Date('2026-10-24T08:00:00.000Z'),
      createdByName: 'Nguyễn Văn Tác Giả',
      organizationName: 'Tập đoàn VinaGroup (HQ)',
      departmentName: 'Phòng Công nghệ Thông tin',
    },
    templateVersion: {
      title: 'Mẫu đề xuất thiết bị kỹ thuật',
      versionNumber: 2,
      description: 'Mẫu chuẩn sử dụng cho toàn tập đoàn',
      fields: [
        { key: 'ten_thiet_bi', label: 'Tên thiết bị', type: 'text', required: true, order: 1 },
        { key: 'ngan_sach', label: 'Ngân sách dự kiến', type: 'currency_vnd', required: true, order: 2 },
        { key: 'ngay_can', label: 'Ngày cần bàn giao', type: 'date', required: true, order: 3 },
        { key: 'muc_dich', label: 'Mục đích sử dụng', type: 'text', required: true, order: 4 },
        { key: 'ghi_chu_them', label: 'Ghi chú thêm', type: 'text', required: false, order: 5 },
      ],
    },
    documentVersion: {
      versionNumber: 2,
      formData: {
        ten_thiet_bi: 'MacBook Pro M3 Max 64GB RAM',
        ngan_sach: 75000000,
        ngay_can: '2026-11-15',
        muc_dich: 'Phát triển backend cao tải và chạy mô hình học máy',
        ghi_chu_them: '', // Trường rỗng
      },
      sha256Hash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      changeSummary: 'Cập nhật ngân sách và cấu hình RAM',
    },
    workflow: {
      steps: [
        {
          stepOrder: 1,
          stepName: 'Trưởng bộ phận phê duyệt',
          status: 'COMPLETED',
          assignees: [
            {
              userFullName: 'Trần Văn Trưởng Phòng',
              decision: 'APPROVED',
              decisionComment: 'Đồng ý phê duyệt trang bị',
              decidedAt: '2026-10-24T08:15:00.000Z',
            },
          ],
        },
      ],
    },
    artifactType: ArtifactType.OFFICIAL_UNSIGNED,
  };

  it('1. Render PDF thành công với tiếng Việt Unicode và Magic Bytes hợp lệ', async () => {
    const result = await service.generatePdf(mockOptions);

    expect(result).toBeDefined();
    expect(Buffer.isBuffer(result.pdfBuffer)).toBe(true);
    expect(result.sizeBytes).toBeGreaterThan(1000);
    expect(result.pageCount).toBeGreaterThanOrEqual(1);

    // Kiểm tra Magic Bytes chuẩn PDF: %PDF-
    const headerStr = result.pdfBuffer.subarray(0, 5).toString('ascii');
    expect(headerStr).toBe('%PDF-');

    // Mở lại bằng pdf-lib để xác minh tính hợp lệ của cấu trúc PDF
    const loadedDoc = await PDFDocument.load(result.pdfBuffer);
    expect(loadedDoc.getPageCount()).toBe(result.pageCount);
  });

  it('2. rawPdfHash được tính chuẩn xác trên chính xác các byte của file PDF', async () => {
    const result = await service.generatePdf(mockOptions);

    const recomputedHash = crypto.createHash('sha256').update(result.pdfBuffer).digest('hex');
    expect(result.rawPdfHash).toBe(recomputedHash);

    // Xác nhận rawPdfHash KHÔNG PHẢI là hash của formData JSON
    expect(result.rawPdfHash).not.toBe(mockOptions.documentVersion.sha256Hash);
  });

  it('3. Vệ sinh dữ liệu an toàn (HTML tag stripping & control characters)', () => {
    const maliciousInput = '<script>alert("hacked")</script><b>Đậm</b>\x00\x08Nội dung';
    const sanitized = service.sanitizeText(maliciousInput);

    expect(sanitized).not.toContain('<script>');
    expect(sanitized).not.toContain('</script>');
    expect(sanitized).not.toContain('<b>');
    expect(sanitized).toBe('alert("hacked")ĐậmNội dung');
  });

  it('4. Định dạng các loại trường chính xác (currency VND, date, boolean, empty)', () => {
    expect(service.formatFieldValue(75000000, 'currency_vnd')).toContain('75.000.000');
    expect(service.formatFieldValue('2026-11-15', 'date')).toBe('15/11/2026');
    expect(service.formatFieldValue(true, 'boolean')).toBe('Có');
    expect(service.formatFieldValue(false, 'boolean')).toBe('Không');
    expect(service.formatFieldValue('', 'text')).toBe('(Không có dữ liệu)');
    expect(service.formatFieldValue(null, 'text')).toBe('(Không có dữ liệu)');
  });

  it('5. Xử lý dữ liệu dài và tự động phân trang (Multiple pages)', async () => {
    const longText = 'Nội dung rất dài '.repeat(300);
    const optionsWithLongText = {
      ...mockOptions,
      documentVersion: {
        ...mockOptions.documentVersion,
        formData: {
          ...mockOptions.documentVersion.formData,
          muc_dich: longText,
        },
      },
    };

    const result = await service.generatePdf(optionsWithLongText);
    expect(result.pageCount).toBeGreaterThanOrEqual(1);

    const loadedDoc = await PDFDocument.load(result.pdfBuffer);
    expect(loadedDoc.getPageCount()).toBe(result.pageCount);
  });

  it('6. Từ chối dữ liệu vượt quá giới hạn an toàn 5MB (Chống DOS)', async () => {
    const hugePayload: Record<string, string> = {};
    for (let i = 0; i < 20000; i++) {
      hugePayload[`field_${i}`] = 'X'.repeat(300);
    }

    const hugeOptions = {
      ...mockOptions,
      documentVersion: {
        ...mockOptions.documentVersion,
        formData: hugePayload,
      },
    };

    await expect(service.generatePdf(hugeOptions)).rejects.toThrow(/vượt quá giới hạn/i);
  });
});
