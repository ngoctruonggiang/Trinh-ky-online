import { Injectable, Logger } from '@nestjs/common';
import * as forge from 'node-forge';
import { RevocationService } from '../revocation/revocation.service.js';
import { CertificateChainResolver } from '../chain/certificate-chain.resolver.js';
import { PdfDssAppender } from './pdf-dss-appender.js';

export interface ApplyLtvOptions {
  signedPdfBuffer: Buffer;
  signerCertificatePem: string;
  tsaCertificatePem?: string;
  intermediateCertsPem?: string[];
  trustedRootPems?: string[];
  signatureValueBuffer?: Buffer;
  preferredRevocationSource?: 'OCSP' | 'CRL' | 'AUTO';
  allowIncompleteRevocation?: boolean;
}

export interface ApplyLtvResult {
  updatedPdfBuffer: Buffer;
  hasLtv: boolean;
  ltvStatus: 'VALID' | 'INCOMPLETE_CHAIN' | 'REVOCATION_UNAVAILABLE' | 'REVOKED';
  padesLevel: 'PADES_B_T' | 'PADES_B_LT';
  dssCertsCount: number;
  dssOcspsCount: number;
  dssCrlsCount: number;
  errorMessage?: string;
}

@Injectable()
export class PdfDssService {
  private readonly logger = new Logger(PdfDssService.name);

  constructor(private readonly revocationService: RevocationService) {}

