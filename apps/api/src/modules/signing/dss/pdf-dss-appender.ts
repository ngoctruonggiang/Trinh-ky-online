import * as crypto from 'crypto';

export interface DssDataInput {
  /** Danh sách Buffer DER của các chứng thư X.509 cần nhúng vào /Certs */
  certificateDers: Buffer[];
  /** Danh sách Buffer DER của các phản hồi OCSP cần nhúng vào /OCSPs */
  ocspResponseDers?: Buffer[];
  /** Danh sách Buffer DER của các danh sách thu hồi CRL cần nhúng vào /CRLs */
  crlDers?: Buffer[];
  /** Buffer nhị phân của signatureValue (dùng để tính khóa định danh VRI) */
  signatureValueBuffer?: Buffer;
  /** Thời điểm thẩm định (TU) */
  validationTime?: Date;
}

export interface PdfDssAppendResult {
  /** Tệp PDF sau khi đã bổ sung DSS qua Incremental Update */
  updatedPdfBuffer: Buffer;
  /** Dung lượng byte trước khi bổ sung DSS */
  originalSize: number;
  /** Dung lượng byte sau khi bổ sung DSS */
  updatedSize: number;
  /** Số lượng chứng thư X.509 đã nhúng */
  certsCount: number;
  /** Số lượng phản hồi OCSP đã nhúng */
  ocspsCount: number;
  /** Số lượng CRL đã nhúng */
  crlsCount: number;
  /** VRI entry key hex */
  vriKeyHex?: string;
}

/**
 * Trình bổ sung Document Security Store (DSS) và Validation-Related Information (VRI)
 * vào tệp PDF đã ký theo chuẩn ISO 32000-1 / ETSI EN 319 142-1 (PAdES Baseline B-LT)
 * thông qua kỹ thuật PDF Incremental Update an toàn tuyệt đối.
 * 
 * NGUYÊN TẮC BẢO MẬT & TOÀN VẸN:
 * 1. 100% byte của tệp PDF đã ký ban đầu được giữ nguyên vẹn không đổi.
 * 2. Không làm thay đổi bảng /ByteRange hoặc làm hỏng chữ ký mật mã đã có.
 * 3. Tạo các đối tượng stream gián tiếp độc lập cho từng Cert, OCSP, CRL.
 * 4. Tạo cấu trúc /DSS và /VRI liên kết trong Document Catalog (Root).
 * 5. Bổ sung bảng xref và trailer trỏ ngược /Prev về xref trước đó.
 */
