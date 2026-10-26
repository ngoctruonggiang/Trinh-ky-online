import * as crypto from 'crypto';
import * as forge from 'node-forge';
import { ISigningKeyProvider } from '../providers/signing-key-provider.interface.js';
import {
  ITimestampAuthorityProvider,
  TimestampTokenResult,
} from '../timestamp/timestamp.interface.js';
import { OID_ID_AA_SIGNATURE_TIMESTAMP_TOKEN } from '../timestamp/timestamp-token.verifier.js';

export interface BuildCmsSignatureOptions {
  /** Mã băm SHA-256 (32 byte) của vùng dữ liệu ByteRange */
  messageDigest: Buffer;
  /** Thời điểm ký */
  signingTime?: Date;
  /** Chuỗi PEM của chứng thư số X.509 dùng để ký */
  signerCertificatePem: string;
  /** Danh sách chuỗi PEM chứng thư số trung gian (CA Chain nếu có) */
  certificateChainPem?: string[];
  /** Định danh khóa ký trong Key Provider */
  keyAlias: string;
  /** Key Provider thực hiện ký digest */
  keyProvider: ISigningKeyProvider;
  /** Chuẩn phụ: adbe.pkcs7.detached hoặc ETSI.CAdES.detached */
  subFilter?: 'adbe.pkcs7.detached' | 'ETSI.CAdES.detached';
  /** Nhà cung cấp dấu thời gian RFC 3161 TSA (tùy chọn) */
  tsaProvider?: ITimestampAuthorityProvider;
  /** Yêu cầu bắt buộc dấu thời gian tin cậy (mặc định false) */
  requireTimestamp?: boolean;
}

export interface CmsSignatureResult {
  cmsDer: Buffer;
  signerCertificatePem: string;
  signerSubjectDn: string;
  signerIssuerDn: string;
  serialNumber: string;
  signingTime: Date;
  messageDigestHex: string;
  signatureHex: string;
  hasTimestamp: boolean;
  timestampTokenDer?: Buffer;
  timestampGenTime?: Date;
  tsaSubjectDn?: string;
  tsaIssuerDn?: string;
  tsaSerialNumber?: string;
  tsaPolicyOid?: string;
}

/**
 * Trình khởi tạo chữ ký CMS Detached (PKCS#7) tuân thủ RFC 5652 / ISO 32000-1 cho chữ ký số PDF,
 * hỗ trợ nhúng RFC 3161 TimeStampToken trong UnsignedAttributes (PAdES Baseline B-T Readiness).
 * 
 * NGUYÊN TẮC BẢO MẬT & MẬT MÃ:
 * - Không bao giờ truy cập hoặc yêu cầu khóa riêng (Private Key).
 * - Hoàn toàn độc lập với vị trí lưu trữ khóa (Local Keystore hay Remote Cloud KMS / HSM).
 * - Ký trên DER encoding của SignedAttributes có chứa messageDigest khớp chính xác với ByteRange.
 * - Sắp xếp thuộc tính ký theo quy tắc DER Lexicographical Ordering.
 * - Nếu có yêu cầu timestamp, đóng dấu thời gian trên SHA-256 của SignerInfo signatureValue theo RFC 3161.
 */
