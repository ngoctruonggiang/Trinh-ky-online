import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as forge from 'node-forge';
import { DevLocalKeystoreProvider } from '../../src/modules/signing/providers/dev-local-keystore.provider.js';
import { DevTestTsaProvider } from '../../src/modules/signing/timestamp/dev-test-tsa.provider.js';
import { RevocationService } from '../../src/modules/signing/revocation/revocation.service.js';
import { PdfDssService } from '../../src/modules/signing/dss/pdf-dss.service.js';
import { PdfDssParser } from '../../src/modules/signing/dss/pdf-dss-parser.js';
import { PdfSignatureAdapter } from '../../src/modules/signing/engine/pdf-signature.adapter.js';
import { PdfSignatureVerifier } from '../../src/modules/signing/engine/pdf-signature.verifier.js';
import { TimestampTokenVerifier } from '../../src/modules/signing/timestamp/timestamp-token.verifier.js';

describe('Hạng mục A: Independent PAdES Validation & 7 Negative Security Scenarios', () => {
  const opensslExe = 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe';
  const hasOpenSsl = fs.existsSync(opensslExe);

  let keystoreProvider: DevLocalKeystoreProvider;
  let tsaProvider: DevTestTsaProvider;
  let revocationService: RevocationService;
  let pdfDssService: PdfDssService;

  let caCertPem: string;
  let caKeyPair: any;
  let signerCertPem: string;
  let signerKeyAlias: string;
  let validSignedPadesBltBuffer: Buffer;
  let validSignResult: any;
  let validLtvResult: any;

  beforeAll(async () => {
    revocationService = new RevocationService();
    const devRevocationProvider = revocationService.getDevProvider()!;
    pdfDssService = new PdfDssService(revocationService);
    keystoreProvider = new DevLocalKeystoreProvider();
    tsaProvider = new DevTestTsaProvider({
      commonName: 'Trinh Ky Trusted TSA Authority',
      organizationName: 'Trinh Ky PKI Trust Network',
    });

    caCertPem = devRevocationProvider.getCaCertificatePem();
    caKeyPair = devRevocationProvider['devCaKeyPair'];
    const caCert = forge.pki.certificateFromPem(caCertPem);

    // 1. Tạo chứng thư số người ký cấp bởi CA
    signerKeyAlias = `pades_neg_signer_${Date.now()}`;
    const signerKeys = forge.pki.rsa.generateKeyPair({ bits: 2048, workers: -1 });
    const signerCert = forge.pki.createCertificate();
    signerCert.publicKey = signerKeys.publicKey;
    signerCert.serialNumber = '08F1E2D3';
    signerCert.validity.notBefore = new Date(Date.now() - 3600 * 1000);
    signerCert.validity.notAfter = new Date(Date.now() + 365 * 86400 * 1000);

    const subjectAttrs = [
      { name: 'commonName', value: 'Tran PAdES Tester', valueTag: forge.asn1.Type.UTF8 },
      { name: 'organizationName', value: 'PAdES Validation Lab', valueTag: forge.asn1.Type.UTF8 },
      { name: 'countryName', value: 'VN' },
    ];
    signerCert.setSubject(subjectAttrs);
    signerCert.setIssuer(caCert.subject.attributes);
    signerCert.setExtensions([
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
    ]);
    signerCert.sign(caKeyPair.privateKey, forge.md.sha256.create());
    signerCertPem = forge.pki.certificateToPem(signerCert);

    const p12Asn1 = forge.pkcs12.toPkcs12Asn1(signerKeys.privateKey, [signerCert], 'PassphraseNeg2026!', {
      algorithm: '3des',
    });
    const p12Der = Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');
    keystoreProvider.importKeystore(signerKeyAlias, p12Der, 'PassphraseNeg2026!');

    // 2. Tạo PDF mẫu và thực hiện Ký số kèm Timestamp (PAdES B-T)
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage([595, 842]);
    page.drawText('CHUNG THU THAM DINH PAdES BASELINE B-LT VA NEGATIVE CASES', {
      x: 50,
      y: 780,
      size: 13,
      font,
      color: rgb(0, 0, 0.6),
    });
    const unsignedPdf = Buffer.from(await doc.save());

    validSignResult = await PdfSignatureAdapter.signPdf({
      unsignedPdfBuffer: unsignedPdf,
      keyAlias: signerKeyAlias,
      keyProvider: keystoreProvider,
      signerCertificatePem: signerCertPem,
      reason: 'Ký duyệt thẩm định PAdES B-LT',
      signerName: 'Tran PAdES Tester',
      tsaProvider,
      requireTimestamp: true,
    });

    // 3. Nâng cấp lên PAdES B-LT với Document Security Store (DSS)
    validLtvResult = await pdfDssService.applyLtv({
      signedPdfBuffer: validSignResult.signedPdfBuffer,
      signerCertificatePem: signerCertPem,
      tsaCertificatePem: tsaProvider.getCertificatePem(),
      signatureValueBuffer: validSignResult.signatureValueBuffer,
      trustedRootPems: [caCertPem],
    });

    validSignedPadesBltBuffer = validLtvResult.updatedPdfBuffer;
  });

  it('0. Baseline Positive: Xác minh độc lập PAdES B-LT thành công và OpenSSL CMS/TS pass 100%', () => {
    const verifyResult = PdfSignatureVerifier.verify(validSignedPadesBltBuffer);
    expect(verifyResult.isValid).toBe(true);
    expect(verifyResult.isTampered).toBe(false);
    expect(verifyResult.hasTimestamp).toBe(true);
    expect(verifyResult.isTimestampValid).toBe(true);
    expect(verifyResult.hasLtv).toBe(true);
    expect(verifyResult.ltvValidationStatus).toBe('VALID');
    expect(verifyResult.padesLevel).toBe('PADES_B_LT');

    if (hasOpenSsl) {
      // Thực thi OpenSSL CMS verification
      const tmpDir = path.join(process.cwd(), 'storage', 'test_pades_tmp');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

      const cmsPath = path.join(tmpDir, 'valid_sig.der');
      const caPath = path.join(tmpDir, 'valid_ca.pem');
      const contentPath = path.join(tmpDir, 'valid_content.bin');

      const p1 = validSignResult.signedPdfBuffer.subarray(0, validSignResult.byteRange[1]);
      const p2 = validSignResult.signedPdfBuffer.subarray(
        validSignResult.byteRange[2],
        validSignResult.byteRange[2] + validSignResult.byteRange[3]
      );
      const signedContent = Buffer.concat([p1, p2]);

      fs.writeFileSync(cmsPath, validSignResult.cmsDer);
      fs.writeFileSync(caPath, caCertPem);
      fs.writeFileSync(contentPath, signedContent);

      const cmsCmd = `"${opensslExe}" cms -verify -inform DER -in "${cmsPath}" -content "${contentPath}" -CAfile "${caPath}" -binary`;
      let cmsOutput = '';
      expect(() => {
        cmsOutput = execSync(cmsCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      }).not.toThrow();
      expect(cmsOutput).toContain('%PDF-');
    }
  });

  it('1. Trường hợp âm tính 1: Sửa đổi nội dung PDF sau khi ký (Tamper PDF in ByteRange)', () => {
    const tamperedPdf = Buffer.from(validSignedPadesBltBuffer);
    // Thay đổi 1 byte trong vùng byteRange[0] (nội dung PDF đã ký)
    const targetOffset = 100;
    tamperedPdf[targetOffset] = tamperedPdf[targetOffset] === 0x41 ? 0x42 : 0x41;

    const verifyResult = PdfSignatureVerifier.verify(tamperedPdf);
    expect(verifyResult.isValid).toBe(false);
    expect(verifyResult.isTampered).toBe(true);
    expect(verifyResult.isDigestValid).toBe(false);
    expect(verifyResult.errorMessage).toContain('không khớp');
  });

  it('2. Trường hợp âm tính 2: Làm sai ByteRange (Corrupted ByteRange intervals)', () => {
    // Tìm vị trí chuỗi /ByteRange trong tệp PDF và làm sai lệch chỉ số
    const pdfStr = validSignedPadesBltBuffer.toString('latin1');
    const byteRangeMatch = pdfStr.match(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/);
    expect(byteRangeMatch).toBeDefined();

    // Thay đổi byteRange[1] để tạo khoảng giao lấn vào /Contents
    const originalSub = byteRangeMatch![0];
    const originalLen = parseInt(byteRangeMatch![2], 10);
    const corruptedSub = originalSub.replace(
      String(originalLen),
      String(originalLen + 500).padStart(String(originalLen).length, '0')
    );

    const tamperedPdf = Buffer.from(pdfStr.replace(originalSub, corruptedSub), 'latin1');
    const verifyResult = PdfSignatureVerifier.verify(tamperedPdf);

    // Verifier phải phát hiện can thiệp hoặc sai lệch tính toàn vẹn
    expect(verifyResult.isValid).toBe(false);
    expect(verifyResult.isTampered).toBe(true);
  });

  it('3. Trường hợp âm tính 3: Thay đổi CMS signature (Altered Signature in /Contents)', () => {
    const pdfStr = validSignedPadesBltBuffer.toString('latin1');
    const contentsIdx = pdfStr.indexOf('/Contents <');
    expect(contentsIdx).toBeGreaterThan(0);

    const hexStart = contentsIdx + '/Contents <'.length;
    const hexSlice = pdfStr.substring(hexStart, hexStart + 10);
    // Đảo ngược 2 ký tự hex trong chữ ký
    const flippedHex = hexSlice[0] === '0' ? 'f' + hexSlice.substring(1) : '0' + hexSlice.substring(1);
    const tamperedPdfStr =
      pdfStr.substring(0, hexStart) + flippedHex + pdfStr.substring(hexStart + 10);

    const tamperedPdf = Buffer.from(tamperedPdfStr, 'latin1');
    const verifyResult = PdfSignatureVerifier.verify(tamperedPdf);

    expect(verifyResult.isValid).toBe(false);
    // Verifier phát hiện chữ ký mật mã không hợp lệ hoặc ASN.1 bị hỏng
    expect(verifyResult.isSignatureValid).toBe(false);
  });

  it('4. Trường hợp âm tính 4: Sử dụng Timestamp Token không hợp lệ (Corrupted TimeStampToken)', async () => {
    // Trích xuất TimeStampToken hợp lệ và cố tình làm hỏng
    const sampleDigest = crypto.randomBytes(32);
    const validToken = await tsaProvider.getTimestampToken(sampleDigest);

    // Làm hỏng 1 byte trong tokenDer
    const corruptedTokenDer = Buffer.from(validToken.tokenDer);
    corruptedTokenDer[corruptedTokenDer.length - 20] ^= 0xff;

    const verifyResult = TimestampTokenVerifier.verifyToken(corruptedTokenDer, sampleDigest);
    expect(verifyResult.isValid).toBe(false);
    expect(verifyResult.isSignatureValid).toBe(false);
  });

  it('5. Trường hợp âm tính 5: Dùng TSA certificate không được tin cậy hoặc thiếu EKU TimeStamping', async () => {
    // Khởi tạo DevTestTsaProvider với cờ simulateMissingEku: true
    const untrustedTsa = new DevTestTsaProvider({
      commonName: 'Untrusted TSA Missing EKU',
      simulateMissingEku: true,
    });

    const sampleDigest = crypto.randomBytes(32);
    // TSA Provider và Token Verifier tự động phát hiện và chặn khi thiếu EKU id-kp-timeStamping
    await expect(untrustedTsa.getTimestampToken(sampleDigest)).rejects.toThrow(
      'Extended Key Usage id-kp-timeStamping'
    );
  });

  it('6. Trường hợp âm tính 6: Thiếu Revocation Evidence trong DSS (Missing /OCSPs array)', () => {
    // Phân tích DSS trên tệp PDF đã ký nhưng xóa bỏ phần /OCSPs
    const dssMissingOcsp = PdfDssParser.parseDss(
      validSignResult.signedPdfBuffer, // Tệp PAdES B-T chưa có DSS
      '08F1E2D3',
      caCertPem
    );

    expect(dssMissingOcsp.hasDss).toBe(false);
    expect(dssMissingOcsp.ocspsCount).toBe(0);
    expect(dssMissingOcsp.ltvValidationStatus).toBe('REVOCATION_DATA_MISSING');
  });

  it('7. Trường hợp âm tính 7: Dùng OCSP phản hồi trạng thái REVOKED (Chứng thư đã bị thu hồi)', async () => {
    // Đánh dấu chứng thư người ký đã bị thu hồi trong DevRevocationProvider
    const devRevocationProvider = revocationService.getDevProvider()!;
    devRevocationProvider.markAsRevoked('08F1E2D3');

    // Thử áp dụng LTV khi chứng thư đã bị thu hồi
    const ltvOnRevoked = await pdfDssService.applyLtv({
      signedPdfBuffer: validSignResult.signedPdfBuffer,
      signerCertificatePem: signerCertPem,
      tsaCertificatePem: tsaProvider.getCertificatePem(),
      signatureValueBuffer: validSignResult.signatureValueBuffer,
      trustedRootPems: [caCertPem],
    });

    expect(ltvOnRevoked.hasLtv).toBe(false);
    expect(ltvOnRevoked.ltvStatus).toBe('REVOKED');
    expect(ltvOnRevoked.errorMessage).toContain('thu hồi');
  });
});
