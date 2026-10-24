import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import * as fontkitModule from '@pdf-lib/fontkit';
import { ArtifactType } from '@trinh-ky/shared';

export interface GeneratePdfOptions {
  document: {
    id: string;
    documentNumber: string;
    title: string;
    status: string;
    urgency: string;
    createdAt: Date | string;
    createdByName?: string;
    organizationName?: string;
    departmentName?: string;
  };
  templateVersion: {
    title: string;
    versionNumber: number;
    description?: string | null;
    fields: Array<{
      key: string;
      label: string;
      type: string;
      required?: boolean;
      order?: number;
    }>;
  };
  documentVersion: {
    versionNumber: number;
    formData: Record<string, any>;
    sha256Hash: string; // formDataHash
    changeSummary?: string | null;
  };
  workflow?: {
    steps: Array<{
      stepOrder: number;
      stepName: string;
      status: string;
      assignees: Array<{
        userFullName: string;
        decision: string;
        decisionComment?: string | null;
        decidedAt?: string | null;
      }>;
    }>;
  } | null;
  artifactType: ArtifactType;
}

export interface GeneratedPdfResult {
  pdfBuffer: Buffer;
  rawPdfHash: string;
  sizeBytes: number;
  pageCount: number;
}

@Injectable()
export class PdfGeneratorService {
  private regularFontBytes: Buffer | null = null;
  private boldFontBytes: Buffer | null = null;

  constructor() {
    this.loadFonts();
  }

