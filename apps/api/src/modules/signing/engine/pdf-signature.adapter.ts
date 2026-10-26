import * as crypto from 'crypto';
import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFHexString,
  PDFArray,
  PDFDict,
  PDFString,
} from 'pdf-lib';
import { ISigningKeyProvider } from '../providers/signing-key-provider.interface.js';
import { ITimestampAuthorityProvider } from '../timestamp/timestamp.interface.js';
import { CmsSignatureBuilder } from './cms-signature.builder.js';

export interface PdfSigningOptions {
  /** Tệp PDF nhị phân đầu vào chưa ký */
  unsignedPdfBuffer: Buffer;
  /** Định danh khóa ký trong Key Provider */
  keyAlias: string;
  /** Key Provider thực hiện ký */
  keyProvider: ISigningKeyProvider;
  /** Chuỗi PEM của chứng thư số người ký */
  signerCertificatePem: string;
  /** Chuỗi PEM các chứng thư CA trung gian (nếu có) */
  certificateChainPem?: string[];
  /** Lý do ký duyệt */
  reason?: string;
  /** Thông tin liên hệ */
  contactInfo?: string;
  /** Tên hiển thị người ký */
  signerName?: string;
  /** Địa điểm ký */
  location?: string;
  /** Chuẩn phụ: adbe.pkcs7.detached hoặc ETSI.CAdES.detached */
  subFilter?: 'adbe.pkcs7.detached' | 'ETSI.CAdES.detached';
  /** Độ dài hex placeholder (mặc định 16384 hex ký tự = 8192 bytes CMS) */
  placeholderHexLength?: number;
  /** Nhà cung cấp dấu thời gian tin cậy RFC 3161 TSA (tùy chọn) */
  tsaProvider?: ITimestampAuthorityProvider;
  /** Yêu cầu bắt buộc dấu thời gian tin cậy (mặc định false) */
  requireTimestamp?: boolean;
}

export interface PdfSigningResult {
  signedPdfBuffer: Buffer;
  rawPdfHash: string;
  signedPdfHash: string;
  byteRange: number[];
  messageDigestHex: string;
  cmsDer: Buffer;
  signingTime: Date;
  signerSubjectDn: string;
  signerIssuerDn: string;
  serialNumber: string;
  hasTimestamp: boolean;
  timestampGenTime?: Date;
  tsaSubjectDn?: string;
  tsaIssuerDn?: string;
  tsaSerialNumber?: string;
  tsaPolicyOid?: string;
  signatureHex?: string;
  signatureValueBuffer?: Buffer;
}

/**
 * Adapter tích hợp cấu trúc chữ ký số PDF (ISO 32000-1) và CMS Detached Signature,
 * hỗ trợ nhúng dấu thời gian tin cậy RFC 3161 (PAdES B-T Readiness).
 */
export class PdfSignatureAdapter {
  private static readonly DEFAULT_PLACEHOLDER_HEX_LENGTH = 16384; // 8192 bytes CMS
  private static readonly BYTERANGE_PLACEHOLDER_STRING = '/ByteRange [ 0 9999999999 9999999999 9999999999 ]';

