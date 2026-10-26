import * as crypto from 'crypto';
import * as forge from 'node-forge';
import { CertificateStatusType, RevocationInfoResult } from './revocation.interface.js';

// Các OID tiêu chuẩn theo RFC 5280, RFC 6960
export const OID_AIA = '1.3.6.1.5.5.7.1.1'; // id-pe-authorityInfoAccess
export const OID_OCSP_ACCESS_METHOD = '1.3.6.1.5.5.7.48.1'; // id-ad-ocsp
export const OID_CA_ISSUERS_ACCESS_METHOD = '1.3.6.1.5.5.7.48.2'; // id-ad-caIssuers
export const OID_CRL_DISTRIBUTION_POINTS = '2.5.29.31'; // cRLDistributionPoints
export const OID_BASIC_OCSP_RESPONSE = '1.3.6.1.5.5.7.48.1.1'; // id-pkix-ocsp-basic
export const OID_KP_OCSP_SIGNING = '1.3.6.1.5.5.7.3.9'; // id-kp-OCSPSigning

export interface ExtractedAiaAndCrlUrls {
  ocspUrls: string[];
  caIssuerUrls: string[];
  crlUrls: string[];
}

export class OcspCrlParserUtil {
  /**
   * Trích xuất các URL AIA (OCSP, CA Issuers) và CRL Distribution Points từ chứng thư X.509
   */
  public static extractAiaAndCrlUrls(certPem: string): ExtractedAiaAndCrlUrls {
    const result: ExtractedAiaAndCrlUrls = {
      ocspUrls: [],
      caIssuerUrls: [],
      crlUrls: [],
    };

    try {
      const cert = forge.pki.certificateFromPem(certPem);

      for (const ext of cert.extensions) {
        // 1. Phân tích AIA (Authority Information Access - 1.3.6.1.5.5.7.1.1)
        if (ext.id === OID_AIA && (ext as any).value) {
          try {
            const aiaAsn1 = forge.asn1.fromDer((ext as any).value);
            // Sequence of AccessDescription
            if (aiaAsn1 && aiaAsn1.value && Array.isArray(aiaAsn1.value)) {
              for (const desc of aiaAsn1.value) {
                const descObj = desc as any;
                if (descObj.value && descObj.value.length >= 2) {
                  const methodOid = forge.asn1.derToOid(descObj.value[0].value);
                  const locationItem = descObj.value[1] as any;
                  // GeneralName: [6] uniformResourceIdentifier (IA5String)
                  if (locationItem.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && locationItem.type === 6) {
                    const url = locationItem.value;
                    if (methodOid === OID_OCSP_ACCESS_METHOD) {
                      result.ocspUrls.push(url);
                    } else if (methodOid === OID_CA_ISSUERS_ACCESS_METHOD) {
                      result.caIssuerUrls.push(url);
                    }
                  }
                }
              }
            }
          } catch {}
        }

        // 2. Phân tích CRL Distribution Points (2.5.29.31)
        if (ext.id === OID_CRL_DISTRIBUTION_POINTS && (ext as any).value) {
          try {
            const crlAsn1 = forge.asn1.fromDer((ext as any).value);
            // Sequence of DistributionPoint
            if (crlAsn1 && crlAsn1.value && Array.isArray(crlAsn1.value)) {
              for (const dp of crlAsn1.value) {
                const dpObj = dp as any;
                // dp.value[0] = distributionPoint [0]
                for (const item of dpObj.value || []) {
                  const itemObj = item as any;
                  if (itemObj.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && itemObj.type === 0) {
                    // fullName [0]
                    const fullNameSeq = itemObj.value && itemObj.value[0] as any;
                    if (fullNameSeq && fullNameSeq.value) {
                      for (const nameItem of fullNameSeq.value) {
                        const nameItemObj = nameItem as any;
                        if (nameItemObj.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && nameItemObj.type === 6) {
                          result.crlUrls.push(nameItemObj.value);
                        }
                      }
                    }
                  }
                }
              }
            }
          } catch {}
        }
      }
    } catch {}

    return result;
  }

