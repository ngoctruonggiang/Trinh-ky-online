import * as crypto from 'crypto';
import * as forge from 'node-forge';
import { PdfSignatureVerificationResult } from '@trinh-ky/shared';

/**
 * Bộ xác minh chữ ký số PDF và CMS Detached độc lập trong backend.
 * 
 * Kiểm tra đầy đủ:
 * 1. Cấu trúc bảng /ByteRange và ranh giới tệp PDF.
 * 2. Tính toàn vẹn nhị phân: Băm SHA-256 các vùng byte chỉ định và đối chiếu messageDigest.
 * 3. Tính toán mật mã: Tái tạo SignedAttributes SET và đối soát chữ ký RSA với khóa công khai X.509.
 * 4. Phát hiện can thiệp nhị phân (Tamper Detection).
 */
export class PdfSignatureVerifier {
  public static verify(signedPdfBuffer: Buffer): PdfSignatureVerificationResult {
    if (!signedPdfBuffer || signedPdfBuffer.length === 0) {
      return {
        isValid: false,
        isDigestValid: false,
        isSignatureValid: false,
        isTampered: true,
        errorMessage: 'Tệp dữ liệu PDF rỗng.',
      };
    }

    // 1. Kiểm tra magic bytes
    if (signedPdfBuffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      return {
        isValid: false,
        isDigestValid: false,
        isSignatureValid: false,
        isTampered: true,
        errorMessage: 'Tệp không phải là định dạng PDF hợp lệ (thiếu %PDF- header).',
      };
    }

    // 2. Tìm bảng /ByteRange
    const byteRangeTag = Buffer.from('/ByteRange');
    const byteRangeIndex = signedPdfBuffer.indexOf(byteRangeTag);
    if (byteRangeIndex === -1) {
      return {
        isValid: false,
        isDigestValid: false,
        isSignatureValid: false,
        isTampered: false,
        errorMessage: 'Tệp PDF không chứa bảng /ByteRange của chữ ký số.',
      };
    }

    // Đọc mảng [ offset1 len1 offset2 len2 ]
    const openBracket = signedPdfBuffer.indexOf('[', byteRangeIndex);
    const closeBracket = signedPdfBuffer.indexOf(']', openBracket);
    if (openBracket === -1 || closeBracket === -1 || closeBracket <= openBracket) {
      return {
        isValid: false,
        isDigestValid: false,
        isSignatureValid: false,
        isTampered: true,
        errorMessage: 'Cú pháp mảng /ByteRange bị hỏng hoặc không đúng định dạng.',
      };
    }

    const byteRangeRaw = signedPdfBuffer.subarray(openBracket + 1, closeBracket).toString('ascii');
    const byteRangeNumbers = byteRangeRaw
      .trim()
      .split(/\s+/)
      .map((n) => parseInt(n, 10))
      .filter((n) => !isNaN(n));

    if (byteRangeNumbers.length !== 4) {
      return {
        isValid: false,
        isDigestValid: false,
        isSignatureValid: false,
        isTampered: true,
        errorMessage: `Bảng /ByteRange không đủ 4 phần tử (nhận được: ${byteRangeNumbers.length}).`,
      };
    }

    const [offset1, len1, offset2, len2] = byteRangeNumbers;

    // Kiểm tra tính hợp lệ của các khoảng byte
    if (
      offset1 !== 0 ||
      len1 <= 0 ||
      offset2 <= len1 ||
      len2 <= 0 ||
      offset2 + len2 !== signedPdfBuffer.length
    ) {
      return {
        isValid: false,
        isDigestValid: false,
        isSignatureValid: false,
        isTampered: true,
        byteRange: byteRangeNumbers,
        errorMessage:
          'Bảng /ByteRange không bao phủ trọn vẹn tệp PDF từ byte 0 đến EOF hoặc offset bị sai lệch.',
      };
    }

    // 3. Trích xuất Contents hex string nằm giữa len1 và offset2
    // byte tại len1 phải là '<' và byte tại offset2 - 1 phải là '>'
    const startAngle = signedPdfBuffer.indexOf('<', len1 - 20 > 0 ? len1 - 20 : 0);
    const endAngle = signedPdfBuffer.indexOf('>', offset2 - 10 > 0 ? offset2 - 10 : len1);

    if (startAngle === -1 || endAngle === -1 || endAngle <= startAngle) {
      return {
        isValid: false,
        isDigestValid: false,
        isSignatureValid: false,
        isTampered: true,
        byteRange: byteRangeNumbers,
        errorMessage: 'Không tìm thấy cặp thẻ <...> bao bọc chữ ký CMS trong /Contents.',
      };
    }

    const hexContents = signedPdfBuffer.subarray(startAngle + 1, endAngle).toString('ascii');
    if (!hexContents || hexContents.length === 0) {
      return {
        isValid: false,
        isDigestValid: false,
        isSignatureValid: false,
        isTampered: true,
        byteRange: byteRangeNumbers,
        errorMessage: 'Dữ liệu /Contents rỗng.',
      };
    }

    // 4. Trích xuất các vùng byte chỉ định bởi ByteRange và tính SHA-256
    const part1 = signedPdfBuffer.subarray(0, len1);
    const part2 = signedPdfBuffer.subarray(offset2, offset2 + len2);
    const signedData = Buffer.concat([part1, part2]);
    const computedDigest = crypto.createHash('sha256').update(signedData).digest();
    const computedDigestHex = computedDigest.toString('hex');

    // 5. Giải mã CMS DER từ Hex string
    // Xác định độ dài thực tế của cấu trúc ASN.1 DER từ header để loại bỏ trailing zero padding
    const rawCmsBuffer = Buffer.from(hexContents, 'hex');
    if (rawCmsBuffer.length < 4 || rawCmsBuffer[0] !== 0x30) {
      return {
        isValid: false,
        isDigestValid: false,
        isSignatureValid: false,
        isTampered: true,
        byteRange: byteRangeNumbers,
        computedDigestHex,
        errorMessage: 'Dữ liệu trong /Contents không phải là cấu trúc ASN.1 Sequence hợp lệ.',
      };
    }

    let derLength = 0;
    let headerOffset = 0;
    if (rawCmsBuffer[1] < 0x80) {
      derLength = rawCmsBuffer[1];
      headerOffset = 2;
    } else {
      const numLengthBytes = rawCmsBuffer[1] & 0x7f;
      derLength = 0;
      for (let i = 0; i < numLengthBytes; i++) {
        derLength = (derLength << 8) | rawCmsBuffer[2 + i];
      }
      headerOffset = 2 + numLengthBytes;
    }
    const totalDerSize = headerOffset + derLength;

    if (totalDerSize > rawCmsBuffer.length) {
      return {
        isValid: false,
        isDigestValid: false,
        isSignatureValid: false,
        isTampered: true,
        byteRange: byteRangeNumbers,
        computedDigestHex,
        errorMessage: 'Cấu trúc ASN.1 DER của CMS bị cắt cụt (Truncated CMS buffer).',
      };
    }

    const actualCmsDer = rawCmsBuffer.subarray(0, totalDerSize);

    // 6. Phân tích cấu trúc CMS bằng node-forge
    try {
      const asn1 = forge.asn1;
      const pki = forge.pki;

      const cmsAsn1 = asn1.fromDer(actualCmsDer.toString('binary'));
      // ContentInfo: [0] OID 1.2.840.113549.1.7.2, [1] [0] SignedData
      const signedDataSeq = (cmsAsn1 as any).value[1].value[0];

      // certificates [0] IMPLICIT
      let certsList: any[] = [];
      let signerInfoSeq: any = null;

      for (const item of signedDataSeq.value) {
        if (item.tagClass === asn1.Class.CONTEXT_SPECIFIC && item.type === 0) {
          certsList = item.value;
        } else if (item.tagClass === asn1.Class.UNIVERSAL && item.type === asn1.Type.SET) {
          // signerInfos SET
          signerInfoSeq = item.value[0];
        }
      }

      if (!signerInfoSeq) {
        return {
          isValid: false,
          isDigestValid: false,
          isSignatureValid: false,
          isTampered: true,
          byteRange: byteRangeNumbers,
          computedDigestHex,
          errorMessage: 'Không tìm thấy SignerInfo trong cấu trúc SignedData của CMS.',
        };
      }

      // Trích xuất chứng thư số người ký
      if (!certsList || certsList.length === 0) {
        return {
          isValid: false,
          isDigestValid: false,
          isSignatureValid: false,
          isTampered: true,
          byteRange: byteRangeNumbers,
          computedDigestHex,
          errorMessage: 'Không tìm thấy chứng thư số X.509 nhúng trong chữ ký CMS.',
        };
      }

      const signerCert = pki.certificateFromAsn1(certsList[0]);
      const signerCertPem = pki.certificateToPem(signerCert);
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

      // Trích xuất signedAttrs và signatureValue từ signerInfo
      let signedAttrsItem: any = null;
      let signatureValueBytes: string | null = null;

      for (const item of signerInfoSeq.value) {
        if (item.tagClass === asn1.Class.CONTEXT_SPECIFIC && item.type === 0) {
          // [0] IMPLICIT signedAttrs
          signedAttrsItem = item;
        } else if (
          item.tagClass === asn1.Class.UNIVERSAL &&
          item.type === asn1.Type.OCTETSTRING &&
          item.value.length >= 128
        ) {
          signatureValueBytes = item.value;
        }
      }

      if (!signedAttrsItem || !signatureValueBytes) {
        return {
          isValid: false,
          isDigestValid: false,
          isSignatureValid: false,
          isTampered: true,
          byteRange: byteRangeNumbers,
          computedDigestHex,
          errorMessage: 'Thiếu SignedAttributes hoặc SignatureValue trong SignerInfo.',
        };
      }

      // Tìm messageDigest và signingTime trong SignedAttributes
      let embeddedMessageDigest: Buffer | null = null;
      let signingTimeDate: Date | null = null;

      for (const attr of signedAttrsItem.value) {
        const attrOid = asn1.derToOid(attr.value[0].value);
        if (attrOid === '1.2.840.113549.1.9.4') {
          // messageDigest: SET OF OCTET STRING
          const octetVal = attr.value[1].value[0].value;
          embeddedMessageDigest = Buffer.from(octetVal, 'binary');
        } else if (attrOid === '1.2.840.113549.1.9.5') {
          // signingTime: SET OF UTCTime
          const utcVal = attr.value[1].value[0].value;
          signingTimeDate = asn1.utcTimeToDate(utcVal);
        }
      }

      if (!embeddedMessageDigest) {
        return {
          isValid: false,
          isDigestValid: false,
          isSignatureValid: false,
          isTampered: true,
          byteRange: byteRangeNumbers,
          computedDigestHex,
          errorMessage: 'Thuộc tính messageDigest không tồn tại trong SignedAttributes.',
        };
      }

      const embeddedDigestHex = embeddedMessageDigest.toString('hex');

      // 7. KIỂM TRA ĐỐI SOÁT MÃ BĂM (Integrity Check)
      const isDigestValid = computedDigest.equals(embeddedMessageDigest);
      if (!isDigestValid) {
        return {
          isValid: false,
          isDigestValid: false,
          isSignatureValid: false,
          isTampered: true,
          signerSubject: signerSubjectDn,
          signerIssuer: signerIssuerDn,
          serialNumber,
          signingTime: signingTimeDate?.toISOString(),
          byteRange: byteRangeNumbers,
          messageDigestHex: embeddedDigestHex,
          computedDigestHex,
          errorMessage:
            'Mã băm dữ liệu ByteRange không khớp với giá trị messageDigest trong chữ ký số. Tệp PDF đã bị can thiệp trái phép sau khi ký (Document Tampered).',
        };
      }

      // 8. KIỂM TRA CHỮ KÝ MẬT MÃ RSA TRÊN SIGNED ATTRIBUTES (Cryptographic Check)
      // Tái tạo lại SignedAttributes dưới dạng SET (tag 0x31)
      const signedAttrsSet = asn1.create(
        asn1.Class.UNIVERSAL,
        asn1.Type.SET,
        true,
        signedAttrsItem.value
      );
      const derSignedAttrsSet = Buffer.from(asn1.toDer(signedAttrsSet).getBytes(), 'binary');
      const signatureBuffer = Buffer.from(signatureValueBytes, 'binary');

      const pubKey = crypto.createPublicKey(signerCertPem);
      const isSignatureValid = crypto.verify(
        'sha256',
        derSignedAttrsSet,
        pubKey,
        signatureBuffer
      );

      if (!isSignatureValid) {
        return {
          isValid: false,
          isDigestValid: true,
          isSignatureValid: false,
          isTampered: true,
          signerSubject: signerSubjectDn,
          signerIssuer: signerIssuerDn,
          serialNumber,
          signingTime: signingTimeDate?.toISOString(),
          byteRange: byteRangeNumbers,
          messageDigestHex: embeddedDigestHex,
          computedDigestHex,
          errorMessage:
            'Chữ ký số RSA không thể xác minh bằng khóa công khai của chứng thư số X.509 kèm theo.',
        };
      }

      return {
        isValid: true,
        isDigestValid: true,
        isSignatureValid: true,
        isTampered: false,
        signerSubject: signerSubjectDn,
        signerIssuer: signerIssuerDn,
        serialNumber,
        signingTime: signingTimeDate?.toISOString(),
        byteRange: byteRangeNumbers,
        messageDigestHex: embeddedDigestHex,
        computedDigestHex,
      };
    } catch (parseErr: any) {
      return {
        isValid: false,
        isDigestValid: false,
        isSignatureValid: false,
        isTampered: true,
        byteRange: byteRangeNumbers,
        computedDigestHex,
        errorMessage: `Lỗi khi phân tích cú pháp CMS: ${parseErr.message}`,
      };
    }
  }
}
