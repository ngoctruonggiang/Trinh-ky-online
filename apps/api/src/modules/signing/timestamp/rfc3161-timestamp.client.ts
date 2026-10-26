import * as crypto from 'crypto';
import * as forge from 'node-forge';
import {
  TimestampRequestOptions,
  TimestampTokenResult,
} from './timestamp.interface.js';
import {
  OID_SHA256,
  TimestampTokenVerifier,
} from './timestamp-token.verifier.js';

export interface Rfc3161ClientConfig {
  tsaUrl: string;
  defaultTimeoutMs?: number;
  maxResponseSizeBytes?: number;
}

export class Rfc3161TimestampClient {
  private readonly tsaUrl: string;
  private readonly defaultTimeoutMs: number;
  private readonly maxResponseSizeBytes: number;

  constructor(config: Rfc3161ClientConfig) {
    if (!config.tsaUrl || !config.tsaUrl.startsWith('http')) {
      throw new Error(`Cấu hình URL của TSA không hợp lệ: ${config.tsaUrl}`);
    }
    this.tsaUrl = config.tsaUrl;
    this.defaultTimeoutMs = config.defaultTimeoutMs || 5000;
    this.maxResponseSizeBytes = config.maxResponseSizeBytes || 65536; // 64 KB
  }

  /**
   * Tạo tệp yêu cầu TimeStampReq theo chuẩn RFC 3161 dạng ASN.1 DER
   */
  public static buildTimeStampReq(
    digest32Bytes: Buffer,
    options: TimestampRequestOptions = {}
  ): { reqDer: Buffer; nonceHex: string } {
    if (!Buffer.isBuffer(digest32Bytes) || digest32Bytes.length !== 32) {
      throw new Error(
        `digest32Bytes không hợp lệ. Yêu cầu chính xác 32 byte SHA-256 digest, nhận được: ${digest32Bytes?.length || 0} bytes`
      );
    }

    const asn1 = forge.asn1;
    const certReq = options.certReq !== false;

    // Sinh nonce 64-bit ngẫu nhiên để chống tấn công phát lại (Replay Attack)
    const nonceBuffer = options.nonce
      ? Buffer.from(options.nonce, 'hex')
      : crypto.randomBytes(8);
    const nonceHex = nonceBuffer.toString('hex');

    // 1. messageImprint SEQUENCE { hashAlgorithm, hashedMessage }
    const messageImprintSeq = asn1.create(
      asn1.Class.UNIVERSAL,
      asn1.Type.SEQUENCE,
      true,
      [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
          asn1.create(
            asn1.Class.UNIVERSAL,
            asn1.Type.OID,
            false,
            asn1.oidToDer(OID_SHA256).getBytes()
          ),
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
        ]),
        asn1.create(
          asn1.Class.UNIVERSAL,
          asn1.Type.OCTETSTRING,
          false,
          digest32Bytes.toString('binary')
        ),
      ]
    );

    // 2. TimeStampReq SEQUENCE
    const reqElements: any[] = [
      asn1.create(
        asn1.Class.UNIVERSAL,
        asn1.Type.INTEGER,
        false,
        forge.util.hexToBytes('01') // version 1
      ),
      messageImprintSeq,
    ];

    // reqPolicy (tùy chọn)
    if (options.reqPolicy) {
      reqElements.push(
        asn1.create(
          asn1.Class.UNIVERSAL,
          asn1.Type.OID,
          false,
          asn1.oidToDer(options.reqPolicy).getBytes()
        )
      );
    }

    // nonce INTEGER
    reqElements.push(
      asn1.create(
        asn1.Class.UNIVERSAL,
        asn1.Type.INTEGER,
        false,
        nonceBuffer.toString('binary')
      )
    );

    // certReq BOOLEAN
    reqElements.push(
      asn1.create(
        asn1.Class.UNIVERSAL,
        asn1.Type.BOOLEAN,
        false,
        certReq ? String.fromCharCode(0xff) : String.fromCharCode(0x00)
      )
    );

    const timeStampReqSeq = asn1.create(
      asn1.Class.UNIVERSAL,
      asn1.Type.SEQUENCE,
      true,
      reqElements
    );

    const reqDer = Buffer.from(asn1.toDer(timeStampReqSeq).getBytes(), 'binary');
    return { reqDer, nonceHex };
  }

  /**
   * Phân tích cú pháp phản hồi TimeStampResp từ TSA theo chuẩn RFC 3161
   */
  public static parseTimeStampResp(
    respDer: Buffer,
    expectedDigest: Buffer,
    expectedNonce?: string
  ): TimestampTokenResult {
    const asn1 = forge.asn1;
    let respAsn1: any;

    try {
      respAsn1 = asn1.fromDer(respDer.toString('binary'));
    } catch (err: any) {
      throw new Error(`Dữ liệu phản hồi từ TSA không phải là ASN.1 DER hợp lệ: ${err.message}`);
    }

    if (
      respAsn1.tagClass !== asn1.Class.UNIVERSAL ||
      respAsn1.type !== asn1.Type.SEQUENCE ||
      !respAsn1.value ||
      respAsn1.value.length < 1
    ) {
      throw new Error('Cấu trúc TimeStampResp không đúng định dạng SEQUENCE.');
    }

    // status PKIStatusInfo SEQUENCE { status PKIStatus, statusString, failInfo }
    const pkiStatusInfo = respAsn1.value[0];
    const statusAsn1 = pkiStatusInfo.value[0];
    const statusCode = statusAsn1.value.charCodeAt(statusAsn1.value.length - 1);

    if (statusCode !== 0 && statusCode !== 1) {
      let statusString = '';
      if (pkiStatusInfo.value.length > 1 && pkiStatusInfo.value[1].value) {
        try {
          statusString = pkiStatusInfo.value[1].value
            .map((s: any) => s.value)
            .join('; ');
        } catch {}
      }
      throw new Error(
        `Máy chủ TSA từ chối yêu cầu đóng dấu thời gian (Mã trạng thái RFC 3161: ${statusCode}${
          statusString ? `, Lý do: ${statusString}` : ''
        })`
      );
    }

    if (respAsn1.value.length < 2) {
      throw new Error('TimeStampResp có trạng thái thành công nhưng thiếu timeStampToken.');
    }

    const timeStampTokenAsn1 = respAsn1.value[1];
    const tokenDer = Buffer.from(asn1.toDer(timeStampTokenAsn1).getBytes(), 'binary');

    // Xác minh mật mã ngay lập tức cho TimeStampToken vừa nhận được
    const verifyResult = TimestampTokenVerifier.verifyToken(
      tokenDer,
      expectedDigest,
      expectedNonce
    );

    if (!verifyResult.isValid) {
      throw new Error(
        `TimeStampToken từ TSA không vượt qua kiểm tra toàn vẹn mật mã: ${verifyResult.errorMessage}`
      );
    }

    return {
      tokenDer,
      genTime: verifyResult.genTime!,
      serialNumber: verifyResult.serialNumber!,
      policyOid: verifyResult.policyOid!,
      tsaSubjectDn: verifyResult.tsaSubjectDn!,
      tsaIssuerDn: verifyResult.tsaIssuerDn!,
      tsaCertificatePem: verifyResult.tsaCertificatePem!,
      hashAlgorithm: 'sha256',
      hashedMessageHex: expectedDigest.toString('hex'),
    };
  }

  /**
   * Gửi yêu cầu TimeStampReq tới máy chủ TSA qua HTTP(S) và nhận về TimeStampToken
   */
  public async requestTimestamp(
    digest32Bytes: Buffer,
    options: TimestampRequestOptions = {}
  ): Promise<TimestampTokenResult> {
    const timeoutMs = options.timeoutMs || this.defaultTimeoutMs;
    const { reqDer, nonceHex } = Rfc3161TimestampClient.buildTimeStampReq(
      digest32Bytes,
      options
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(this.tsaUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/timestamp-query',
          Accept: 'application/timestamp-reply',
        },
        body: new Uint8Array(reqDer),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Máy chủ TSA trả về mã lỗi HTTP: ${response.status} (${response.statusText})`
        );
      }

      const contentType = response.headers.get('content-type') || '';
      if (
        !contentType.includes('application/timestamp-reply') &&
        !contentType.includes('application/octet-stream')
      ) {
        // Cảnh báo nếu Content-Type không chuẩn nhưng vẫn tiếp tục parse nếu dữ liệu hợp lệ
      }

      const arrayBuf = await response.arrayBuffer();
      const respBuffer = Buffer.from(arrayBuf);

      if (respBuffer.length > this.maxResponseSizeBytes) {
        throw new Error(
          `Dung lượng phản hồi từ TSA (${respBuffer.length} bytes) vượt quá ngưỡng an toàn cho phép (${this.maxResponseSizeBytes} bytes).`
        );
      }

      return Rfc3161TimestampClient.parseTimeStampResp(
        respBuffer,
        digest32Bytes,
        nonceHex
      );
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`Quá thời gian chờ phản hồi từ máy chủ TSA (${timeoutMs}ms).`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
