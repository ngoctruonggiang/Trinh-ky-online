import * as crypto from 'crypto';
import * as forge from 'node-forge';
import { TimestampVerificationResult } from './timestamp.interface.js';

// OID quy chuẩn cho Dấu thời gian RFC 3161 và CMS
export const OID_ID_SIGNED_DATA = '1.2.840.113549.1.7.2';
export const OID_ID_CT_TST_INFO = '1.2.840.113549.1.9.16.1.4';
export const OID_ID_AA_SIGNATURE_TIMESTAMP_TOKEN = '1.2.840.113549.1.9.16.2.14';
export const OID_ID_KP_TIME_STAMPING = '1.3.6.1.5.5.7.3.8';
export const OID_SHA256 = '2.16.840.1.101.3.4.2.1';
export const OID_EXT_KEY_USAGE = '2.5.29.37';

/**
 * Trình xác minh độc lập RFC 3161 TimeStampToken
 */
export class TimestampTokenVerifier {
  /**
   * Xác minh toàn diện tính hợp lệ mật mã của một RFC 3161 TimeStampToken
   * @param tokenDer Buffer nhị phân ASN.1 DER của TimeStampToken (ContentInfo)
   * @param expectedDigest Mã băm mong đợi (đối với chữ ký PDF, đây là SHA-256 của signatureValue)
   * @param expectedNonce Chuỗi nonce hex mong đợi (nếu request đã gửi nonce)
   */
  public static verifyToken(
    tokenDer: Buffer,
    expectedDigest: Buffer,
    expectedNonce?: string
  ): TimestampVerificationResult {
    if (!tokenDer || tokenDer.length === 0) {
      return {
        isValid: false,
        isDigestValid: false,
        isSignatureValid: false,
        isEkuValid: false,
        errorMessage: 'TimeStampToken nhị phân rỗng.',
      };
    }

    const asn1 = forge.asn1;
    const pki = forge.pki;

    try {
      const asn1Obj: any = asn1.fromDer(tokenDer.toString('binary'));
      if (asn1Obj.tagClass !== asn1.Class.UNIVERSAL || asn1Obj.type !== asn1.Type.SEQUENCE) {
        return {
          isValid: false,
          isDigestValid: false,
          isSignatureValid: false,
          isEkuValid: false,
          errorMessage: 'TimeStampToken không phải là ASN.1 SEQUENCE hợp lệ.',
        };
      }

      // 1. Phân tích ContentInfo: contentType phải là id-signedData
      const contentTypeOid = asn1.derToOid(asn1Obj.value[0].value);
      if (contentTypeOid !== OID_ID_SIGNED_DATA) {
        return {
          isValid: false,
          isDigestValid: false,
          isSignatureValid: false,
          isEkuValid: false,
          errorMessage: `TimeStampToken contentType không hợp lệ. Kỳ vọng id-signedData (${OID_ID_SIGNED_DATA}), nhận được: ${contentTypeOid}`,
        };
      }

      // content: [0] EXPLICIT SignedData
      const explicitContent = asn1Obj.value[1];
      const signedDataSeq = explicitContent.value[0];

      // 2. Trích xuất encapContentInfo trong SignedData
      let encapContentInfoSeq: any = null;
      let certsItem: any = null;
      let signerInfosSet: any = null;

      for (const item of signedDataSeq.value) {
        if (item.tagClass === asn1.Class.UNIVERSAL && item.type === asn1.Type.SEQUENCE) {
          // encapContentInfo có eContentType là id-ct-TSTInfo
          if (item.value && item.value.length >= 2) {
            try {
              const eTypeOid = asn1.derToOid(item.value[0].value);
              if (eTypeOid === OID_ID_CT_TST_INFO) {
                encapContentInfoSeq = item;
              }
            } catch {}
          }
        } else if (item.tagClass === asn1.Class.CONTEXT_SPECIFIC && item.type === 0) {
          // [0] IMPLICIT certificates
          certsItem = item;
        } else if (item.tagClass === asn1.Class.UNIVERSAL && item.type === asn1.Type.SET) {
          // signerInfos SET
          signerInfosSet = item;
        }
      }

      if (!encapContentInfoSeq) {
        return {
          isValid: false,
          isDigestValid: false,
          isSignatureValid: false,
          isEkuValid: false,
          errorMessage: 'Không tìm thấy encapContentInfo với eContentType id-ct-TSTInfo (1.2.840.113549.1.9.16.1.4).',
        };
      }

      // eContent: [0] EXPLICIT OCTET STRING chứa TSTInfo DER
      const eContentWrapper = encapContentInfoSeq.value[1];
      let tstInfoDerBytes: string;
      if (eContentWrapper.tagClass === asn1.Class.CONTEXT_SPECIFIC && eContentWrapper.type === 0) {
        tstInfoDerBytes = eContentWrapper.value[0].value;
      } else if (eContentWrapper.tagClass === asn1.Class.UNIVERSAL && eContentWrapper.type === asn1.Type.OCTETSTRING) {
        tstInfoDerBytes = eContentWrapper.value;
      } else {
        tstInfoDerBytes = eContentWrapper.value[0].value;
      }

      const tstInfoBuffer = Buffer.from(tstInfoDerBytes, 'binary');
      const tstInfoAsn1: any = asn1.fromDer(tstInfoDerBytes);

      // 3. Phân tích TSTInfo
      // version INTEGER
      const tstVersion = forge.util.bytesToHex(tstInfoAsn1.value[0].value);
      // policy TSAPolicyId (OID)
      const policyOid = asn1.derToOid(tstInfoAsn1.value[1].value);
      // messageImprint SEQUENCE { hashAlgorithm, hashedMessage }
      const msgImprintSeq = tstInfoAsn1.value[2];
      const hashAlgoOid = asn1.derToOid(msgImprintSeq.value[0].value[0].value);
      const hashedMessageBytes = Buffer.from(msgImprintSeq.value[1].value, 'binary');
      // serialNumber INTEGER
      const serialNumber = forge.util.bytesToHex(tstInfoAsn1.value[3].value);
      // genTime GeneralizedTime
      const genTimeStr = tstInfoAsn1.value[4].value;
      const genTime = asn1.generalizedTimeToDate(genTimeStr);

      // Optional fields: accuracy, ordering, nonce
      let tokenNonce: string | null = null;
      for (let i = 5; i < tstInfoAsn1.value.length; i++) {
        const field = tstInfoAsn1.value[i];
        if (field.tagClass === asn1.Class.UNIVERSAL && field.type === asn1.Type.INTEGER) {
          tokenNonce = forge.util.bytesToHex(field.value);
        }
      }

      // 4. KIỂM TRA ĐỐI SOÁT MÃ BĂM (Message Imprint Verification)
      const isDigestValid = expectedDigest.equals(hashedMessageBytes);
      if (!isDigestValid) {
        return {
          isValid: false,
          isDigestValid: false,
          isSignatureValid: false,
          isEkuValid: false,
          genTime,
          serialNumber,
          policyOid,
          errorMessage: `Mã băm messageImprint trong TimeStampToken (${hashedMessageBytes.toString('hex')}) không khớp với mã băm chữ ký (${expectedDigest.toString('hex')}).`,
        };
      }

      // 5. KIỂM TRA NONCE (nếu request có gửi nonce)
      if (expectedNonce) {
        const cleanExpected = expectedNonce.toLowerCase().replace(/^0x/, '');
        const cleanToken = (tokenNonce || '').toLowerCase().replace(/^0x/, '');
        if (cleanExpected !== cleanToken) {
          return {
            isValid: false,
            isDigestValid: true,
            isSignatureValid: false,
            isEkuValid: false,
            genTime,
            serialNumber,
            policyOid,
            errorMessage: `Nonce trong TimeStampToken (${cleanToken}) không khớp với request nonce (${cleanExpected}). Nghi ngờ tấn công phát lại (Replay Attack).`,
          };
        }
      }

      // 6. KIỂM TRA CHỨNG THƯ SỐ CỦA TSA VÀ EXTENDED KEY USAGE (EKU)
      if (!certsItem || !certsItem.value || certsItem.value.length === 0) {
        return {
          isValid: false,
          isDigestValid: true,
          isSignatureValid: false,
          isEkuValid: false,
          genTime,
          serialNumber,
          policyOid,
          errorMessage: 'Không tìm thấy chứng thư số của TSA nhúng trong TimeStampToken.',
        };
      }

      const tsaCertAsn1 = certsItem.value[0];
      const tsaCert = pki.certificateFromAsn1(tsaCertAsn1);
      const tsaCertPem = pki.certificateToPem(tsaCert);

      const tsaSubjectDn = tsaCert.subject.attributes
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

      const tsaIssuerDn = tsaCert.issuer.attributes
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

      // Kiểm tra EKU: Bắt buộc có OID id-kp-timeStamping (1.3.6.1.5.5.7.3.8) theo RFC 3161
      let hasTimeStampingEku = false;
      const extKeyUsageExt = tsaCert.extensions.find((ext: any) => ext.id === OID_EXT_KEY_USAGE || ext.name === 'extKeyUsage');
      if (extKeyUsageExt) {
        if (Array.isArray((extKeyUsageExt as any).value)) {
          // Phân tích ASN.1 value
          try {
            const extAsn1: any = asn1.fromDer((extKeyUsageExt as any).value);
            for (const item of extAsn1.value) {
              const oid = asn1.derToOid((item as any).value);
              if (oid === OID_ID_KP_TIME_STAMPING) {
                hasTimeStampingEku = true;
                break;
              }
            }
          } catch {}
        }
        // Kiểm tra qua cờ forge boolean nếu có
        if ((extKeyUsageExt as any).timeStamping === true) {
          hasTimeStampingEku = true;
        }
      }

      // Kiểm tra trực tiếp trong extensions nếu parse dạng chuỗi
      if (!hasTimeStampingEku) {
        for (const ext of tsaCert.extensions) {
          if (ext.id === OID_EXT_KEY_USAGE) {
            try {
              const derVal = typeof ext.value === 'string' ? ext.value : (ext as any).value;
              if (derVal.indexOf(forge.asn1.oidToDer(OID_ID_KP_TIME_STAMPING).getBytes()) !== -1) {
                hasTimeStampingEku = true;
                break;
              }
            } catch {}
          }
        }
      }

      if (!hasTimeStampingEku) {
        return {
          isValid: false,
          isDigestValid: true,
          isSignatureValid: false,
          isEkuValid: false,
          genTime,
          serialNumber,
          policyOid,
          tsaSubjectDn,
          tsaIssuerDn,
          tsaCertificatePem: tsaCertPem,
          errorMessage:
            'Chứng thư số của TSA không chứa thuộc tính mở rộng Extended Key Usage id-kp-timeStamping (1.3.6.1.5.5.7.3.8) theo quy định RFC 3161.',
        };
      }

      // Kiểm tra thời hạn chứng thư tại thời điểm genTime
      if (genTime < tsaCert.validity.notBefore || genTime > tsaCert.validity.notAfter) {
        return {
          isValid: false,
          isDigestValid: true,
          isSignatureValid: false,
          isEkuValid: true,
          genTime,
          serialNumber,
          policyOid,
          tsaSubjectDn,
          tsaIssuerDn,
          tsaCertificatePem: tsaCertPem,
          errorMessage: `Thời điểm cấp dấu thời gian (${genTime.toISOString()}) nằm ngoài thời hạn hiệu lực của chứng thư TSA.`,
        };
      }

      // 7. XÁC MINH CHỮ KÝ MẬT MÃ CỦA TSA TRÊN TSTINFO
      if (!signerInfosSet || !signerInfosSet.value || signerInfosSet.value.length === 0) {
        return {
          isValid: false,
          isDigestValid: true,
          isSignatureValid: false,
          isEkuValid: true,
          genTime,
          serialNumber,
          policyOid,
          tsaSubjectDn,
          tsaIssuerDn,
          tsaCertificatePem: tsaCertPem,
          errorMessage: 'Không tìm thấy SignerInfo của TSA trong SignedData.',
        };
      }

      const tsaSignerInfo = signerInfosSet.value[0];
      let tsaSignedAttrsItem: any = null;
      let tsaSigValueBytes: string | null = null;

      for (const item of tsaSignerInfo.value) {
        if (item.tagClass === asn1.Class.CONTEXT_SPECIFIC && item.type === 0) {
          tsaSignedAttrsItem = item;
        } else if (
          item.tagClass === asn1.Class.UNIVERSAL &&
          item.type === asn1.Type.OCTETSTRING &&
          item.value.length >= 64
        ) {
          tsaSigValueBytes = item.value;
        }
      }

      if (!tsaSigValueBytes) {
        return {
          isValid: false,
          isDigestValid: true,
          isSignatureValid: false,
          isEkuValid: true,
          genTime,
          serialNumber,
          policyOid,
          tsaSubjectDn,
          tsaIssuerDn,
          tsaCertificatePem: tsaCertPem,
          errorMessage: 'Không tìm thấy SignatureValue của TSA.',
        };
      }

      const tsaSignatureBuffer = Buffer.from(tsaSigValueBytes, 'binary');
      const tsaPublicKey = crypto.createPublicKey(tsaCertPem);
      let isTsaSigValid = false;

      if (tsaSignedAttrsItem) {
        // Tái tạo lại signedAttrs dạng SET (tag 0x31)
        const tsaSignedAttrsSet = asn1.create(
          asn1.Class.UNIVERSAL,
          asn1.Type.SET,
          true,
          tsaSignedAttrsItem.value
        );
        const derTsaSignedAttrs = Buffer.from(asn1.toDer(tsaSignedAttrsSet).getBytes(), 'binary');

        // Kiểm tra messageDigest trong signedAttrs phải khớp hash của tstInfoBuffer
        let tstEmbeddedDigest: Buffer | null = null;
        for (const attr of tsaSignedAttrsItem.value) {
          const attrOid = asn1.derToOid(attr.value[0].value);
          if (attrOid === '1.2.840.113549.1.9.4') {
            tstEmbeddedDigest = Buffer.from(attr.value[1].value[0].value, 'binary');
          }
        }

        const actualTstDigest = crypto.createHash('sha256').update(tstInfoBuffer).digest();
        if (tstEmbeddedDigest && !tstEmbeddedDigest.equals(actualTstDigest)) {
          return {
            isValid: false,
            isDigestValid: true,
            isSignatureValid: false,
            isEkuValid: true,
            genTime,
            serialNumber,
            policyOid,
            tsaSubjectDn,
            tsaIssuerDn,
            tsaCertificatePem: tsaCertPem,
            errorMessage: 'messageDigest trong SignedAttributes của TSA không khớp với hash của TSTInfo.',
          };
        }

        isTsaSigValid = crypto.verify('sha256', derTsaSignedAttrs, tsaPublicKey, tsaSignatureBuffer);
      } else {
        // Ký trực tiếp trên tstInfoBuffer
        isTsaSigValid = crypto.verify('sha256', tstInfoBuffer, tsaPublicKey, tsaSignatureBuffer);
      }

      if (!isTsaSigValid) {
        return {
          isValid: false,
          isDigestValid: true,
          isSignatureValid: false,
          isEkuValid: true,
          genTime,
          serialNumber,
          policyOid,
          tsaSubjectDn,
          tsaIssuerDn,
          tsaCertificatePem: tsaCertPem,
          errorMessage: 'Chữ ký mật mã của TSA trên TSTInfo không hợp lệ hoặc đã bị can thiệp.',
        };
      }

      return {
        isValid: true,
        isDigestValid: true,
        isSignatureValid: true,
        isEkuValid: true,
        genTime,
        serialNumber,
        policyOid,
        tsaSubjectDn,
        tsaIssuerDn,
        tsaCertificatePem: tsaCertPem,
      };
    } catch (err: any) {
      return {
        isValid: false,
        isDigestValid: false,
        isSignatureValid: false,
        isEkuValid: false,
        errorMessage: `Lỗi khi phân tích cú pháp TimeStampToken: ${err.message}`,
      };
    }
  }
}