  /**
   * Ký số nhúng CMS Detached vào tệp PDF
   */
  public static async signPdf(options: PdfSigningOptions): Promise<PdfSigningResult> {
    const {
      unsignedPdfBuffer,
      keyAlias,
      keyProvider,
      signerCertificatePem,
      certificateChainPem = [],
      reason = 'Phê duyệt tài liệu điện tử qua Trình Ký Online',
      contactInfo,
      signerName,
      location,
      subFilter = 'adbe.pkcs7.detached',
      placeholderHexLength = PdfSignatureAdapter.DEFAULT_PLACEHOLDER_HEX_LENGTH,
      tsaProvider,
      requireTimestamp = false,
    } = options;

    if (!unsignedPdfBuffer || unsignedPdfBuffer.length === 0) {
      throw new Error('Dữ liệu PDF đầu vào rỗng (Empty PDF buffer)');
    }

    // Kiểm tra Magic Bytes PDF (%PDF-)
    if (unsignedPdfBuffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error('Tệp dữ liệu đầu vào không phải là định dạng PDF hợp lệ (Thiếu magic bytes %PDF-)');
    }

    const rawPdfHash = crypto.createHash('sha256').update(unsignedPdfBuffer).digest('hex');
    const signingTime = new Date();

    // 1. Nạp PDF bằng pdf-lib để thêm cấu trúc Signature Dictionary và AcroForm
    const pdfDoc = await PDFDocument.load(unsignedPdfBuffer, { ignoreEncryption: true });

    // Tạo ByteRange placeholder mảng 4 số nguyên
    const byteRangePlaceholder = PDFArray.withContext(pdfDoc.context);
    byteRangePlaceholder.push(PDFNumber.of(0));
    byteRangePlaceholder.push(PDFNumber.of(9999999999));
    byteRangePlaceholder.push(PDFNumber.of(9999999999));
    byteRangePlaceholder.push(PDFNumber.of(9999999999));

    // Tạo Contents placeholder dạng hex string với toàn số 0
    const contentsPlaceholder = PDFHexString.of('0'.repeat(placeholderHexLength));

    // Signature Value Dictionary (/V)
    const sigDictObj: Record<string, any> = {
      Type: 'Sig',
      Filter: 'Adobe.PPKLite',
      SubFilter: subFilter,
      ByteRange: byteRangePlaceholder,
      Contents: contentsPlaceholder,
      Reason: PDFString.of(reason),
      M: PDFString.fromDate(signingTime),
    };

    if (signerName) {
      sigDictObj.Name = PDFString.of(signerName);
    }
    if (contactInfo) {
      sigDictObj.ContactInfo = PDFString.of(contactInfo);
    }
    if (location) {
      sigDictObj.Location = PDFString.of(location);
    }

    const sigDict = pdfDoc.context.obj(sigDictObj);
    const sigDictRef = pdfDoc.context.register(sigDict);

    // Widget Annotation (/Type /Annot /Subtype /Widget /FT /Sig)
    const widgetDict = pdfDoc.context.obj({
      Type: 'Annot',
      Subtype: 'Widget',
      FT: 'Sig',
      Rect: [0, 0, 0, 0],
      V: sigDictRef,
      T: PDFString.of(`Signature_${Date.now()}`),
      F: 4, // Print flag
      P: pdfDoc.getPage(0).ref,
    });
    const widgetDictRef = pdfDoc.context.register(widgetDict);

    // Đăng ký annotation vào trang đầu tiên
    pdfDoc.getPage(0).node.addAnnot(widgetDictRef);

    // Cập nhật AcroForm trong Catalog
    let acroForm: PDFDict | undefined;
    if (pdfDoc.catalog.has(PDFName.of('AcroForm'))) {
      acroForm = pdfDoc.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
      acroForm.set(PDFName.of('SigFlags'), PDFNumber.of(3)); // SignaturesExist (1) | AppendOnly (2)
      let fields = acroForm.lookup(PDFName.of('Fields'), PDFArray);
      if (!fields) {
        fields = pdfDoc.context.obj([widgetDictRef]);
        acroForm.set(PDFName.of('Fields'), pdfDoc.context.register(fields));
      } else {
        fields.push(widgetDictRef);
      }
    } else {
      acroForm = pdfDoc.context.obj({
        Fields: [widgetDictRef],
        SigFlags: 3,
      });
      pdfDoc.catalog.set(PDFName.of('AcroForm'), pdfDoc.context.register(acroForm));
    }

    // Lưu PDF kèm placeholder (useObjectStreams: false để giữ ByteRange và Contents dạng chuỗi trực tiếp)
    const pdfBuffer = Buffer.from(await pdfDoc.save({ useObjectStreams: false }));

    // 2. Tìm vị trí ByteRange placeholder và Contents trong Buffer
    const byteRangeIndex = pdfBuffer.indexOf(PdfSignatureAdapter.BYTERANGE_PLACEHOLDER_STRING);
    if (byteRangeIndex === -1) {
      throw new Error('Không thể tìm thấy chuỗi định vị ByteRange placeholder trong cấu trúc PDF đã kết xuất.');
    }

    // Tìm /Contents trong signature dictionary (bắt đầu tìm từ byteRangeIndex)
    const contentsTag = Buffer.from('/Contents');
    const contentsTagIndex = pdfBuffer.indexOf(contentsTag, byteRangeIndex);
    if (contentsTagIndex === -1) {
      throw new Error('Không thể tìm thấy trường /Contents trong signature dictionary.');
    }

    const hexStart = pdfBuffer.indexOf('<', contentsTagIndex);
    const hexEnd = pdfBuffer.indexOf('>', hexStart);
    if (hexStart === -1 || hexEnd === -1 || hexEnd <= hexStart) {
      throw new Error('Cấu trúc hex string <...> của trường /Contents không hợp lệ.');
    }

    const actualPlaceholderHexLength = hexEnd - hexStart - 1;

    // 3. Tính toán ByteRange thực tế
    // ByteRange = [ 0, offset_of_<, offset_of_after_>, bytes_from_after_>_to_EOF ]
    const byteRange = [
      0,
      hexStart,
      hexEnd + 1,
      pdfBuffer.length - (hexEnd + 1),
    ];

    // Ghi chuỗi ByteRange thực tế vào vị trí placeholder (được đệm space để giữ nguyên offset)
    const actualByteRangeString = `/ByteRange [ 0 ${byteRange[1]} ${byteRange[2]} ${byteRange[3]} ]`;
    if (actualByteRangeString.length > PdfSignatureAdapter.BYTERANGE_PLACEHOLDER_STRING.length) {
      throw new Error('Độ dài ByteRange thực tế vượt quá dung lượng placeholder định sẵn.');
    }
    const paddedByteRange = actualByteRangeString.padEnd(
      PdfSignatureAdapter.BYTERANGE_PLACEHOLDER_STRING.length,
      ' '
    );
    pdfBuffer.write(paddedByteRange, byteRangeIndex, 'ascii');

    // 4. Trích xuất chính xác các vùng byte được ký và tính SHA-256 Digest
    const part1 = pdfBuffer.subarray(0, byteRange[1]);
    const part2 = pdfBuffer.subarray(byteRange[2], byteRange[2] + byteRange[3]);
    const byteRangeContent = Buffer.concat([part1, part2]);
    const messageDigest = crypto.createHash('sha256').update(byteRangeContent).digest();

    // 5. Khởi tạo CMS Detached Signature (kèm RFC 3161 Timestamp nếu yêu cầu)
    const cmsResult = await CmsSignatureBuilder.buildDetachedSignature({
      messageDigest,
      signingTime,
      signerCertificatePem,
      certificateChainPem,
      keyAlias,
      keyProvider,
      subFilter,
      tsaProvider,
      requireTimestamp,
    });

    // 6. Kiểm tra kích thước và điền CMS hex vào vị trí Contents
    const cmsHex = cmsResult.cmsDer.toString('hex');
    if (cmsHex.length > actualPlaceholderHexLength) {
      throw new Error(
        `Kích thước chữ ký CMS (${cmsHex.length} hex chars) vượt quá dung lượng placeholder (${actualPlaceholderHexLength} hex chars).`
      );
    }

    // Đệm trailing zeros theo chuẩn PDF Hex String
    const paddedCmsHex = cmsHex.padEnd(actualPlaceholderHexLength, '0');
    pdfBuffer.write(paddedCmsHex, hexStart + 1, 'ascii');

    // 7. Tính mã băm toàn diện trên Buffer PDF đầu ra hoàn chỉnh
    const signedPdfHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

    return {
      signedPdfBuffer: pdfBuffer,
      rawPdfHash,
      signedPdfHash,
      byteRange,
      messageDigestHex: messageDigest.toString('hex'),
      cmsDer: cmsResult.cmsDer,
      signingTime,
      signerSubjectDn: cmsResult.signerSubjectDn,
      signerIssuerDn: cmsResult.signerIssuerDn,
      serialNumber: cmsResult.serialNumber,
      hasTimestamp: cmsResult.hasTimestamp,
      timestampGenTime: cmsResult.timestampGenTime,
      tsaSubjectDn: cmsResult.tsaSubjectDn,
      tsaIssuerDn: cmsResult.tsaIssuerDn,
      tsaSerialNumber: cmsResult.tsaSerialNumber,
      tsaPolicyOid: cmsResult.tsaPolicyOid,
      signatureHex: cmsResult.signatureHex,
      signatureValueBuffer: Buffer.from(cmsResult.signatureHex, 'hex'),
    };
  }
}
