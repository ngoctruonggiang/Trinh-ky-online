import { Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as forge from 'node-forge';
import {
  IRevocationInformationProvider,
  RevocationCheckOptions,
  RevocationInfoResult,
} from './revocation.interface.js';
import { OcspCrlParserUtil } from './ocsp-crl-parser.util.js';
import { SsrfProtectionUtil } from './ssrf-protection.util.js';

/**
 * Nhà cung cấp thông tin thu hồi chứng thư số X.509 thực tế qua HTTP/HTTPS (AIA OCSP & CRL DP).
 * 
 * BẢO MẬT & PHÒNG THỦ:
 * - Chống SSRF: Chỉ truy vấn các URL được nhúng trong phần mở rộng X.509 của chứng thư (AIA / CRL DP).
 * - Kiểm tra địa chỉ IP phân giải để chặn dải mạng riêng tư/nội bộ (127.0.0.0/8, 10.0.0.0/8, 192.168.0.0/16, metadata cloud).
 * - Giới hạn kích thước phản hồi (Max 128KB cho OCSP, Max 10MB cho CRL).
 * - Giới hạn thời gian chờ (Timeout) và số lần chuyển hướng (Redirects <= 2).
 * - Xác minh chữ ký số của CA trên dữ liệu trả về trước khi chấp nhận.
 */
export class HttpRevocationProvider implements IRevocationInformationProvider {
  private readonly logger = new Logger(HttpRevocationProvider.name);
  private static readonly MAX_OCSP_BYTES = 128 * 1024; // 128 KB
  private static readonly MAX_CRL_BYTES = 10 * 1024 * 1024; // 10 MB

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public async getRevocationInfo(
    certPem: string,
    issuerCertPem: string,
    options: RevocationCheckOptions = {}
  ): Promise<RevocationInfoResult> {
    const timeoutMs = options.timeoutMs || 5000;
    const preferredSource = options.preferredSource || 'AUTO';

    const pki = forge.pki;
    let targetCert: forge.pki.Certificate;
    try {
      targetCert = pki.certificateFromPem(certPem);
    } catch (err: any) {
      return {
        status: 'UNAVAILABLE',
        isSignatureValid: false,
        errorMessage: `Không thể đọc chứng thư số X.509 cần kiểm tra: ${err.message}`,
      };
    }

    const serialNumberHex = targetCert.serialNumber;
    const extractedUrls = OcspCrlParserUtil.extractAiaAndCrlUrls(certPem);

    // 1. Nếu ưu tiên OCSP hoặc AUTO: Thử OCSP trước nếu có AIA OCSP URL
    if (preferredSource !== 'CRL' && extractedUrls.ocspUrls.length > 0) {
      for (const ocspUrl of extractedUrls.ocspUrls) {
        try {
          await SsrfProtectionUtil.assertSafeUrl(ocspUrl);
          const ocspResult = await this.fetchAndVerifyOcsp(
            ocspUrl,
            certPem,
            issuerCertPem,
            serialNumberHex,
            timeoutMs
          );
          if (ocspResult.status === 'GOOD' || ocspResult.status === 'REVOKED') {
            return ocspResult;
          }
        } catch (ocspErr: any) {
          this.logger.warn(`Truy vấn OCSP thất bại từ ${ocspUrl}: ${ocspErr.message}`);
        }
      }
    }

    // 2. Thử CRL nếu có CRL Distribution Points
    if (extractedUrls.crlUrls.length > 0) {
      for (const crlUrl of extractedUrls.crlUrls) {
        try {
          await SsrfProtectionUtil.assertSafeUrl(crlUrl);
          const crlResult = await this.fetchAndVerifyCrl(
            crlUrl,
            issuerCertPem,
            serialNumberHex,
            timeoutMs
          );
          if (crlResult.status === 'GOOD' || crlResult.status === 'REVOKED') {
            return crlResult;
          }
        } catch (crlErr: any) {
          this.logger.warn(`Truy vấn CRL thất bại từ ${crlUrl}: ${crlErr.message}`);
        }
      }
    }

    // 3. Nếu không có URL hoặc tất cả đều không phản hồi hợp lệ
    return {
      status: 'UNAVAILABLE',
      isSignatureValid: false,
      serialNumber: serialNumberHex,
      errorMessage:
        'Không thể thu thập thông tin thu hồi từ các điểm phân phối AIA OCSP hoặc CRL trong chứng thư.',
    };
  }

  /**
   * Tạo OCSPRequest ASN.1 DER (RFC 6960), gửi POST tới OCSP Responder và xác minh kết quả
   */
  private async fetchAndVerifyOcsp(
    ocspUrl: string,
    certPem: string,
    issuerCertPem: string,
    serialNumberHex: string,
    timeoutMs: number
  ): Promise<RevocationInfoResult> {
    const pki = forge.pki;
    const asn1 = forge.asn1;

    const cert = pki.certificateFromPem(certPem);
    const issuerCert = pki.certificateFromPem(issuerCertPem);

    // Xây dựng CertID: hashAlgorithm (SHA-256), issuerNameHash, issuerKeyHash, serialNumber
    const issuerNameDer = asn1.toDer((pki.certificateToAsn1(issuerCert) as any).value[0].value[3]).getBytes();
    const issuerNameHash = crypto.createHash('sha256').update(Buffer.from(issuerNameDer, 'binary')).digest();

    const pubKeyDer = Buffer.from(
      asn1.toDer(pki.publicKeyToAsn1(issuerCert.publicKey)).getBytes(),
      'binary'
    );
    const issuerKeyHash = crypto.createHash('sha256').update(pubKeyDer).digest();

    const normalizedSerial = serialNumberHex.replace(/^0x/i, '').toLowerCase();
    const serialBytes = forge.util.hexToBytes(normalizedSerial);

    const certIdSeq = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('2.16.840.1.101.3.4.2.1').getBytes()),
      ]),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, issuerNameHash.toString('binary')),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, issuerKeyHash.toString('binary')),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, serialBytes),
    ]);

    // Request
    const requestSeq = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [certIdSeq]);

    // TBSRequest
    const tbsRequestSeq = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [requestSeq]),
    ]);

    // OCSPRequest
    const ocspRequestSeq = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [tbsRequestSeq]);
    const ocspReqDer = Buffer.from(asn1.toDer(ocspRequestSeq).getBytes(), 'binary');

    // Gửi HTTP POST với AbortSignal timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(ocspUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/ocsp-request',
          Accept: 'application/ocsp-response',
        },
        body: new Uint8Array(ocspReqDer),
        signal: controller.signal,
        redirect: 'error', // Chặn chuyển hướng tự động để chống SSRF qua redirect
      });

      if (!response.ok) {
        throw new Error(`HTTP status ${response.status} ${response.statusText}`);
      }

      const arrayBuf = await response.arrayBuffer();
      if (arrayBuf.byteLength > HttpRevocationProvider.MAX_OCSP_BYTES) {
        throw new Error(`Phản hồi OCSP quá lớn (${arrayBuf.byteLength} bytes > 128KB).`);
      }

      const respDer = Buffer.from(arrayBuf);
      const verifyResult = OcspCrlParserUtil.verifyAndParseOcspResponse(
        respDer,
        serialNumberHex,
        issuerCertPem
      );
      verifyResult.sourceUrl = ocspUrl;
      return verifyResult;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Tải CRL (RFC 5280) từ CRL Distribution Point và xác minh kết quả
   */
  private async fetchAndVerifyCrl(
    crlUrl: string,
    issuerCertPem: string,
    serialNumberHex: string,
    timeoutMs: number
  ): Promise<RevocationInfoResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(crlUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/pkix-crl, application/x-pkcs7-crl',
        },
        signal: controller.signal,
        redirect: 'error',
      });

      if (!response.ok) {
        throw new Error(`HTTP status ${response.status} ${response.statusText}`);
      }

      const arrayBuf = await response.arrayBuffer();
      if (arrayBuf.byteLength > HttpRevocationProvider.MAX_CRL_BYTES) {
        throw new Error(`Dữ liệu CRL quá lớn (${arrayBuf.byteLength} bytes > 10MB).`);
      }

      const crlDer = Buffer.from(arrayBuf);
      const verifyResult = OcspCrlParserUtil.verifyAndParseCrl(
        crlDer,
        serialNumberHex,
        issuerCertPem
      );
      verifyResult.sourceUrl = crlUrl;
      return verifyResult;
    } finally {
      clearTimeout(timer);
    }
  }
}