  /**
   * Thu thập dữ liệu xác thực (Certificates, OCSP Responses, CRLs) và nhúng DSS vào tệp PDF
   */
  public async applyLtv(options: ApplyLtvOptions): Promise<ApplyLtvResult> {
    const {
      signedPdfBuffer,
      signerCertificatePem,
      tsaCertificatePem,
      intermediateCertsPem = [],
      trustedRootPems = [],
      signatureValueBuffer,
      preferredRevocationSource = 'AUTO',
      allowIncompleteRevocation = false,
    } = options;

    const certDers: Buffer[] = [];
    const ocspDers: Buffer[] = [];
    const crlDers: Buffer[] = [];

    const effectiveTrustedRoots = [...trustedRootPems];
    const devCa = this.revocationService.getDevProvider()?.getCaCertificatePem();
    if (devCa && !effectiveTrustedRoots.includes(devCa)) {
      effectiveTrustedRoots.push(devCa);
    }

    // 1. Giải mã chuỗi chứng thư của Người ký (Signer Certificate Chain)
    const signerChainResult = CertificateChainResolver.resolveChain(
      signerCertificatePem,
      intermediateCertsPem,
      effectiveTrustedRoots
    );

    if (signerChainResult.chain.length === 0) {
      return {
        updatedPdfBuffer: signedPdfBuffer,
        hasLtv: false,
        ltvStatus: 'INCOMPLETE_CHAIN',
        padesLevel: 'PADES_B_T',
        dssCertsCount: 0,
        dssOcspsCount: 0,
        dssCrlsCount: 0,
        errorMessage: `Không thể giải mã chuỗi chứng thư của người ký: ${signerChainResult.errorMessage}`,
      };
    }

    for (const c of signerChainResult.chain) {
      certDers.push(c.der);
    }

    // 2. Nếu có chứng thư TSA, giải mã thêm chuỗi chứng thư của TSA
    let tsaChainResult;
    if (tsaCertificatePem) {
      tsaChainResult = CertificateChainResolver.resolveChain(
        tsaCertificatePem,
        intermediateCertsPem,
        effectiveTrustedRoots
      );
      for (const c of tsaChainResult.chain) {
        // Tránh trùng lặp cert Der
        if (!certDers.some((existing) => existing.equals(c.der))) {
          certDers.push(c.der);
        }
      }
    }

    // Đảm bảo các chứng thư gốc / CA (effectiveTrustedRoots) cũng có mặt trong DSS /Certs để độc lập xác minh
    for (const rootPem of effectiveTrustedRoots) {
      try {
        const rootAsn1 = forge.pki.certificateToAsn1(forge.pki.certificateFromPem(rootPem));
        const rootDer = Buffer.from(forge.asn1.toDer(rootAsn1).getBytes(), 'binary');
        if (!certDers.some((existing) => existing.equals(rootDer))) {
          certDers.push(rootDer);
        }
      } catch {}
    }

    // 3. Thu thập dữ liệu thu hồi (Revocation Info: OCSP / CRL) cho các chứng thư trong chuỗi
    // Cần kiểm tra trạng thái của End-entity signer cert (đối chiếu với CA của nó)
    let isAnyCertRevoked = false;
    let hasRevocationData = false;

    // Kiểm tra thu hồi cho Signer Certificate
    const signerCertInfo = signerChainResult.chain[0];
    const signerIssuerCertInfo = signerChainResult.chain.length > 1
      ? signerChainResult.chain[1]
      : signerChainResult.chain[0];

    const signerRevocation = await this.revocationService.getRevocationInfo(
      signerCertInfo.pem,
      signerIssuerCertInfo.pem,
      { preferredSource: preferredRevocationSource }
    );

    if (signerRevocation.status === 'REVOKED') {
      isAnyCertRevoked = true;
    }

    if (signerRevocation.status === 'GOOD' && signerRevocation.isSignatureValid) {
      if (signerRevocation.ocspResponseDer) {
        ocspDers.push(signerRevocation.ocspResponseDer);
        hasRevocationData = true;
      }
      if (signerRevocation.crlDer) {
        crlDers.push(signerRevocation.crlDer);
        hasRevocationData = true;
      }
    }

    // Kiểm tra thu hồi cho TSA Certificate nếu có
    if (tsaChainResult && tsaChainResult.chain.length > 0) {
      const tsaCertInfo = tsaChainResult.chain[0];
      const tsaIssuerCertInfo = tsaChainResult.chain.length > 1
        ? tsaChainResult.chain[1]
        : tsaChainResult.chain[0];

      const tsaRevocation = await this.revocationService.getRevocationInfo(
        tsaCertInfo.pem,
        tsaIssuerCertInfo.pem,
        { preferredSource: preferredRevocationSource }
      );

      if (tsaRevocation.status === 'REVOKED') {
        isAnyCertRevoked = true;
      }

      if (tsaRevocation.status === 'GOOD' && tsaRevocation.isSignatureValid) {
        if (tsaRevocation.ocspResponseDer) {
          ocspDers.push(tsaRevocation.ocspResponseDer);
          hasRevocationData = true;
        }
        if (tsaRevocation.crlDer) {
          crlDers.push(tsaRevocation.crlDer);
          hasRevocationData = true;
        }
      }
    }

    if (isAnyCertRevoked) {
      return {
        updatedPdfBuffer: signedPdfBuffer,
        hasLtv: false,
        ltvStatus: 'REVOKED',
        padesLevel: 'PADES_B_T',
        dssCertsCount: 0,
        dssOcspsCount: 0,
        dssCrlsCount: 0,
        errorMessage: 'Chứng thư số trong chữ ký hoặc TSA đã bị thu hồi (REVOKED). Không thể cấp chứng nhận PAdES B-LT.',
      };
    }

    if (!hasRevocationData && !allowIncompleteRevocation) {
      return {
        updatedPdfBuffer: signedPdfBuffer,
        hasLtv: false,
        ltvStatus: 'REVOCATION_UNAVAILABLE',
        padesLevel: 'PADES_B_T',
        dssCertsCount: 0,
        dssOcspsCount: 0,
        dssCrlsCount: 0,
        errorMessage: 'Không thể thu thập phản hồi OCSP hoặc CRL hợp lệ từ máy chủ cấp phát.',
      };
    }

    // 4. Nhúng cấu trúc /DSS và /VRI vào PDF qua Incremental Update
    const appendResult = PdfDssAppender.appendDss(signedPdfBuffer, {
      certificateDers: certDers,
      ocspResponseDers: ocspDers,
      crlDers,
      signatureValueBuffer,
      validationTime: new Date(),
    });

    return {
      updatedPdfBuffer: appendResult.updatedPdfBuffer,
      hasLtv: true,
      ltvStatus: 'VALID',
      padesLevel: 'PADES_B_LT',
      dssCertsCount: appendResult.certsCount,
      dssOcspsCount: appendResult.ocspsCount,
      dssCrlsCount: appendResult.crlsCount,
    };
  }
}