export class CmsSignatureBuilder {
  public static async buildDetachedSignature(
    options: BuildCmsSignatureOptions
  ): Promise<CmsSignatureResult> {
    const {
      messageDigest,
      keyAlias,
      keyProvider,
      signerCertificatePem,
      certificateChainPem = [],
      signingTime = new Date(),
      tsaProvider,
      requireTimestamp = false,
    } = options;

    if (!Buffer.isBuffer(messageDigest) || messageDigest.length !== 32) {
      throw new Error(
        `messageDigest không hợp lệ. Yêu cầu chính xác 32 byte SHA-256 digest, nhận được: ${messageDigest?.length || 0} bytes`
      );
    }

    const pki = forge.pki;
    const asn1 = forge.asn1;

    // 1. Phân tích chứng thư số người ký
    const signerCert = pki.certificateFromPem(signerCertificatePem);
    const signerCertAsn1 = pki.certificateToAsn1(signerCert);
    const signerSubjectDn = signerCert.subject.attributes
      .map((a) => {
        let val = a.value;
        try {
          if (typeof a.value === 'string') {
            val = forge.util.decodeUtf8(a.value);
          }
        } catch {}
        return `${a.shortName || a.name}=${val}`;
      })
      .join(', ');
    const signerIssuerDn = signerCert.issuer.attributes
      .map((a) => {
        let val = a.value;
        try {
          if (typeof a.value === 'string') {
            val = forge.util.decodeUtf8(a.value);
          }
        } catch {}
        return `${a.shortName || a.name}=${val}`;
      })
      .join(', ');
    const serialNumber = signerCert.serialNumber;

    // 2. Chuẩn bị các thuộc tính ký (SignedAttributes)
    // 2.1. ContentType: 1.2.840.113549.1.9.3 -> id-data (1.2.840.113549.1.7.1)
    const attrContentType = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('1.2.840.113549.1.9.3').getBytes()),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('1.2.840.113549.1.7.1').getBytes()),
      ]),
    ]);

    // 2.2. SigningTime: 1.2.840.113549.1.9.5 -> UTCTime
    const attrSigningTime = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('1.2.840.113549.1.9.5').getBytes()),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.UTCTIME, false, asn1.dateToUtcTime(signingTime)),
      ]),
    ]);

    // 2.3. MessageDigest: 1.2.840.113549.1.9.4 -> OctetString (32-byte digest của ByteRange)
    const attrMessageDigest = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('1.2.840.113549.1.9.4').getBytes()),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, messageDigest.toString('binary')),
      ]),
    ]);

    // 2.4. SigningCertificateV2: 1.2.840.113549.1.9.16.2.47 (RFC 5035 / PAdES)
    const signerCertDer = Buffer.from(asn1.toDer(signerCertAsn1).getBytes(), 'binary');
    const signerCertHash = crypto.createHash('sha256').update(signerCertDer).digest();

    const essCertIdV2 = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      // DigestAlgorithm: sha256 (default in v2)
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('2.16.840.1.101.3.4.2.1').getBytes()),
      ]),
      // certHash: Hash của chứng thư
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, signerCertHash.toString('binary')),
    ]);

    const signingCertificateV2Sequence = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      // certs: SEQUENCE OF ESSCertIDv2
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [essCertIdV2]),
    ]);

    const attrSigningCertV2 = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(
        asn1.Class.UNIVERSAL,
        asn1.Type.OID,
        false,
        asn1.oidToDer('1.2.840.113549.1.9.16.2.47').getBytes()
      ),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [signingCertificateV2Sequence]),
    ]);

    // 3. Sắp xếp thuộc tính ký theo thứ tự Lexicographical DER per RFC 5652
    const signedAttrsList = [attrContentType, attrSigningTime, attrMessageDigest, attrSigningCertV2];
    signedAttrsList.sort((a, b) => {
      const derA = Buffer.from(asn1.toDer(a).getBytes(), 'binary');
      const derB = Buffer.from(asn1.toDer(b).getBytes(), 'binary');
      return derA.compare(derB);
    });

    // 4. Mã hóa tập thuộc tính ký thành DER dạng SET (tag 0x31) để tính digest cần ký
    const signedAttrsSet = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, signedAttrsList);
    const derSignedAttrsSet = Buffer.from(asn1.toDer(signedAttrsSet).getBytes(), 'binary');
    const signedAttrsDigest = crypto.createHash('sha256').update(derSignedAttrsSet).digest();

    // 5. Yêu cầu Provider ký digest (Không export private key)
    const signingResult = await keyProvider.signDigest(keyAlias, signedAttrsDigest);
    const signatureBuffer = signingResult.signatureBytes;

    // 6. Xử lý RFC 3161 Trusted Timestamping (nếu có yêu cầu)
    let timestampResult: TimestampTokenResult | null = null;
    let unsignedAttrsContextSpecific: any = null;

    if (tsaProvider) {
      // Per RFC 3161 và ETSI EN 319 142-1 (PAdES B-T): input là SHA-256 của octets chữ ký người ký (signatureValue)
      const signatureDigest = crypto.createHash('sha256').update(signatureBuffer).digest();

      try {
        timestampResult = await tsaProvider.getTimestampToken(signatureDigest);
      } catch (tsaErr: any) {
        if (requireTimestamp) {
          throw new Error(`Đóng dấu thời gian RFC 3161 thất bại trong chế độ ký bắt buộc timestamp: ${tsaErr.message}`);
        }
      }

      if (timestampResult) {
        // Nhúng TimeStampToken vào unsignedAttrs dưới OID id-aa-signatureTimeStampToken (1.2.840.113549.1.9.16.2.14)
        const tstContentInfoAsn1 = asn1.fromDer(timestampResult.tokenDer.toString('binary'));
        const attrSignatureTimeStamp = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
          asn1.create(
            asn1.Class.UNIVERSAL,
            asn1.Type.OID,
            false,
            asn1.oidToDer(OID_ID_AA_SIGNATURE_TIMESTAMP_TOKEN).getBytes()
          ),
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [tstContentInfoAsn1]),
        ]);

        unsignedAttrsContextSpecific = asn1.create(
          asn1.Class.CONTEXT_SPECIFIC,
          1, // [1] IMPLICIT
          true,
          [attrSignatureTimeStamp]
        );
      }
    }

    // 7. Xây dựng cấu trúc SignerInfo
    const tbsCert = (signerCertAsn1 as any).value[0];
    const serialNumberAsn1 = tbsCert.value[1];
    const issuerAsn1 = tbsCert.value[3];
    const issuerAndSerial = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      issuerAsn1,
      serialNumberAsn1,
    ]);

    // [0] IMPLICIT signedAttrs
    const signedAttrsContextSpecific = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, signedAttrsList);

    const signerInfoElements: any[] = [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, forge.util.hexToBytes('01')), // version 1
      issuerAndSerial,
      // digestAlgorithm: sha256 (2.16.840.1.101.3.4.2.1)
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('2.16.840.1.101.3.4.2.1').getBytes()),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
      ]),
      signedAttrsContextSpecific, // [0] IMPLICIT signedAttrs
      // signatureAlgorithm: rsaEncryption (1.2.840.113549.1.1.1)
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('1.2.840.113549.1.1.1').getBytes()),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
      ]),
      // signatureValue: OCTET STRING chứa signature bytes
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, signatureBuffer.toString('binary')),
    ];

    if (unsignedAttrsContextSpecific) {
      // [1] IMPLICIT unsignedAttrs
      signerInfoElements.push(unsignedAttrsContextSpecific);
    }

    const signerInfo = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, signerInfoElements);

    // 8. Tập hợp chuỗi chứng thư số (Certificates Set)
    const certsAsn1List = [signerCertAsn1];
    for (const chainPem of certificateChainPem) {
      try {
        const chainCert = pki.certificateFromPem(chainPem);
        certsAsn1List.push(pki.certificateToAsn1(chainCert));
      } catch {
        // Bỏ qua chứng thư chain lỗi cú pháp
      }
    }

    // 9. SignedData Sequence
    const signedDataSeq = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, forge.util.hexToBytes('01')), // version 1
      // digestAlgorithms SET
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('2.16.840.1.101.3.4.2.1').getBytes()),
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
        ]),
      ]),
      // encapContentInfo: id-data, detached (không chứa eContent)
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('1.2.840.113549.1.7.1').getBytes()),
      ]),
      // certificates [0] IMPLICIT
      asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, certsAsn1List),
      // signerInfos SET
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [signerInfo]),
    ]);

    // 10. ContentInfo: contentType 1.2.840.113549.1.7.2 (signedData), content [0] EXPLICIT
    const contentInfo = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('1.2.840.113549.1.7.2').getBytes()),
      asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [signedDataSeq]),
    ]);

    const cmsDer = Buffer.from(asn1.toDer(contentInfo).getBytes(), 'binary');

    return {
      cmsDer,
      signerCertificatePem,
      signerSubjectDn,
      signerIssuerDn,
      serialNumber,
      signingTime,
      messageDigestHex: messageDigest.toString('hex'),
      signatureHex: signatureBuffer.toString('hex'),
      hasTimestamp: !!timestampResult,
      timestampTokenDer: timestampResult?.tokenDer,
      timestampGenTime: timestampResult?.genTime,
      tsaSubjectDn: timestampResult?.tsaSubjectDn,
      tsaIssuerDn: timestampResult?.tsaIssuerDn,
      tsaSerialNumber: timestampResult?.serialNumber,
      tsaPolicyOid: timestampResult?.policyOid,
    };
  }
}
