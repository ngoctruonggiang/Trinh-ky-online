import * as crypto from 'crypto';
import * as forge from 'node-forge';

export interface ChainCertificateInfo {
  pem: string;
  der: Buffer;
  subjectDn: string;
  issuerDn: string;
  serialNumber: string;
  isRoot: boolean;
  validFrom: Date;
  validTo: Date;
}

export interface CertificateChainResult {
  chain: ChainCertificateInfo[];
  isChainComplete: boolean;
  rootCertificatePem?: string;
  errorMessage?: string;
}

/**
 * Trình giải mã và thẩm định chuỗi chứng thư số X.509 (Certificate Path Validation - RFC 5280)
 */
export class CertificateChainResolver {
  /**
   * Giải mã chuỗi chứng thư từ chứng thư người ký/TSA lên tới Root CA tin cậy
   * @param leafCertPem Chứng thư cuối (End-entity certificate)
   * @param availableCertsPem Danh sách các chứng thư trung gian hoặc CA sẵn có
   * @param trustedRootPems Danh sách chứng thư gốc được tin cậy (Trust Anchors)
   */
  public static resolveChain(
    leafCertPem: string,
    availableCertsPem: string[] = [],
    trustedRootPems: string[] = []
  ): CertificateChainResult {
    const pki = forge.pki;
    const asn1 = forge.asn1;

    try {
      const leafCert = pki.certificateFromPem(leafCertPem);
      const pool = new Map<string, forge.pki.Certificate>();

      // Đưa leaf cert và các certs trung gian vào pool tìm kiếm theo Subject DN
      for (const pem of [leafCertPem, ...availableCertsPem, ...trustedRootPems]) {
        try {
          const c = pki.certificateFromPem(pem);
          const subjKey = CertificateChainResolver.getNormalizedDn(c.subject);
          pool.set(subjKey, c);
        } catch {}
      }

      const chainInfoList: ChainCertificateInfo[] = [];
      let currentCert = leafCert;
      let depth = 0;
      const MAX_DEPTH = 10;
      const visited = new Set<string>();

      while (depth < MAX_DEPTH) {
        depth++;
        const subjDn = CertificateChainResolver.getDnString(currentCert.subject);
        const issuerDn = CertificateChainResolver.getDnString(currentCert.issuer);
        const serialNumber = currentCert.serialNumber;
        const isSelfSigned = CertificateChainResolver.isCertSelfSigned(currentCert);

        const certAsn1 = pki.certificateToAsn1(currentCert);
        const certDer = Buffer.from(asn1.toDer(certAsn1).getBytes(), 'binary');
        const certPem = pki.certificateToPem(currentCert);

        chainInfoList.push({
          pem: certPem,
          der: certDer,
          subjectDn: subjDn,
          issuerDn,
          serialNumber,
          isRoot: isSelfSigned,
          validFrom: currentCert.validity.notBefore,
          validTo: currentCert.validity.notAfter,
        });

        visited.add(serialNumber);

        // Nếu đã đến chứng thư gốc (Self-signed Root CA)
        if (isSelfSigned) {
          return {
            chain: chainInfoList,
            isChainComplete: true,
            rootCertificatePem: certPem,
          };
        }

        // Tìm chứng thư CA phát hành của currentCert
        const issuerKey = CertificateChainResolver.getNormalizedDn(currentCert.issuer);
        const parentCert = pool.get(issuerKey);

        if (!parentCert) {
          // Không tìm thấy CA cấp phát trong kho
          return {
            chain: chainInfoList,
            isChainComplete: false,
            errorMessage: `Không tìm thấy chứng thư của CA cấp phát (${issuerDn}) trong chuỗi chứng thư cung cấp.`,
          };
        }

        // Xác minh chữ ký mật mã của currentCert bằng khóa công khai của parentCert
        try {
          const parentPubKey = crypto.createPublicKey(pki.publicKeyToPem(parentCert.publicKey));
          const tbsAsn1 = (certAsn1 as any).value[0];
          const tbsDer = Buffer.from(asn1.toDer(tbsAsn1).getBytes(), 'binary');

          const sigBitString = (certAsn1 as any).value[2];
          let sigBytes = sigBitString.value;
          if (sigBitString.type === asn1.Type.BITSTRING && sigBytes.length > 0) {
            sigBytes = sigBytes.substring(1);
          }
          const sigBuffer = Buffer.from(sigBytes, 'binary');

          let isSigValid = crypto.verify('sha256', tbsDer, parentPubKey, sigBuffer);
          if (!isSigValid) {
            isSigValid = crypto.verify('sha1', tbsDer, parentPubKey, sigBuffer);
          }

          if (!isSigValid) {
            return {
              chain: chainInfoList,
              isChainComplete: false,
              errorMessage: `Chữ ký của chứng thư (${subjDn}) không hợp lệ với khóa công khai của CA (${issuerDn}).`,
            };
          }
        } catch (sigErr: any) {
          return {
            chain: chainInfoList,
            isChainComplete: false,
            errorMessage: `Lỗi khi xác minh chữ ký chứng thư trong chuỗi: ${sigErr.message}`,
          };
        }

        // Chống lặp vòng vô hạn (Cycle detection)
        if (visited.has(parentCert.serialNumber)) {
          return {
            chain: chainInfoList,
            isChainComplete: false,
            errorMessage: 'Phát hiện vòng lặp vô hạn trong chuỗi chứng thư.',
          };
        }

        currentCert = parentCert;
      }

      return {
        chain: chainInfoList,
        isChainComplete: false,
        errorMessage: 'Vượt quá độ sâu tối đa (10) khi giải mã chuỗi chứng thư.',
      };
    } catch (err: any) {
      return {
        chain: [],
        isChainComplete: false,
        errorMessage: `Lỗi giải mã chuỗi chứng thư: ${err.message}`,
      };
    }
  }

  public static isCertSelfSigned(cert: forge.pki.Certificate): boolean {
    const subj = CertificateChainResolver.getNormalizedDn(cert.subject);
    const issuer = CertificateChainResolver.getNormalizedDn(cert.issuer);
    return subj === issuer;
  }

  public static getNormalizedDn(entity: any): string {
    return entity.attributes
      .map((a: any) => `${a.shortName || a.name}=${a.value}`.toLowerCase())
      .sort()
      .join(',');
  }

  public static getDnString(entity: any): string {
    return entity.attributes
      .map((a: any) => `${a.shortName || a.name}=${a.value}`)
      .join(', ');
  }
}
