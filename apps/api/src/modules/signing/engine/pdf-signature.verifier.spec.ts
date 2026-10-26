import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { PdfSignatureAdapter } from './pdf-signature.adapter.js';
import { PdfSignatureVerifier } from './pdf-signature.verifier.js';
import { DevKeystoreGenerator } from '../dev-keystore-generator.js';
import { DevLocalKeystoreProvider } from '../providers/dev-local-keystore.provider.js';
import { DevTestTsaProvider } from '../timestamp/dev-test-tsa.provider.js';

describe('PdfSignatureVerifier (Unit Tests)', () => {
  let provider: DevLocalKeystoreProvider;
  let keyAlias: string;
  let signerCertPem: string;
  let testStorageDir: string;
  let validSignedPdfBuffer: Buffer;
  let unsignedPdfBuffer: Buffer;

  beforeEach(async () => {
    testStorageDir = path.join(process.cwd(), 'storage', 'keystores', 'test_verifier_spec');
    if (!fs.existsSync(testStorageDir)) {
      fs.mkdirSync(testStorageDir, { recursive: true });
    }
    provider = new DevLocalKeystoreProvider(testStorageDir);

    keyAlias = `verifier_test_key_${Date.now()}`;
    const generated = DevKeystoreGenerator.generateSelfSignedKeystore({
      commonName: 'Lê Giám Đốc',
      organizationName: 'Tập đoàn VinaGroup',
    });
    signerCertPem = generated.certificatePem;
    provider.importKeystore(keyAlias, generated.p12Buffer);

    // Tạo PDF mẫu
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    page.drawText('HOP DONG KINH TE QUAN TRONG 2026', { x: 50, y: 800, size: 14, font, color: rgb(0, 0, 0) });
    page.drawText('Gia tri hop dong: 10,000,000 VND', { x: 50, y: 760, size: 12, font });
    unsignedPdfBuffer = Buffer.from(await doc.save());

    // Ký số PDF không kèm timestamp
    const signingResult = await PdfSignatureAdapter.signPdf({
      unsignedPdfBuffer,
      keyAlias,
      keyProvider: provider,
      signerCertificatePem: signerCertPem,
      reason: 'Phê duyệt giá trị hợp đồng',
      signerName: 'Lê Giám Đốc',
    });

    validSignedPdfBuffer = signingResult.signedPdfBuffer;
  });

  afterEach(() => {
    if (fs.existsSync(testStorageDir)) {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    }
  });

  it('1. Xác minh thành công tệp PDF đã ký nguyên vẹn (Không timestamp)', () => {
    const result = PdfSignatureVerifier.verify(validSignedPdfBuffer);

    expect(result.isValid).toBe(true);
    expect(result.isDigestValid).toBe(true);
    expect(result.isSignatureValid).toBe(true);
    expect(result.isTampered).toBe(false);
    expect(result.hasTimestamp).toBe(false);
    expect(result.signerSubject).toContain('Lê Giám Đốc');
    expect(result.serialNumber).toBeDefined();
    expect(result.messageDigestHex).toBeDefined();
    expect(result.computedDigestHex).toBe(result.messageDigestHex);
  });

  it('2. Phát hiện can thiệp nhị phân khi sửa 1 byte trong vùng ByteRange (Tamper Detection)', () => {
    const tamperedBuffer = Buffer.from(validSignedPdfBuffer);
    // Sửa 1 byte ở vị trí byte offset 10 (trong header PDF trước /Contents)
    tamperedBuffer[10] = tamperedBuffer[10] ^ 0xff;

    const result = PdfSignatureVerifier.verify(tamperedBuffer);

    expect(result.isValid).toBe(false);
    expect(result.isDigestValid).toBe(false);
    expect(result.isTampered).toBe(true);
    expect(result.errorMessage).toMatch(/Mã băm dữ liệu ByteRange không khớp|can thiệp trái phép/);
  });

  it('3. Phát hiện can thiệp khi sửa nội dung ở cuối tệp sau /Contents', () => {
    const tamperedBuffer = Buffer.from(validSignedPdfBuffer);
    // Sửa 1 byte ở gần cuối tệp (trong trailer/xref sau /Contents)
    const lastByteIndex = tamperedBuffer.length - 15;
    tamperedBuffer[lastByteIndex] = tamperedBuffer[lastByteIndex] ^ 0xff;

    const result = PdfSignatureVerifier.verify(tamperedBuffer);

    expect(result.isValid).toBe(false);
    expect(result.isDigestValid).toBe(false);
    expect(result.isTampered).toBe(true);
  });

  it('4. Từ chối tệp PDF chưa từng được ký số', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const unsignedBuffer = Buffer.from(await doc.save());

    const result = PdfSignatureVerifier.verify(unsignedBuffer);

    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toContain('không chứa bảng /ByteRange');
  });

  it('5. Từ chối tệp dữ liệu rác hoặc không phải PDF', () => {
    const garbage = Buffer.from('THIS IS RANDOM JUNK DATA NOT PDF');
    const result = PdfSignatureVerifier.verify(garbage);

    expect(result.isValid).toBe(false);
    expect(result.isTampered).toBe(true);
    expect(result.errorMessage).toContain('không phải là định dạng PDF hợp lệ');
  });

  it('6. Xác minh thành công tệp PDF ký có RFC 3161 TimeStampToken (PAdES B-T Readiness)', async () => {
    const devTsa = new DevTestTsaProvider();
    const timestampedResult = await PdfSignatureAdapter.signPdf({
      unsignedPdfBuffer,
      keyAlias,
      keyProvider: provider,
      signerCertificatePem: signerCertPem,
      reason: 'Phê duyệt hợp đồng kèm dấu thời gian tin cậy',
      signerName: 'Lê Giám Đốc',
      tsaProvider: devTsa,
      requireTimestamp: true,
    });

    expect(timestampedResult.hasTimestamp).toBe(true);
    expect(timestampedResult.timestampGenTime).toBeInstanceOf(Date);

    const verifyResult = PdfSignatureVerifier.verify(timestampedResult.signedPdfBuffer);

    expect(verifyResult.isValid).toBe(true);
    expect(verifyResult.isDigestValid).toBe(true);
    expect(verifyResult.isSignatureValid).toBe(true);
    expect(verifyResult.isTampered).toBe(false);
    expect(verifyResult.hasTimestamp).toBe(true);
    expect(verifyResult.isTimestampValid).toBe(true);
    expect(verifyResult.timestampGenTime).toBeDefined();
    expect(verifyResult.tsaSubject).toContain('Internal TSA');
    expect(verifyResult.tsaSerialNumber).toBeDefined();
    expect(verifyResult.tsaPolicyOid).toBeDefined();
  });

  it('7. Phát hiện can thiệp nhị phân trên TimeStampToken bên trong /Contents', async () => {
    const devTsa = new DevTestTsaProvider();
    const timestampedResult = await PdfSignatureAdapter.signPdf({
      unsignedPdfBuffer,
      keyAlias,
      keyProvider: provider,
      signerCertificatePem: signerCertPem,
      tsaProvider: devTsa,
      requireTimestamp: true,
    });

    const tamperedPdf = Buffer.from(timestampedResult.signedPdfBuffer);

    // Tìm trường /Contents <...> trong PDF
    const contentsTag = Buffer.from('/Contents');
    const contentsIndex = tamperedPdf.indexOf(contentsTag);
    const hexStart = tamperedPdf.indexOf('<', contentsIndex);
    const hexEnd = tamperedPdf.indexOf('>', hexStart);

    // Can thiệp vào phần cuối của chữ ký CMS (nơi chứa unsignedAttrs / TimeStampToken)
    // Thay đổi 2 hex chars thành 'ff'
    const targetHexPos = hexStart + Math.floor((hexEnd - hexStart) * 0.75);
    tamperedPdf[targetHexPos] = 102; // 'f'
    tamperedPdf[targetHexPos + 1] = 102; // 'f'

    const verifyResult = PdfSignatureVerifier.verify(tamperedPdf);

    // Chữ ký hoặc timestamp bị hỏng do can thiệp -> Bắt buộc isValid = false, isTampered = true
    expect(verifyResult.isValid).toBe(false);
    expect(verifyResult.isTampered).toBe(true);
  });
});