export class PdfDssAppender {
  /**
   * Bổ sung DSS vào tệp PDF đã ký bằng Incremental Update
   */
  public static appendDss(
    signedPdfBuffer: Buffer,
    dssData: DssDataInput
  ): PdfDssAppendResult {
    if (!signedPdfBuffer || signedPdfBuffer.length === 0) {
      throw new Error('Tệp PDF đầu vào rỗng (Empty PDF buffer).');
    }

    // 1. Phân tích cấu trúc cuối tệp PDF ban đầu để tìm startxref và trailer
    const pdfAscii = signedPdfBuffer.toString('binary');
    const startxrefIndex = pdfAscii.lastIndexOf('startxref');
    if (startxrefIndex === -1) {
      throw new Error('Không tìm thấy từ khóa startxref trong tệp PDF gốc.');
    }

    // Tìm vị trí xref cũ
    const postStartXref = pdfAscii.substring(startxrefIndex + 9).trim();
    const oldXrefOffset = parseInt(postStartXref, 10);
    if (isNaN(oldXrefOffset)) {
      throw new Error('Không thể phân tích byte offset của startxref trước đó.');
    }

    // Tìm trailer cũ
    const trailerIndex = pdfAscii.lastIndexOf('trailer', startxrefIndex);
    if (trailerIndex === -1) {
      throw new Error('Không tìm thấy từ khóa trailer trong tệp PDF gốc.');
    }

    const trailerContent = pdfAscii.substring(trailerIndex, startxrefIndex);

    // Trích xuất /Size từ trailer cũ
    const sizeMatch = trailerContent.match(/\/Size\s+(\d+)/);
    if (!sizeMatch) {
      throw new Error('Không tìm thấy trường /Size trong trailer của tệp PDF gốc.');
    }
    const oldSize = parseInt(sizeMatch[1], 10);

    // Trích xuất /Root object number từ trailer cũ
    const rootMatch = trailerContent.match(/\/Root\s+(\d+)\s+(\d+)\s+R/);
    if (!rootMatch) {
      throw new Error('Không tìm thấy trường /Root trong trailer của tệp PDF gốc.');
    }
    const rootObjNum = parseInt(rootMatch[1], 10);
    const rootGenNum = parseInt(rootMatch[2], 10);

    // Trích xuất nội dung gốc của Root Catalog
    // Tìm định nghĩa: "<rootObjNum> <rootGenNum> obj ... endobj"
    const rootObjRegex = new RegExp(`${rootObjNum}\\s+${rootGenNum}\\s+obj([\\s\\S]*?)endobj`);
    const rootObjMatch = pdfAscii.match(rootObjRegex);
    if (!rootObjMatch) {
      throw new Error(`Không tìm thấy định nghĩa đối tượng Root Catalog ${rootObjNum} ${rootGenNum} obj.`);
    }

    let rootDictBody = rootObjMatch[1].trim();
    // Bỏ thẻ << và >> bao quanh Root dictionary
    if (rootDictBody.startsWith('<<')) {
      rootDictBody = rootDictBody.substring(2);
    }
    if (rootDictBody.endsWith('>>')) {
      rootDictBody = rootDictBody.substring(0, rootDictBody.length - 2);
    }
    // Nếu Root cũ đã có /DSS, ta sẽ thay thế bằng /DSS mới
    rootDictBody = rootDictBody.replace(/\/DSS\s+\d+\s+\d+\s+R/g, '').trim();

    // 2. Chuẩn bị các đối tượng mới
    let nextObjNum = oldSize;
    const newObjects: Array<{ objNum: number; content: Buffer }> = [];

    // 2.1. Tạo stream objects cho từng X.509 Certificate
    const certRefs: string[] = [];
    for (const certDer of dssData.certificateDers) {
      if (!certDer || certDer.length === 0) continue;
      const objNum = nextObjNum++;
      certRefs.push(`${objNum} 0 R`);

      const header = Buffer.from(`${objNum} 0 obj\n<< /Type /X509 /Length ${certDer.length} >>\nstream\n`, 'ascii');
      const footer = Buffer.from('\nendstream\nendobj\n', 'ascii');
      newObjects.push({
        objNum,
        content: Buffer.concat([header, certDer, footer]),
      });
    }

    // 2.2. Tạo stream objects cho từng OCSP Response
    const ocspRefs: string[] = [];
    for (const ocspDer of dssData.ocspResponseDers || []) {
      if (!ocspDer || ocspDer.length === 0) continue;
      const objNum = nextObjNum++;
      ocspRefs.push(`${objNum} 0 R`);

      const header = Buffer.from(`${objNum} 0 obj\n<< /Type /OCSP /Length ${ocspDer.length} >>\nstream\n`, 'ascii');
      const footer = Buffer.from('\nendstream\nendobj\n', 'ascii');
      newObjects.push({
        objNum,
        content: Buffer.concat([header, ocspDer, footer]),
      });
    }

    // 2.3. Tạo stream objects cho từng CRL
    const crlRefs: string[] = [];
    for (const crlDer of dssData.crlDers || []) {
      if (!crlDer || crlDer.length === 0) continue;
      const objNum = nextObjNum++;
      crlRefs.push(`${objNum} 0 R`);

      const header = Buffer.from(`${objNum} 0 obj\n<< /Type /CRL /Length ${crlDer.length} >>\nstream\n`, 'ascii');
      const footer = Buffer.from('\nendstream\nendobj\n', 'ascii');
      newObjects.push({
        objNum,
        content: Buffer.concat([header, crlDer, footer]),
      });
    }

    // 2.4. Tạo đối tượng VRI Dictionary (Validation-Related Info) nếu có signatureValue
    let vriObjNum: number | undefined;
    let vriKeyHex: string | undefined;

    if (dssData.signatureValueBuffer && dssData.signatureValueBuffer.length > 0) {
      vriKeyHex = crypto
        .createHash('sha1')
        .update(dssData.signatureValueBuffer)
        .digest('hex')
        .toUpperCase();

      vriObjNum = nextObjNum++;
      const valTime = dssData.validationTime || new Date();
      const tuFormatted = PdfDssAppender.formatPdfDate(valTime);

      let vriContent = `${vriObjNum} 0 obj\n<<\n  /Type /VRI\n`;
      if (certRefs.length > 0) {
        vriContent += `  /Cert [ ${certRefs.join(' ')} ]\n`;
      }
      if (ocspRefs.length > 0) {
        vriContent += `  /OCSP [ ${ocspRefs.join(' ')} ]\n`;
      }
      if (crlRefs.length > 0) {
        vriContent += `  /CRL [ ${crlRefs.join(' ')} ]\n`;
      }
      vriContent += `  /TU (D:${tuFormatted})\n>>\nendobj\n`;

      newObjects.push({
        objNum: vriObjNum,
        content: Buffer.from(vriContent, 'ascii'),
      });
    }

    // 2.5. Tạo đối tượng /DSS Dictionary
    const dssObjNum = nextObjNum++;
    let dssContent = `${dssObjNum} 0 obj\n<<\n  /Type /DSS\n`;
    if (certRefs.length > 0) {
      dssContent += `  /Certs [ ${certRefs.join(' ')} ]\n`;
    }
    if (ocspRefs.length > 0) {
      dssContent += `  /OCSPs [ ${ocspRefs.join(' ')} ]\n`;
    }
    if (crlRefs.length > 0) {
      dssContent += `  /CRLs [ ${crlRefs.join(' ')} ]\n`;
    }
    if (vriObjNum && vriKeyHex) {
      dssContent += `  /VRI << /${vriKeyHex} ${vriObjNum} 0 R >>\n`;
    }
    dssContent += `>>\nendobj\n`;

    newObjects.push({
      objNum: dssObjNum,
      content: Buffer.from(dssContent, 'ascii'),
    });

    // 2.6. Tạo phiên bản cập nhật của đối tượng Root Catalog
    const updatedRootContent = `${rootObjNum} ${rootGenNum} obj\n<<\n  ${rootDictBody}\n  /DSS ${dssObjNum} 0 R\n>>\nendobj\n`;
    newObjects.push({
      objNum: rootObjNum,
      content: Buffer.from(updatedRootContent, 'ascii'),
    });

    // 3. Xây dựng phần Incremental Update Buffer
    const initialOffset = signedPdfBuffer.length;
    let currentOffset = initialOffset;
    const objectOffsets = new Map<number, number>();

    const incrementalChunks: Buffer[] = [Buffer.from('\n', 'ascii')];
    currentOffset += 1;

    for (const obj of newObjects) {
      objectOffsets.set(obj.objNum, currentOffset);
      incrementalChunks.push(obj.content);
      currentOffset += obj.content.length;
    }

    // 4. Tạo bảng xref mới (Cross-Reference Table)
    const newXrefOffset = currentOffset;
    let xrefTable = `xref\n`;

    // Nhóm 1: Root object được cập nhật (1 entry)
    const rootOffset = objectOffsets.get(rootObjNum)!;
    xrefTable += `${rootObjNum} 1\n`;
    xrefTable += `${rootOffset.toString().padStart(10, '0')} ${rootGenNum.toString().padStart(5, '0')} n \r\n`;

    // Nhóm 2: Các đối tượng mới từ oldSize đến nextObjNum - 1
    const newObjsCount = nextObjNum - oldSize;
    if (newObjsCount > 0) {
      xrefTable += `${oldSize} ${newObjsCount}\n`;
      for (let num = oldSize; num < nextObjNum; num++) {
        const off = objectOffsets.get(num)!;
        xrefTable += `${off.toString().padStart(10, '0')} 00000 n \r\n`;
      }
    }

    // 5. Tạo trailer mới
    const newTrailer = `trailer\n<<\n  /Size ${nextObjNum}\n  /Root ${rootObjNum} 0 R\n  /Prev ${oldXrefOffset}\n>>\nstartxref\n${newXrefOffset}\n%%EOF\n`;

    incrementalChunks.push(Buffer.from(xrefTable, 'ascii'));
    incrementalChunks.push(Buffer.from(newTrailer, 'ascii'));

    const incrementalBuffer = Buffer.concat(incrementalChunks);
    const updatedPdfBuffer = Buffer.concat([signedPdfBuffer, incrementalBuffer]);

    return {
      updatedPdfBuffer,
      originalSize: signedPdfBuffer.length,
      updatedSize: updatedPdfBuffer.length,
      certsCount: certRefs.length,
      ocspsCount: ocspRefs.length,
      crlsCount: crlRefs.length,
      vriKeyHex,
    };
  }

  /**
   * Định dạng Date theo chuẩn PDF (D:YYYYMMDDHHmmSSZ)
   */
  public static formatPdfDate(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  }
}
