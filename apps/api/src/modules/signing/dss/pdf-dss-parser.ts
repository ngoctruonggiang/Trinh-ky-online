import * as forge from 'node-forge';
import { OcspCrlParserUtil } from '../revocation/ocsp-crl-parser.util.js';
import { CertificateStatusType } from '../revocation/revocation.interface.js';

export interface ParsedDssInfo {
  hasDss: boolean;
  certsCount: number;
  ocspsCount: number;
  crlsCount: number;
  vriEntriesCount: number;
  certificateDers: Buffer[];
  ocspResponseDers: Buffer[];
  crlDers: Buffer[];
  revocationStatus: CertificateStatusType;
  ltvValidationStatus: 'VALID' | 'INCOMPLETE_CHAIN' | 'REVOCATION_DATA_MISSING' | 'EXPIRED' | 'REVOKED' | 'UNAVAILABLE';
  errorMessage?: string;
}

/**
 * Trình bóc tách và thẩm định cấu trúc Document Security Store (/DSS) trong tệp PDF
 */
export class PdfDssParser {
  /**
   * Phân tích đối tượng /DSS từ tệp PDF nhị phân
   */
  public static parseDss(
    pdfBuffer: Buffer,
    expectedSignerSerialHex?: string,
    signerIssuerPem?: string
  ): ParsedDssInfo {
    const pdfAscii = pdfBuffer.toString('binary');

    // 1. Kiểm tra sự tồn tại của từ khóa /DSS
    const dssIndex = pdfAscii.indexOf('/DSS');
    if (dssIndex === -1) {
      return {
        hasDss: false,
        certsCount: 0,
        ocspsCount: 0,
        crlsCount: 0,
        vriEntriesCount: 0,
        certificateDers: [],
        ocspResponseDers: [],
        crlDers: [],
        revocationStatus: 'UNAVAILABLE',
        ltvValidationStatus: 'REVOCATION_DATA_MISSING',
      };
    }

    // 2. Tìm định nghĩa đối tượng DSS: "<objNum> <genNum> obj ... /Type /DSS ... endobj"
    const dssObjRegex = /(\d+)\s+(\d+)\s+obj[\s\S]*?\/Type\s*\/DSS([\s\S]*?)endobj/;
    const dssMatch = pdfAscii.match(dssObjRegex);
    if (!dssMatch) {
      // Có thể là dictionary /DSS nằm lồng trong Root
      return {
        hasDss: false,
        certsCount: 0,
        ocspsCount: 0,
        crlsCount: 0,
        vriEntriesCount: 0,
        certificateDers: [],
        ocspResponseDers: [],
        crlDers: [],
        revocationStatus: 'UNAVAILABLE',
        ltvValidationStatus: 'REVOCATION_DATA_MISSING',
        errorMessage: 'Tìm thấy thẻ /DSS nhưng không tìm thấy cấu trúc dictionary /Type /DSS hợp lệ.',
      };
    }

    const dssBody = dssMatch[3];

    // 3. Trích xuất danh sách Object References trong /Certs, /OCSPs, /CRLs, /VRI
    const certRefs = PdfDssParser.extractRefsFromArray(dssBody, '/Certs');
    const ocspRefs = PdfDssParser.extractRefsFromArray(dssBody, '/OCSPs');
    const crlRefs = PdfDssParser.extractRefsFromArray(dssBody, '/CRLs');

    let vriEntriesCount = 0;
    const vriMatch = dssBody.match(/\/VRI\s*<<([\s\S]*?)>>/);
    if (vriMatch) {
      const vriEntries = vriMatch[1].match(/\/([A-Fa-f0-9]+)\s+\d+\s+\d+\s+R/g);
      vriEntriesCount = vriEntries ? vriEntries.length : 0;
    }

    // 4. Trích xuất luồng nhị phân stream của từng Cert, OCSP, CRL
    const certificateDers: Buffer[] = [];
    for (const ref of certRefs) {
      const streamBytes = PdfDssParser.extractStreamByRef(pdfAscii, pdfBuffer, ref);
      if (streamBytes) {
        certificateDers.push(streamBytes);
      }
    }

    const ocspResponseDers: Buffer[] = [];
    for (const ref of ocspRefs) {
      const streamBytes = PdfDssParser.extractStreamByRef(pdfAscii, pdfBuffer, ref);
      if (streamBytes) {
        ocspResponseDers.push(streamBytes);
      }
    }

    const crlDers: Buffer[] = [];
    for (const ref of crlRefs) {
      const streamBytes = PdfDssParser.extractStreamByRef(pdfAscii, pdfBuffer, ref);
      if (streamBytes) {
        crlDers.push(streamBytes);
      }
    }

    // 5. Thẩm định tính hợp lệ của dữ liệu thu hồi (Revocation Validation)
    let revocationStatus: CertificateStatusType = 'UNAVAILABLE';
    let ltvValidationStatus: 'VALID' | 'INCOMPLETE_CHAIN' | 'REVOCATION_DATA_MISSING' | 'EXPIRED' | 'REVOKED' | 'UNAVAILABLE' =
      'REVOCATION_DATA_MISSING';
    let errorMessage: string | undefined;

    if (certificateDers.length === 0) {
      return {
        hasDss: true,
        certsCount: 0,
        ocspsCount: ocspResponseDers.length,
        crlsCount: crlDers.length,
        vriEntriesCount,
        certificateDers,
        ocspResponseDers,
        crlDers,
        revocationStatus: 'UNAVAILABLE',
        ltvValidationStatus: 'INCOMPLETE_CHAIN',
        errorMessage: 'Cấu trúc /DSS không chứa chứng thư trong /Certs.',
      };
    }

    if (ocspResponseDers.length === 0 && crlDers.length === 0) {
      return {
        hasDss: true,
        certsCount: certificateDers.length,
        ocspsCount: 0,
        crlsCount: 0,
        vriEntriesCount,
        certificateDers,
        ocspResponseDers,
        crlDers,
        revocationStatus: 'UNAVAILABLE',
        ltvValidationStatus: 'REVOCATION_DATA_MISSING',
        errorMessage: 'Cấu trúc /DSS thiếu cả phản hồi OCSP và danh sách thu hồi CRL.',
      };
    }

    // Danh sách các chứng thư ứng viên để xác minh OCSP/CRL (từ signerIssuerPem và từ DSS /Certs)
    const candidateIssuerPems: string[] = [];
    if (signerIssuerPem) {
      candidateIssuerPems.push(signerIssuerPem);
    }
    for (const certDer of certificateDers) {
      try {
        const certAsn1 = forge.asn1.fromDer(certDer.toString('binary'));
        const certForge = forge.pki.certificateFromAsn1(certAsn1);
        const certPem = forge.pki.certificateToPem(certForge);
        if (!candidateIssuerPems.includes(certPem)) {
          candidateIssuerPems.push(certPem);
        }
      } catch {}
    }

    // Nếu có expected serial và các chứng thư ứng viên, đối soát trực tiếp
    if (expectedSignerSerialHex && candidateIssuerPems.length > 0) {
      let isVerifiedGood = false;

      // Thử xác minh qua các OCSP Responses trong DSS
      for (const ocspDer of ocspResponseDers) {
        for (const issuerPem of candidateIssuerPems) {
          const ocspResult = OcspCrlParserUtil.verifyAndParseOcspResponse(
            ocspDer,
            expectedSignerSerialHex,
            issuerPem
          );
          if (ocspResult.status === 'REVOKED') {
            revocationStatus = 'REVOKED';
            ltvValidationStatus = 'REVOKED';
            errorMessage = 'Chứng thư số bị thu hồi theo phản hồi OCSP nhúng trong DSS.';
            break;
          } else if (ocspResult.status === 'GOOD' && ocspResult.isSignatureValid) {
            isVerifiedGood = true;
            revocationStatus = 'GOOD';
            ltvValidationStatus = 'VALID';
            break;
          }
        }
        if (revocationStatus === 'REVOKED' || isVerifiedGood) {
          break;
        }
      }

      // Nếu chưa có kết quả GOOD từ OCSP, thử qua CRLs
      if (!isVerifiedGood && revocationStatus !== 'REVOKED') {
        for (const crlDer of crlDers) {
          for (const issuerPem of candidateIssuerPems) {
            const crlResult = OcspCrlParserUtil.verifyAndParseCrl(
              crlDer,
              expectedSignerSerialHex,
              issuerPem
            );
            if (crlResult.status === 'REVOKED') {
              revocationStatus = 'REVOKED';
              ltvValidationStatus = 'REVOKED';
              errorMessage = 'Chứng thư số bị thu hồi theo danh sách CRL nhúng trong DSS.';
              break;
            } else if (crlResult.status === 'GOOD' && crlResult.isSignatureValid) {
              isVerifiedGood = true;
              revocationStatus = 'GOOD';
              ltvValidationStatus = 'VALID';
              break;
            }
          }
          if (revocationStatus === 'REVOKED' || isVerifiedGood) {
            break;
          }
        }
      }

      if (!isVerifiedGood && revocationStatus !== 'REVOKED') {
        revocationStatus = 'UNAVAILABLE';
        ltvValidationStatus = 'REVOCATION_DATA_MISSING';
        errorMessage = 'Dữ liệu OCSP/CRL trong DSS không thể xác minh trạng thái cho chứng thư của người ký.';
      }
    } else {
      // Nếu không có thông tin đối soát, nhưng có dữ liệu OCSP/CRL và Certs đầy đủ
      revocationStatus = 'GOOD';
      ltvValidationStatus = 'VALID';
    }

    return {
      hasDss: true,
      certsCount: certificateDers.length,
      ocspsCount: ocspResponseDers.length,
      crlsCount: crlDers.length,
      vriEntriesCount,
      certificateDers,
      ocspResponseDers,
      crlDers,
      revocationStatus,
      ltvValidationStatus,
      errorMessage,
    };
  }

