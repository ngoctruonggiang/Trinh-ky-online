import { describe, expect, it, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import * as crypto from 'crypto';
import * as forge from 'node-forge';
import { DevLocalKeystoreProvider } from '../../src/modules/signing/providers/dev-local-keystore.provider.js';
import { DevTestTsaProvider } from '../../src/modules/signing/timestamp/dev-test-tsa.provider.js';
import { PdfSignatureAdapter } from '../../src/modules/signing/engine/pdf-signature.adapter.js';
import { PdfSignatureVerifier } from '../../src/modules/signing/engine/pdf-signature.verifier.js';
import { PdfDssService } from '../../src/modules/signing/dss/pdf-dss.service.js';
import { RevocationService } from '../../src/modules/signing/revocation/revocation.service.js';
import { DevTestRevocationProvider } from '../../src/modules/signing/revocation/dev-test-revocation.provider.js';

describe('PdfDssService & PAdES Baseline B-LT (Unit Tests)', () => {
  let keyProvider: DevLocalKeystoreProvider;
  let tsaProvider: DevTestTsaProvider;
  let revocationService: RevocationService;
  let pdfDssService: PdfDssService;
  let devRevocationProvider: DevTestRevocationProvider;

  let signerCertificatePem: string;
  let keyAlias: string;
  let validSignedPdfBuffer: Buffer;
  let signatureValueBuffer: Buffer;

  beforeEach(async () => {
    keyProvider = new DevLocalKeystoreProvider();
    tsaProvider = new DevTestTsaProvider();
    revocationService = new RevocationService();
    devRevocationProvider = revocationService.getDevProvider()!;
    pdfDssService = new PdfDssService(revocationService);

    // Tạo cặp khóa người ký
    keyAlias = `test_signer_${Date.now()}`;
    const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, workers: -1 });
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '05A1B2C3';
    cert.validity.notBefore = new Date(Date.now() - 3600 * 1000);
    cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);

    const caCertPem = devRevocationProvider.getCaCertificatePem();
    const caCert = forge.pki.certificateFromPem(caCertPem);

    const attrs = [
      { name: 'commonName', value: forge.util.encodeUtf8('Nguyễn Văn Giám Đốc'), valueTag: forge.asn1.Type.UTF8 },
      { name: 'organizationName', value: forge.util.encodeUtf8('Tập đoàn VinaGroup'), valueTag: forge.asn1.Type.UTF8 },
      { name: 'countryName', value: 'VN' },
    ];
    cert.setSubject(attrs);
    cert.setIssuer(caCert.subject.attributes);

    cert.sign(devRevocationProvider['devCaKeyPair'].privateKey, forge.md.sha256.create());
    signerCertificatePem = forge.pki.certificateToPem(cert);

    const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'testpass123', {
      algorithm: '3des',
    });
    const p12Der = Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');
    keyProvider.importKeystore(keyAlias, p12Der, 'testpass123');

    // Tạo PDF mẫu
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    page.drawText('HOP DONG KINH TE PAdES B-LT', { x: 50, y: 750 });
    const unsignedBuffer = Buffer.from(await doc.save({ useObjectStreams: false }));

    // Ký số PDF có kèm RFC 3161 Timestamp (PAdES B-T)
    const signingResult = await PdfSignatureAdapter.signPdf({
      unsignedPdfBuffer: unsignedBuffer,
      keyAlias,
      keyProvider,
      signerCertificatePem,
      reason: 'Phê duyệt hợp đồng',
      tsaProvider,
      requireTimestamp: true,
    });

    validSignedPdfBuffer = signingResult.signedPdfBuffer;
    signatureValueBuffer = signingResult.signatureValueBuffer!;
  });

  it('1. Bổ sung thành công DSS vào tệp PDF đã ký (PAdES B-T -> PAdES B-LT)', async () => {
    const ltvResult = await pdfDssService.applyLtv({
      signedPdfBuffer: validSignedPdfBuffer,
      signerCertificatePem,
      tsaCertificatePem: tsaProvider.getCertificatePem(),
      signatureValueBuffer,
    });

    expect(ltvResult.hasLtv).toBe(true);
    expect(ltvResult.ltvStatus).toBe('VALID');
    expect(ltvResult.padesLevel).toBe('PADES_B_LT');
    expect(ltvResult.dssCertsCount).toBeGreaterThanOrEqual(1);
    expect(ltvResult.dssOcspsCount).toBeGreaterThanOrEqual(1);
    expect(ltvResult.updatedPdfBuffer.length).toBeGreaterThan(validSignedPdfBuffer.length);

    // Thẩm định bằng PdfSignatureVerifier độc lập
    const verifyResult = PdfSignatureVerifier.verify(ltvResult.updatedPdfBuffer);

    expect(verifyResult.isValid).toBe(true);
    expect(verifyResult.isDigestValid).toBe(true);
    expect(verifyResult.isSignatureValid).toBe(true);
    expect(verifyResult.isTampered).toBe(false);
    expect(verifyResult.hasTimestamp).toBe(true);
    expect(verifyResult.isTimestampValid).toBe(true);
    expect(verifyResult.hasLtv).toBe(true);
    expect(verifyResult.ltvDataPresent).toBe(true);
    expect(verifyResult.ltvValidationStatus).toBe('VALID');
    expect(verifyResult.padesLevel).toBe('PADES_B_LT');
    expect(verifyResult.dssInfo).toBeDefined();
    expect(verifyResult.dssInfo?.certsCount).toBeGreaterThanOrEqual(1);
  });

  it('2. Bảo toàn tính toàn vẹn chữ ký ban đầu: ByteRange của Revision 1 không bị hỏng', async () => {
    const ltvResult = await pdfDssService.applyLtv({
      signedPdfBuffer: validSignedPdfBuffer,
      signerCertificatePem,
      tsaCertificatePem: tsaProvider.getCertificatePem(),
      signatureValueBuffer,
    });

    // ByteRange của chữ ký ban đầu
    const origVerify = PdfSignatureVerifier.verify(validSignedPdfBuffer);
    const ltvVerify = PdfSignatureVerifier.verify(ltvResult.updatedPdfBuffer);

    expect(ltvVerify.byteRange).toEqual(origVerify.byteRange);
    expect(ltvVerify.messageDigestHex).toBe(origVerify.messageDigestHex);
    expect(ltvVerify.computedDigestHex).toBe(origVerify.computedDigestHex);
  });

  it('3. Phát hiện can thiệp nhị phân trong phần dữ liệu ban đầu (Tamper Detection)', async () => {
    const ltvResult = await pdfDssService.applyLtv({
      signedPdfBuffer: validSignedPdfBuffer,
      signerCertificatePem,
      tsaCertificatePem: tsaProvider.getCertificatePem(),
      signatureValueBuffer,
    });

    // Can thiệp 1 byte trong vùng PDF gốc (offset 50)
    const tampered = Buffer.from(ltvResult.updatedPdfBuffer);
    tampered[50] ^= 0xff;

    const verifyResult = PdfSignatureVerifier.verify(tampered);

    expect(verifyResult.isValid).toBe(false);
    expect(verifyResult.isDigestValid).toBe(false);
    expect(verifyResult.isTampered).toBe(true);
  });

  it('4. Ngăn chặn và phát hiện tấn công PDF Shadow Attack trong bản cập nhật', async () => {
    const ltvResult = await pdfDssService.applyLtv({
      signedPdfBuffer: validSignedPdfBuffer,
      signerCertificatePem,
      tsaCertificatePem: tsaProvider.getCertificatePem(),
      signatureValueBuffer,
    });

    // Kẻ tấn công cố tình chèn thêm /Type /Page vào phần incremental update sau chữ ký
    const shadowAttackBuffer = Buffer.concat([
      ltvResult.updatedPdfBuffer,
      Buffer.from('\n99 0 obj\n<< /Type /Page /Contents 100 0 R >>\nendobj\nstartxref\n12345\n%%EOF\n', 'ascii'),
    ]);

    const verifyResult = PdfSignatureVerifier.verify(shadowAttackBuffer);

    expect(verifyResult.isValid).toBe(false);
    expect(verifyResult.isTampered).toBe(true);
    expect(verifyResult.errorMessage).toContain('PDF Shadow Attack');
  });

  it('5. Từ chối cấp chứng nhận B-LT khi chứng thư số bị thu hồi (REVOKED)', async () => {
    // Đánh dấu serial của người ký bị thu hồi
    devRevocationProvider.markAsRevoked('05A1B2C3');

    const ltvResult = await pdfDssService.applyLtv({
      signedPdfBuffer: validSignedPdfBuffer,
      signerCertificatePem,
      tsaCertificatePem: tsaProvider.getCertificatePem(),
      signatureValueBuffer,
    });

    expect(ltvResult.hasLtv).toBe(false);
    expect(ltvResult.ltvStatus).toBe('REVOKED');
    expect(ltvResult.padesLevel).not.toBe('PADES_B_LT');
    expect(ltvResult.errorMessage).toContain('bị thu hồi (REVOKED)');
  });
});