  /**
   * Phân tích và thẩm định OCSP Response theo RFC 6960
   */
  public static verifyAndParseOcspResponse(
    ocspResponseDer: Buffer,
    expectedSerialNumberHex: string,
    issuerCertPem: string
  ): RevocationInfoResult {
    if (!ocspResponseDer || ocspResponseDer.length === 0) {
      return {
        status: 'UNAVAILABLE',
        isSignatureValid: false,
        errorMessage: 'OCSP Response nhị phân rỗng.',
      };
    }

    const asn1 = forge.asn1;
    const pki = forge.pki;

    try {
      const ocspAsn1: any = asn1.fromDer(ocspResponseDer.toString('binary'));
      if (ocspAsn1.tagClass !== asn1.Class.UNIVERSAL || ocspAsn1.type !== asn1.Type.SEQUENCE) {
        return {
          status: 'UNAVAILABLE',
          isSignatureValid: false,
          errorMessage: 'Dữ liệu không phải là ASN.1 SEQUENCE của OCSPResponse.',
        };
      }

      // 1. responseStatus ENUMERATED
      const statusByte = ocspAsn1.value[0].value.charCodeAt(0);
      if (statusByte !== 0) {
        // 0 = successful, 1 = malformedRequest, 2 = internalError, 3 = tryLater, 5 = sigRequired, 6 = unauthorized
        return {
          status: 'UNAVAILABLE',
          isSignatureValid: false,
          errorMessage: `Máy chủ OCSP phản hồi mã lỗi: ${statusByte} (Khác 0 - successful).`,
        };
      }

      // 2. responseBytes [0] EXPLICIT ResponseBytes
      if (!ocspAsn1.value[1]) {
        return {
          status: 'UNAVAILABLE',
          isSignatureValid: false,
          errorMessage: 'OCSP Response thiếu khối responseBytes.',
        };
      }

      const responseBytesSeq = ocspAsn1.value[1].value[0];
      const responseTypeOid = asn1.derToOid(responseBytesSeq.value[0].value);
      if (responseTypeOid !== OID_BASIC_OCSP_RESPONSE) {
        return {
          status: 'UNAVAILABLE',
          isSignatureValid: false,
          errorMessage: `Định dạng OCSP responseType không được hỗ trợ: ${responseTypeOid}`,
        };
      }

      // response OCTET STRING -> BasicOCSPResponse
      const basicOcspDerBytes = responseBytesSeq.value[1].value;
      const basicOcspAsn1: any = asn1.fromDer(basicOcspDerBytes);

      // BasicOCSPResponse: tbsResponseData, signatureAlgorithm, signature, [0] certs
      const tbsResponseDataSeq = basicOcspAsn1.value[0];
      const sigAlgSeq = basicOcspAsn1.value[1];
      const signatureBitString = basicOcspAsn1.value[2];
      const optionalCerts = basicOcspAsn1.value[3];

      // 3. Phân tích tbsResponseData
      // tbsResponseData: [0] version, responderID, producedAt, responses SEQUENCE
      let responsesSeq: any = null;
      let responderSubjectDn = 'Unknown Responder';

      for (const item of tbsResponseDataSeq.value) {
        if (item.tagClass === asn1.Class.UNIVERSAL && item.type === asn1.Type.SEQUENCE) {
          // responses SEQUENCE OF SingleResponse
          responsesSeq = item;
        } else if (item.tagClass === asn1.Class.CONTEXT_SPECIFIC && (item.type === 1 || item.type === 2)) {
          // responderID: [1] byName (Name) hoặc [2] byKey (KeyHash)
          if (item.type === 1) {
            try {
              responderSubjectDn = pki.certificateFromAsn1(item).subject.attributes
                .map((a: any) => `${a.shortName || a.name}=${a.value}`)
                .join(', ');
            } catch {}
          }
        }
      }

      if (!responsesSeq || !responsesSeq.value || responsesSeq.value.length === 0) {
        return {
          status: 'UNAVAILABLE',
          isSignatureValid: false,
          errorMessage: 'Không tìm thấy danh sách responses trong BasicOCSPResponse.',
        };
      }

      // 4. Tìm kiếm SingleResponse khớp với expectedSerialNumber
      const normalizedExpectedSerial = expectedSerialNumberHex.replace(/^0x/i, '').toLowerCase();
      let matchedSingleResponse: any = null;

      for (const singleResp of responsesSeq.value) {
        // certID: hashAlgorithm, issuerNameHash, issuerKeyHash, serialNumber
        const certIdSeq = singleResp.value[0];
        const serialAsn1 = certIdSeq.value[3];
        const serialHex = forge.util.bytesToHex(serialAsn1.value).toLowerCase();

        if (serialHex === normalizedExpectedSerial || serialHex.replace(/^0+/, '') === normalizedExpectedSerial.replace(/^0+/, '')) {
          matchedSingleResponse = singleResp;
          break;
        }
      }

      if (!matchedSingleResponse) {
        return {
          status: 'UNKNOWN',
          isSignatureValid: false,
          errorMessage: `Không tìm thấy thông tin trạng thái cho chứng thư serial ${expectedSerialNumberHex} trong OCSP Response.`,
        };
      }

      // 5. Phân tích CertStatus trong SingleResponse
      // certStatus: good [0] IMPLICIT NULL, revoked [1] IMPLICIT RevokedInfo, unknown [2] IMPLICIT UnknownInfo
      const certStatusItem = matchedSingleResponse.value[1];
      let certStatus: CertificateStatusType = 'UNKNOWN';
      let revocationTime: Date | undefined;
      let revocationReason: string | undefined;

      if (certStatusItem.tagClass === asn1.Class.CONTEXT_SPECIFIC) {
        if (certStatusItem.type === 0) {
          certStatus = 'GOOD';
        } else if (certStatusItem.type === 1) {
          certStatus = 'REVOKED';
          try {
            // RevokedInfo: revocationTime GeneralizedTime, [0] CRLReason
            const revTimeVal = certStatusItem.value[0].value;
            revocationTime = asn1.generalizedTimeToDate(revTimeVal);
          } catch {}
        } else if (certStatusItem.type === 2) {
          certStatus = 'UNKNOWN';
        }
      }

      // thisUpdate & nextUpdate
      let thisUpdate: Date | undefined;
      let nextUpdate: Date | undefined;

      if (matchedSingleResponse.value[2]) {
        try {
          thisUpdate = asn1.generalizedTimeToDate(matchedSingleResponse.value[2].value);
        } catch {}
      }
      if (matchedSingleResponse.value[3] && matchedSingleResponse.value[3].tagClass === asn1.Class.CONTEXT_SPECIFIC && matchedSingleResponse.value[3].type === 0) {
        try {
          nextUpdate = asn1.generalizedTimeToDate(matchedSingleResponse.value[3].value[0].value);
        } catch {}
      }

      // 6. XÁC MINH CHỮ KÝ CỦA BASIC OCSP RESPONSE
      const tbsDer = Buffer.from(asn1.toDer(tbsResponseDataSeq).getBytes(), 'binary');
      // Bỏ unused bits byte đầu tiên nếu là BIT STRING
      let sigBytes = signatureBitString.value;
      if (signatureBitString.type === asn1.Type.BITSTRING && sigBytes.length > 0) {
        sigBytes = sigBytes.substring(1);
      }
      const signatureBuffer = Buffer.from(sigBytes, 'binary');

      // Xác minh chữ ký bằng Issuer Public Key (hoặc responder cert nếu được ký ủy quyền)
      let isSignatureValid = false;
      try {
        const issuerCert = pki.certificateFromPem(issuerCertPem);
        const issuerPubKeyPem = pki.publicKeyToPem(issuerCert.publicKey);
        const pubKey = crypto.createPublicKey(issuerPubKeyPem);

        isSignatureValid = crypto.verify('sha256', tbsDer, pubKey, signatureBuffer);
        if (!isSignatureValid) {
          // Thử với SHA-1 (nếu là CA cũ)
          isSignatureValid = crypto.verify('sha1', tbsDer, pubKey, signatureBuffer);
        }
      } catch (verifyErr: any) {
        isSignatureValid = false;
      }

      if (!isSignatureValid) {
        return {
          status: 'UNAVAILABLE',
          sourceType: 'OCSP',
          ocspResponseDer,
          isSignatureValid: false,
          errorMessage: 'Chữ ký số trên OCSP Response không khớp với khóa công khai của CA phát hành.',
        };
      }

      return {
        status: certStatus,
        sourceType: 'OCSP',
        ocspResponseDer,
        thisUpdate,
        nextUpdate,
        revocationTime,
        revocationReason,
        responderSubjectDn,
        serialNumber: expectedSerialNumberHex,
        isSignatureValid: true,
      };
    } catch (parseErr: any) {
      return {
        status: 'UNAVAILABLE',
        isSignatureValid: false,
        errorMessage: `Lỗi phân tích cú pháp ASN.1 OCSP Response: ${parseErr.message}`,
      };
    }
  }