  private loadFonts(): void {
    const candidateRegularPaths = [
      path.join(process.cwd(), 'apps', 'api', 'assets', 'fonts', 'Roboto-Regular.ttf'),
      path.join(process.cwd(), 'assets', 'fonts', 'Roboto-Regular.ttf'),
      'C:/Windows/Fonts/arial.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ];

    const candidateBoldPaths = [
      path.join(process.cwd(), 'apps', 'api', 'assets', 'fonts', 'Roboto-Bold.ttf'),
      path.join(process.cwd(), 'assets', 'fonts', 'Roboto-Bold.ttf'),
      'C:/Windows/Fonts/arialbd.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    ];

    for (const p of candidateRegularPaths) {
      if (fs.existsSync(p)) {
        try {
          this.regularFontBytes = fs.readFileSync(p);
          break;
        } catch {}
      }
    }

    for (const p of candidateBoldPaths) {
      if (fs.existsSync(p)) {
        try {
          this.boldFontBytes = fs.readFileSync(p);
          break;
        } catch {}
      }
    }
  }

  /**
   * Vệ sinh dữ liệu văn bản: loại bỏ thẻ HTML, ký tự điều khiển nguy hiểm
   */
  public sanitizeText(input: any): string {
    if (input === null || input === undefined) {
      return '';
    }
    const str = String(input);
    // Loại bỏ thẻ HTML (nếu có ai truyền <script> hoặc html injection)
    return str
      .replace(/<[^>]*>/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // Loại bỏ ký tự điều khiển ASCII
      .trim();
  }

  /**
   * Định dạng giá trị hiển thị theo loại trường
   */
  public formatFieldValue(value: any, type: string): string {
    if (value === null || value === undefined || value === '') {
      return '(Không có dữ liệu)';
    }

    switch (type) {
      case 'currency_vnd': {
        const num = Number(value);
        if (!isNaN(num)) {
          return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(num);
        }
        return `${this.sanitizeText(value)} VNĐ`;
      }
      case 'date': {
        const d = new Date(value);
        if (!isNaN(d.getTime())) {
          const day = String(d.getDate()).padStart(2, '0');
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const year = d.getFullYear();
          return `${day}/${month}/${year}`;
        }
        return this.sanitizeText(value);
      }
      case 'boolean': {
        return value === true || value === 'true' || value === 1 ? 'Có' : 'Không';
      }
      case 'number': {
        const num = Number(value);
        return !isNaN(num) ? new Intl.NumberFormat('vi-VN').format(num) : this.sanitizeText(value);
      }
      default:
        return this.sanitizeText(value);
    }
  }

  /**
   * Kết xuất PDF chuẩn hóa, bất biến từ dữ liệu DocumentVersion đã xác thực
   */
  async generatePdf(options: GeneratePdfOptions): Promise<GeneratedPdfResult> {
    const startTime = Date.now();

    // 1. Kiểm tra kích thước payload dữ liệu (chống DOS)
    const payloadStr = JSON.stringify(options.documentVersion.formData || {});
    if (payloadStr.length > 5 * 1024 * 1024) {
      throw new BadRequestException('Kích thước dữ liệu biểu mẫu vượt quá giới hạn an toàn 5MB.');
    }

    try {
      const pdfDoc = await PDFDocument.create();
      const fkAny = fontkitModule as any;
      const fkInstance: any =
        typeof fkAny?.default?.create === 'function'
          ? fkAny.default
          : typeof fkAny?.create === 'function'
          ? fkAny
          : typeof fkAny?.default === 'function' || (fkAny?.default && typeof fkAny.default === 'object')
          ? fkAny.default
          : fkAny;
      pdfDoc.registerFontkit(fkInstance);

      // Nạp font chữ tiếng Việt
      if (!this.regularFontBytes) {
        this.loadFonts();
      }
      if (!this.regularFontBytes) {
        throw new InternalServerErrorException(
          'Không tìm thấy font chữ TrueType tiếng Việt trên hệ thống để kết xuất PDF.'
        );
      }

      const regularFont = await pdfDoc.embedFont(this.regularFontBytes);
      const boldFont = this.boldFontBytes ? await pdfDoc.embedFont(this.boldFontBytes) : regularFont;

      // Kích thước chuẩn A4: 595.28 x 841.89 points
      const pageWidth = 595.28;
      const pageHeight = 841.89;
      const margin = 45;
      const contentWidth = pageWidth - margin * 2;

      let currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
      let y = pageHeight - margin;

      const checkPageOverflow = (requiredHeight: number): void => {
        if (y - requiredHeight < margin + 40) {
          currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
          y = pageHeight - margin;
          // Vẽ tiêu đề rút gọn trên trang kế
          currentPage.drawText(`Số: ${options.document.documentNumber} (tiếp theo)`, {
            x: margin,
            y,
            size: 8,
            font: regularFont,
            color: rgb(0.5, 0.5, 0.5),
          });
          y -= 25;
        }
      };

      // =========================================================================
      // A. HEADER QUỐC GIA & THÔNG TIN DOANH NGHIỆP
      // =========================================================================
      const nationalHeader1 = 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM';
      const nationalHeader2 = 'Độc lập - Tự do - Hạnh phúc';
      const orgName = (options.document.organizationName || 'TẬP ĐOÀN DOANH NGHIỆP').toUpperCase();
      const deptName = options.document.departmentName || 'Hệ thống Trình ký Online';

      // Cột trái: Tên cơ quan / doanh nghiệp
      currentPage.drawText(orgName, {
        x: margin,
        y,
        size: 9.5,
        font: boldFont,
        color: rgb(0.1, 0.1, 0.1),
      });
      currentPage.drawText(deptName, {
        x: margin,
        y: y - 14,
        size: 8.5,
        font: regularFont,
        color: rgb(0.3, 0.3, 0.3),
      });
      currentPage.drawText(`Số: ${options.document.documentNumber}`, {
        x: margin,
        y: y - 28,
        size: 8.5,
        font: regularFont,
        color: rgb(0.2, 0.2, 0.2),
      });

      // Cột phải: Quốc hiệu & Tiêu ngữ
      const qhWidth = boldFont.widthOfTextAtSize(nationalHeader1, 9.5);
      const tnWidth = boldFont.widthOfTextAtSize(nationalHeader2, 9.5);
      const rightX = pageWidth - margin - qhWidth;

      currentPage.drawText(nationalHeader1, {
        x: rightX,
        y,
        size: 9.5,
        font: boldFont,
        color: rgb(0.1, 0.1, 0.1),
      });
      currentPage.drawText(nationalHeader2, {
        x: pageWidth - margin - tnWidth - (qhWidth - tnWidth) / 2,
        y: y - 14,
        size: 9.5,
        font: boldFont,
        color: rgb(0.1, 0.1, 0.1),
      });

      // Đường kẻ gạch chân tiêu ngữ
      const lineY = y - 20;
      currentPage.drawLine({
        start: { x: pageWidth - margin - qhWidth + 30, y: lineY },
        end: { x: pageWidth - margin - 30, y: lineY },
        thickness: 0.75,
        color: rgb(0.2, 0.2, 0.2),
      });

      const docDate = new Date(options.document.createdAt);
      const dateStr = `Hà Nội, ngày ${docDate.getDate()} tháng ${docDate.getMonth() + 1} năm ${docDate.getFullYear()}`;
      const dateWidth = regularFont.widthOfTextAtSize(dateStr, 8.5);
      currentPage.drawText(dateStr, {
        x: pageWidth - margin - dateWidth,
        y: y - 32,
        size: 8.5,
        font: regularFont,
        color: rgb(0.3, 0.3, 0.3),
      });

      y -= 50;

      // =========================================================================
      // B. BANNER CẢNH BÁO TRẠNG THÁI / DỰ THẢO (WATERMARK BANNER)
      // =========================================================================
      const isPreview = options.artifactType === ArtifactType.PREVIEW;
      const bannerBgColor = isPreview ? rgb(0.98, 0.95, 0.88) : rgb(0.92, 0.95, 0.98);
      const bannerBorderColor = isPreview ? rgb(0.9, 0.75, 0.4) : rgb(0.5, 0.7, 0.9);
      const bannerTextColor = isPreview ? rgb(0.65, 0.4, 0.05) : rgb(0.1, 0.35, 0.65);

      const bannerText = isPreview
        ? 'BẢN XEM TRƯỚC (DRAFT PREVIEW) — CHƯA PHÊ DUYỆT CHÍNH THỨC'
        : 'VĂN BẢN CHÍNH THỨC — BẢN GỐC CHƯA KÝ SỐ MẬT MÃ (PHASE 13.1)';

      currentPage.drawRectangle({
        x: margin,
        y: y - 18,
        width: contentWidth,
        height: 22,
        color: bannerBgColor,
        borderColor: bannerBorderColor,
        borderWidth: 1,
      });

      const bannerTextWidth = boldFont.widthOfTextAtSize(bannerText, 8.5);
      currentPage.drawText(bannerText, {
        x: margin + (contentWidth - bannerTextWidth) / 2,
        y: y - 12,
        size: 8.5,
        font: boldFont,
        color: bannerTextColor,
      });

      y -= 38;

      // =========================================================================
      // C. TIÊU ĐỀ TÀI LIỆU (DOCUMENT TITLE)
      // =========================================================================
      const titleText = this.sanitizeText(options.document.title).toUpperCase();
      const titleWidth = boldFont.widthOfTextAtSize(titleText, 14);
      currentPage.drawText(titleText, {
        x: Math.max(margin, (pageWidth - titleWidth) / 2),
        y,
        size: 14,
        font: boldFont,
        color: rgb(0.05, 0.1, 0.25),
      });
      y -= 18;

      const subTitle = `Biểu mẫu: ${options.templateVersion.title} (Phiên bản v${options.templateVersion.versionNumber} | Hồ sơ v${options.documentVersion.versionNumber})`;
      const subTitleWidth = regularFont.widthOfTextAtSize(subTitle, 9);
      currentPage.drawText(subTitle, {
        x: Math.max(margin, (pageWidth - subTitleWidth) / 2),
        y,
        size: 9,
        font: regularFont,
        color: rgb(0.4, 0.4, 0.4),
      });
      y -= 30;

      // =========================================================================
      // D. NỘI DUNG BIỂU MẪU (FORM DATA FIELDS TABLE)
      // =========================================================================
      checkPageOverflow(30);
      currentPage.drawText('I. NỘI DUNG CHI TIẾT ĐỀ NGHỊ', {
        x: margin,
        y,
        size: 10.5,
        font: boldFont,
        color: rgb(0.1, 0.2, 0.4),
      });
      y -= 14;

      const fields = [...options.templateVersion.fields].sort((a, b) => (a.order || 0) - (b.order || 0));
      const formData = options.documentVersion.formData || {};

      for (const field of fields) {
        const rawValue = formData[field.key];
        const formattedValue = this.formatFieldValue(rawValue, field.type);
        const labelText = `${field.label}:`;

        // Tính toán ngắt dòng nếu nội dung dài
        const maxTextWidth = contentWidth - 160;
        const valueWords = formattedValue.split(' ');
        const lines: string[] = [];
        let currentLine = '';

        for (const word of valueWords) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const w = regularFont.widthOfTextAtSize(testLine, 9.5);
          if (w < maxTextWidth) {
            currentLine = testLine;
          } else {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
          }
        }
        if (currentLine) lines.push(currentLine);
        if (lines.length === 0) lines.push('(Trống)');

        const rowHeight = Math.max(22, lines.length * 14 + 8);
        checkPageOverflow(rowHeight);

        // Nền xen kẽ hàng
        currentPage.drawRectangle({
          x: margin,
          y: y - rowHeight + 6,
          width: contentWidth,
          height: rowHeight,
          color: rgb(0.98, 0.98, 0.99),
          borderColor: rgb(0.9, 0.9, 0.92),
          borderWidth: 0.5,
        });

        // Nhãn trường (Label)
        currentPage.drawText(labelText, {
          x: margin + 8,
          y: y - 10,
          size: 9.5,
          font: boldFont,
          color: rgb(0.15, 0.15, 0.15),
        });

        // Giá trị trường (Value - hỗ trợ đa dòng)
        let lineY = y - 10;
        for (const line of lines) {
          currentPage.drawText(line, {
            x: margin + 155,
            y: lineY,
            size: 9.5,
            font: regularFont,
            color: rgb(0.1, 0.1, 0.1),
          });
          lineY -= 14;
        }

        y -= rowHeight;
      }

      y -= 20;

      // =========================================================================
      // E. TIẾN TRÌNH DUYỆT & LỊCH SỬ KIỂM TOÁN (APPROVAL WORKFLOW TRAIL)
      // =========================================================================
      const workflowSteps = options.workflow?.steps || [];
      if (workflowSteps.length > 0) {
        checkPageOverflow(40);
        currentPage.drawText('II. TIẾN TRÌNH PHÊ DUYỆT QUY TRÌNH', {
          x: margin,
          y,
          size: 10.5,
          font: boldFont,
          color: rgb(0.1, 0.2, 0.4),
        });
        y -= 16;

        // Header bảng quy trình
        currentPage.drawRectangle({
          x: margin,
          y: y - 16,
          width: contentWidth,
          height: 18,
          color: rgb(0.9, 0.92, 0.95),
          borderColor: rgb(0.75, 0.8, 0.85),
          borderWidth: 0.5,
        });

        currentPage.drawText('Bước duyệt', { x: margin + 8, y: y - 12, size: 8.5, font: boldFont });
        currentPage.drawText('Người duyệt', { x: margin + 140, y: y - 12, size: 8.5, font: boldFont });
        currentPage.drawText('Trạng thái / Quyết định', { x: margin + 260, y: y - 12, size: 8.5, font: boldFont });
        currentPage.drawText('Thời điểm', { x: margin + 390, y: y - 12, size: 8.5, font: boldFont });
        y -= 20;

        for (const step of workflowSteps) {
          const assignees = step.assignees || [];
          for (const asg of assignees) {
            checkPageOverflow(20);
            let decisionLabel = 'Đang chờ xử lý';
            let decisionColor = rgb(0.5, 0.5, 0.5);

            if (asg.decision === 'APPROVED') {
              decisionLabel = 'ĐỒNG Ý (APPROVED)';
              decisionColor = rgb(0.05, 0.5, 0.15);
            } else if (asg.decision === 'REJECTED') {
              decisionLabel = 'TỪ CHỐI (REJECTED)';
              decisionColor = rgb(0.75, 0.1, 0.1);
            } else if (asg.decision === 'REVISION_REQUESTED') {
              decisionLabel = 'YÊU CẦU SỬA';
              decisionColor = rgb(0.8, 0.45, 0.05);
            }

            const decidedDateStr = asg.decidedAt
              ? new Date(asg.decidedAt).toLocaleString('vi-VN', { hour12: false })
              : '---';

            currentPage.drawRectangle({
              x: margin,
              y: y - 14,
              width: contentWidth,
              height: 18,
              borderColor: rgb(0.9, 0.9, 0.92),
              borderWidth: 0.5,
            });

            currentPage.drawText(this.sanitizeText(step.stepName).slice(0, 25), {
              x: margin + 8,
              y: y - 10,
              size: 8.5,
              font: regularFont,
            });
            currentPage.drawText(this.sanitizeText(asg.userFullName).slice(0, 22), {
              x: margin + 140,
              y: y - 10,
              size: 8.5,
              font: regularFont,
            });
            currentPage.drawText(decisionLabel, {
              x: margin + 260,
              y: y - 10,
              size: 8.5,
              font: boldFont,
              color: decisionColor,
            });
            currentPage.drawText(decidedDateStr, {
              x: margin + 390,
              y: y - 10,
              size: 8,
              font: regularFont,
              color: rgb(0.3, 0.3, 0.3),
            });

            y -= 18;
          }
        }
      }

      y -= 25;

      // =========================================================================
      // F. KHU VỰC CHỮ KÝ TRỰC QUAN (VISUAL SIGNATURE BLOCK)
      // =========================================================================
      checkPageOverflow(85);
      const colWidth = contentWidth / 3;

      // Người lập biểu
      currentPage.drawText('NGƯỜI LẬP BIỂU', {
        x: margin + (colWidth - boldFont.widthOfTextAtSize('NGƯỜI LẬP BIỂU', 9.5)) / 2,
        y,
        size: 9.5,
        font: boldFont,
      });
      currentPage.drawText('(Ký, ghi rõ họ tên)', {
        x: margin + (colWidth - regularFont.widthOfTextAtSize('(Ký, ghi rõ họ tên)', 8)) / 2,
        y: y - 12,
        size: 8,
        font: regularFont,
        color: rgb(0.4, 0.4, 0.4),
      });

      // Trưởng bộ phận
      currentPage.drawText('TRƯỞNG BỘ PHẬN', {
        x: margin + colWidth + (colWidth - boldFont.widthOfTextAtSize('TRƯỞNG BỘ PHẬN', 9.5)) / 2,
        y,
        size: 9.5,
        font: boldFont,
      });
      currentPage.drawText('(Xem xét & ký duyệt)', {
        x: margin + colWidth + (colWidth - regularFont.widthOfTextAtSize('(Xem xét & ký duyệt)', 8)) / 2,
        y: y - 12,
        size: 8,
        font: regularFont,
        color: rgb(0.4, 0.4, 0.4),
      });

      // Ban Giám đốc / Lãnh đạo
      currentPage.drawText('BAN GIÁM ĐỐC', {
        x: margin + colWidth * 2 + (colWidth - boldFont.widthOfTextAtSize('BAN GIÁM ĐỐC', 9.5)) / 2,
        y,
        size: 9.5,
        font: boldFont,
      });
      currentPage.drawText('(Phê duyệt tối cao)', {
        x: margin + colWidth * 2 + (colWidth - regularFont.widthOfTextAtSize('(Phê duyệt tối cao)', 8)) / 2,
        y: y - 12,
        size: 8,
        font: regularFont,
        color: rgb(0.4, 0.4, 0.4),
      });

      // Tên người lập ở dưới
      const creatorName = options.document.createdByName || 'Người tạo hồ sơ';
      currentPage.drawText(creatorName, {
        x: margin + (colWidth - boldFont.widthOfTextAtSize(creatorName, 9)) / 2,
        y: y - 65,
        size: 9,
        font: boldFont,
        color: rgb(0.1, 0.1, 0.1),
      });

      // =========================================================================
      // G. FOOTER TRANG & ĐÁNH SỐ TRANG TOÀN BỘ (FOOTER ON ALL PAGES)
      // =========================================================================
      const totalPages = pdfDoc.getPageCount();
      const nowFormatted = new Date().toISOString();
      const formHashPrefix = options.documentVersion.sha256Hash
        ? options.documentVersion.sha256Hash.slice(0, 24)
        : 'none';

      for (let i = 0; i < totalPages; i++) {
        const page = pdfDoc.getPage(i);
        const footerY = 25;

        // Đường kẻ ngang chân trang
        page.drawLine({
          start: { x: margin, y: footerY + 14 },
          end: { x: pageWidth - margin, y: footerY + 14 },
          thickness: 0.5,
          color: rgb(0.85, 0.85, 0.85),
        });

        // Cột trái: Hash & Disclaimer
        page.drawText(
          `Form Hash: ${formHashPrefix}... | Phase 13.1 Unsigned Artifact (Không có giá trị chữ ký số mật mã)`,
          {
            x: margin,
            y: footerY,
            size: 7,
            font: regularFont,
            color: rgb(0.5, 0.5, 0.5),
          }
        );

        // Cột phải: Đánh số trang
        const pageText = `Trang ${i + 1} / ${totalPages}`;
        const pageTextWidth = regularFont.widthOfTextAtSize(pageText, 8);
        page.drawText(pageText, {
          x: pageWidth - margin - pageTextWidth,
          y: footerY,
          size: 8,
          font: regularFont,
          color: rgb(0.4, 0.4, 0.4),
        });
      }

      // Lưu nhị phân PDF
      const pdfBytes = await pdfDoc.save();
      const pdfBuffer = Buffer.from(pdfBytes);

      // Tính mã băm SHA-256 trên chính xác các byte của file PDF được sinh
      const rawPdfHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

      return {
        pdfBuffer,
        rawPdfHash,
        sizeBytes: pdfBuffer.length,
        pageCount: totalPages,
      };
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      throw new InternalServerErrorException(`Lỗi trong tiến trình tạo tệp PDF: ${err.message}`);
    }
  }
}
