import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { PdfSignatureAdapter } from './pdf-signature.adapter.js';
import { DevKeystoreGenerator } from '../dev-keystore-generator.js';
import { DevLocalKeystoreProvider } from '../providers/dev-local-keystore.provider.js';

describe('PdfSignatureAdapter (Unit Tests)', () => {
  let provider: DevLocalKeystoreProvider;
  let keyAlias: string;
  let signerCertPem: string;
  let testStorageDir: string;
  let samplePdfBuffer: Buffer;

  beforeEach(async () => {
    testStorageDir = path.join(process.cwd(), 'storage', 'keystores', 'test_adapter_spec');
    if (!fs.existsSync(testStorageDir)) {
      fs.mkdirSync(testStorageDir, { recursive: true });
    }
    provider = new DevLocalKeystoreProvider(testStorageDir);

    keyAlias = `adapter_test_key_${Date.now()}`;
    const generated = DevKeystoreGenerator.generateSelfSignedKeystore({
      commonName: 'Trần Ký Duyệt',
      organizationName: 'Tập đoàn VinaGroup',
    });
    signerCertPem = generated.certificatePem;
    provider.importKeystore(keyAlias, generated.p12Buffer);

    // Tạo PDF mẫu
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    page.drawText('TRINH KY ONLINE - UNIT TEST PDF', { x: 50, y: 800, size: 14, font, color: rgb(0, 0, 0) });
    samplePdfBuffer = Buffer.from(await doc.save());
  });

  afterEach(() => {
    if (fs.existsSync(testStorageDir)) {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    }
  });

  it('1. Ký số PDF thành công và sinh cấu trúc ByteRange hợp lệ', async () => {
    const result = await PdfSignatureAdapter.signPdf({
      unsignedPdfBuffer: samplePdfBuffer,
      keyAlias,
      keyProvider: provider,
      signerCertificatePem: signerCertPem,
      reason: 'Phê duyệt hợp đồng mẫu',
      signerName: 'Trần Ký Duyệt',
    });

    expect(result.signedPdfBuffer).toBeDefined();
    expect(result.signedPdfBuffer.length).toBeGreaterThan(samplePdfBuffer.length);
    expect(result.rawPdfHash).toBeDefined();
    expect(result.signedPdfHash).toBeDefined();
    expect(result.signedPdfHash).not.toBe(result.rawPdfHash);

    // Kiểm tra ByteRange
    const [o1, l1, o2, l2] = result.byteRange;
    expect(o1).toBe(0);
    expect(l1).toBeGreaterThan(0);
    expect(o2).toBeGreaterThan(l1);
    expect(o2 + l2).toBe(result.signedPdfBuffer.length);
    expect(result.signerSubjectDn).toContain('Trần Ký Duyệt');
  });

  it('2. Từ chối tệp không phải PDF (Không có magic bytes %PDF-)', async () => {
    const invalidBuffer = Buffer.from('NOT A VALID PDF FILE AT ALL', 'utf-8');

    await expect(
      PdfSignatureAdapter.signPdf({
        unsignedPdfBuffer: invalidBuffer,
        keyAlias,
        keyProvider: provider,
        signerCertificatePem: signerCertPem,
      })
    ).rejects.toThrow(/không phải là định dạng PDF hợp lệ/);
  });

  it('3. Từ chối tệp PDF rỗng (Empty buffer)', async () => {
    await expect(
      PdfSignatureAdapter.signPdf({
        unsignedPdfBuffer: Buffer.alloc(0),
        keyAlias,
        keyProvider: provider,
        signerCertificatePem: signerCertPem,
      })
    ).rejects.toThrow(/PDF đầu vào rỗng/);
  });

  it('4. Thất bại an toàn khi placeholder không đủ dung lượng chứa chữ ký CMS', async () => {
    await expect(
      PdfSignatureAdapter.signPdf({
        unsignedPdfBuffer: samplePdfBuffer,
        keyAlias,
        keyProvider: provider,
        signerCertificatePem: signerCertPem,
        placeholderHexLength: 100, // Quá nhỏ để chứa CMS 1200+ bytes (~2400 hex)
      })
    ).rejects.toThrow(/vượt quá dung lượng placeholder/);
  });
});