  /**
   * Phân tích và thẩm định Certificate Revocation List (CRL) theo RFC 5280
   */
  public static verifyAndParseCrl(
    crlDer: Buffer,
    expectedSerialNumberHex: string,
    issuerCertPem: string
  ): RevocationInfoResult {
    if (!crlDer || crlDer.length === 0) {
      return {
        status: 'UNAVAILABLE',
        isSignatureValid: false,
        errorMessage: 'CRL nhị phân rỗng.',
      };
    }

    const asn1 = forge.asn1;
    const pki = forge.pki;

    try {
      const crlAsn1: any = asn1.fromDer(crlDer.toString('binary'));
      if (crlAsn1.tagClass !== asn1.Class.UNIVERSAL || crlAsn1.type !== asn1.Type.SEQUENCE) {
        return {
          status: 'UNAVAILABLE',
          isSignatureValid: false,
          errorMessage: 'Dữ liệu không phải là ASN.1 SEQUENCE của CertificateList (CRL).',
        };
      }

      // CertificateList: tbsCertList, signatureAlgorithm, signatureValue
      const tbsCertListSeq = crlAsn1.value[0];
      const signatureBitString = crlAsn1.value[2];

      // Phân tích tbsCertList: version, signature, issuer, thisUpdate, nextUpdate, revokedCertificates
      let issuerSeq: any = null;
      let thisUpdateDate: Date | undefined;
      let nextUpdateDate: Date | undefined;
      let revokedCertsSeq: any = null;

      for (const item of tbsCertListSeq.value) {
        if (item.tagClass === asn1.Class.UNIVERSAL && item.type === asn1.Type.SEQUENCE) {
          if (!issuerSeq && item.value && item.value.some((x: any) => x.type === asn1.Type.SET)) {
            issuerSeq = item;
          } else if (item.value && item.value.every((x: any) => x.type === asn1.Type.SEQUENCE)) {
            revokedCertsSeq = item;
          }
        } else if (item.tagClass === asn1.Class.UNIVERSAL && (item.type === asn1.Type.UTCTIME || item.type === asn1.Type.GENERALIZEDTIME)) {
          const dt = item.type === asn1.Type.UTCTIME ? asn1.utcTimeToDate(item.value) : asn1.generalizedTimeToDate(item.value);
          if (!thisUpdateDate) {
            thisUpdateDate = dt;
          } else if (!nextUpdateDate) {
            nextUpdateDate = dt;
          }
        }
      }

      // XÁC MINH CHỮ KÝ CỦA CRL
      const tbsDer = Buffer.from(asn1.toDer(tbsCertListSeq).getBytes(), 'binary');
      let sigBytes = signatureBitString.value;
      if (signatureBitString.type === asn1.Type.BITSTRING && sigBytes.length > 0) {
        sigBytes = sigBytes.substring(1);
      }
      const signatureBuffer = Buffer.from(sigBytes, 'binary');

      const issuerCert = pki.certificateFromPem(issuerCertPem);
      const issuerPubKeyPem = pki.publicKeyToPem(issuerCert.publicKey);
      const pubKey = crypto.createPublicKey(issuerPubKeyPem);

      let isSignatureValid = crypto.verify('sha256', tbsDer, pubKey, signatureBuffer);
      if (!isSignatureValid) {
        isSignatureValid = crypto.verify('sha1', tbsDer, pubKey, signatureBuffer);
      }

      if (!isSignatureValid) {
        return {
          status: 'UNAVAILABLE',
          sourceType: 'CRL',
          crlDer,
          isSignatureValid: false,
          errorMessage: 'Chữ ký số trên danh sách thu hồi CRL không hợp lệ với khóa công khai của CA phát hành.',
        };
      }

      // KIỂM TRA SERIAL NUMBER CÓ TRONG DANH SÁCH THU HỒI HAY KHÔNG
      const normalizedExpectedSerial = expectedSerialNumberHex.replace(/^0x/i, '').toLowerCase();
      let isRevoked = false;
      let revocationDate: Date | undefined;

      if (revokedCertsSeq && Array.isArray(revokedCertsSeq.value)) {
        for (const entry of revokedCertsSeq.value) {
          // revokedCertificate: userCertificate (serialNumber), revocationDate, crlEntryExtensions
          const serialAsn1 = entry.value[0];
          const entrySerial = forge.util.bytesToHex(serialAsn1.value).toLowerCase();

          if (entrySerial === normalizedExpectedSerial || entrySerial.replace(/^0+/, '') === normalizedExpectedSerial.replace(/^0+/, '')) {
            isRevoked = true;
            if (entry.value[1]) {
              try {
                revocationDate = entry.value[1].type === asn1.Type.UTCTIME
                  ? asn1.utcTimeToDate(entry.value[1].value)
                  : asn1.generalizedTimeToDate(entry.value[1].value);
              } catch {}
            }
            break;
          }
        }
      }

      const issuerDn = issuerCert.subject.attributes.map((a) => `${a.shortName || a.name}=${a.value}`).join(', ');

      if (isRevoked) {
        return {
          status: 'REVOKED',
          sourceType: 'CRL',
          crlDer,
          thisUpdate: thisUpdateDate,
          nextUpdate: nextUpdateDate,
          revocationTime: revocationDate,
          issuerSubjectDn: issuerDn,
          serialNumber: expectedSerialNumberHex,
          isSignatureValid: true,
        };
      }

      return {
        status: 'GOOD',
        sourceType: 'CRL',
        crlDer,
        thisUpdate: thisUpdateDate,
        nextUpdate: nextUpdateDate,
        issuerSubjectDn: issuerDn,
        serialNumber: expectedSerialNumberHex,
        isSignatureValid: true,
      };
    } catch (parseErr: any) {
      return {
        status: 'UNAVAILABLE',
        isSignatureValid: false,
        errorMessage: `Lỗi phân tích cú pháp ASN.1 CRL: ${parseErr.message}`,
      };
    }
  }
}