  private static extractRefsFromArray(dssBody: string, arrayName: string): string[] {
    const regex = new RegExp(`${arrayName}\\s*\\[([\\s\\S]*?)\\]`);
    const match = dssBody.match(regex);
    if (!match) return [];

    const refRegex = /(\d+\s+\d+\s+R)/g;
    const matches = match[1].match(refRegex);
    return matches || [];
  }

  private static extractStreamByRef(
    pdfAscii: string,
    pdfBuffer: Buffer,
    ref: string
  ): Buffer | null {
    const parts = ref.split(/\s+/);
    const objNum = parts[0];
    const genNum = parts[1];

    const objHeader = `${objNum} ${genNum} obj`;
    const objIndex = pdfAscii.indexOf(objHeader);
    if (objIndex === -1) return null;

    const streamTag = 'stream';
    const streamIndex = pdfAscii.indexOf(streamTag, objIndex);
    if (streamIndex === -1) return null;

    // Stream bắt đầu sau ký tự xuống dòng (\n hoặc \r\n) sau "stream"
    let streamStart = streamIndex + streamTag.length;
    if (pdfBuffer[streamStart] === 0x0d && pdfBuffer[streamStart + 1] === 0x0a) {
      streamStart += 2;
    } else if (pdfBuffer[streamStart] === 0x0a || pdfBuffer[streamStart] === 0x0d) {
      streamStart += 1;
    }

    const endstreamTag = 'endstream';
    const endstreamIndex = pdfAscii.indexOf(endstreamTag, streamStart);
    if (endstreamIndex === -1 || endstreamIndex <= streamStart) return null;

    let streamEnd = endstreamIndex;
    if (pdfBuffer[streamEnd - 1] === 0x0a) {
      streamEnd -= 1;
      if (pdfBuffer[streamEnd - 1] === 0x0d) {
        streamEnd -= 1;
      }
    }

    return pdfBuffer.subarray(streamStart, streamEnd);
  }
}
