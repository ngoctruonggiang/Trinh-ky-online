import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { CmsSignatureBuilder } from './cms-signature.builder.js';
import { DevKeystoreGenerator } from '../dev-keystore-generator.js';
import { DevLocalKeystoreProvider } from '../providers/dev-local-keystore.provider.js';
import { DevTestTsaProvider } from '../timestamp/dev-test-tsa.provider.js';

describe('CmsSignatureBuilder (Unit Tests)', () => {
  let provider: DevLocalKeystoreProvider;
  let keyAlias: string;
  let signerCertPem: string;
  let testStorageDir: string;

  beforeEach(() => {
    testStorageDir = path.join(process.cwd(), 'storage', 'keystores', 'test_cms_spec');
    if (!fs.existsSync(testStorageDir)) {
      fs.mkdirSync(testStorageDir, { recursive: true });
    }
    provider = new DevLocalKeystoreProvider(testStorageDir);

    keyAlias = `test_cms_key_${Date.now()}`;
    const generated = DevKeystoreGenerator.generateSelfSignedKeystore({
      commonName: 'Nguyễn Văn Ký Số',
      organizationName: 'Tập đoàn VinaGroup',
    });
    signerCertPem = generated.certificatePem;
    provider.importKeystore(keyAlias, generated.p12Buffer);
  });

  afterEach(() => {
    if (fs.existsSync(testStorageDir)) {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    }
  });

  it('1. Tạo thành công CMS Detached Signature với 32-byte SHA-256 digest', async () => {
    const rawData = Buffer.from('Dữ liệu hợp đồng điện tử 2026 cần bảo vệ toàn vẹn', 'utf-8');
    const messageDigest = crypto.createHash('sha256').update(rawData).digest();

    const result = await CmsSignatureBuilder.buildDetachedSignature({
      messageDigest,
      keyAlias,
      keyProvider: provider,
      signerCertificatePem: signerCertPem,
      signingTime: new Date('2026-10-24T12:00:00Z'),
    });

    expect(result.cmsDer).toBeDefined();
    expect(result.cmsDer.length).toBeGreaterThan(500);
    expect(result.messageDigestHex).toBe(messageDigest.toString('hex'));
    expect(result.signerSubjectDn).toContain('Nguyễn Văn Ký Số');
    expect(result.serialNumber).toBeDefined();
    expect(result.hasTimestamp).toBe(false);
  });

  it('2. Từ chối digest không hợp lệ (không phải 32 bytes)', async () => {
    const invalidDigest = Buffer.from('digest_ngan_16_byte', 'utf-8');

    await expect(
      CmsSignatureBuilder.buildDetachedSignature({
        messageDigest: invalidDigest,
        keyAlias,
        keyProvider: provider,
        signerCertificatePem: signerCertPem,
      })
    ).rejects.toThrow(/messageDigest không hợp lệ/);
  });

  it('3. Không bao giờ lộ private key trong kết quả trả về', async () => {
    const messageDigest = crypto.createHash('sha256').update(Buffer.from('test')).digest();

    const result = await CmsSignatureBuilder.buildDetachedSignature({
      messageDigest,
      keyAlias,
      keyProvider: provider,
      signerCertificatePem: signerCertPem,
    });

    expect((result as any).privateKey).toBeUndefined();
    expect((result as any).privateKeyPem).toBeUndefined();
    expect((result as any).passphrase).toBeUndefined();
  });

  it('4. Xác minh độc lập CMS Detached bằng công cụ OpenSSL (nếu có)', async () => {
    const rawData = Buffer.from('Nội dung tài liệu kiểm tra OpenSSL độc lập', 'utf-8');
    const messageDigest = crypto.createHash('sha256').update(rawData).digest();

    const result = await CmsSignatureBuilder.buildDetachedSignature({
      messageDigest,
      keyAlias,
      keyProvider: provider,
      signerCertificatePem: signerCertPem,
    });

    const opensslPath = 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe';
    if (!fs.existsSync(opensslPath)) {
      console.warn('Bỏ qua kiểm thử OpenSSL vì không tìm thấy openssl.exe');
      return;
    }

    const tmpDir = path.join(testStorageDir, 'tmp_verify');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const contentFile = path.join(tmpDir, 'content.bin');
    const cmsFile = path.join(tmpDir, 'signature.der');
    const certFile = path.join(tmpDir, 'signer.pem');

    fs.writeFileSync(contentFile, rawData);
    fs.writeFileSync(cmsFile, result.cmsDer);
    fs.writeFileSync(certFile, signerCertPem);

    const cmd = `"${opensslPath}" cms -verify -inform DER -in "${cmsFile}" -content "${contentFile}" -CAfile "${certFile}" -binary`;
    const out = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    expect(out).toBe(rawData.toString('utf-8'));
  });

  it('5. Tạo thành công CMS Detached có nhúng RFC 3161 TimeStampToken trong unsignedAttrs', async () => {
    const rawData = Buffer.from('Dữ liệu hợp đồng điện tử có dấu thời gian tin cậy TSA', 'utf-8');
    const messageDigest = crypto.createHash('sha256').update(rawData).digest();
    const devTsa = new DevTestTsaProvider();

    const result = await CmsSignatureBuilder.buildDetachedSignature({
      messageDigest,
      keyAlias,
      keyProvider: provider,
      signerCertificatePem: signerCertPem,
      tsaProvider: devTsa,
      requireTimestamp: true,
    });

    expect(result.hasTimestamp).toBe(true);
    expect(result.timestampTokenDer).toBeInstanceOf(Buffer);
    expect(result.timestampGenTime).toBeInstanceOf(Date);
    expect(result.tsaSubjectDn).toContain('Internal TSA');
    expect(result.tsaSerialNumber).toBeDefined();
    expect(result.tsaPolicyOid).toBeDefined();

    // Xác minh rằng OpenSSL vẫn verify được CMS chữ ký người ký (không bị unsignedAttrs làm hỏng)
    const opensslPath = 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe';
    if (fs.existsSync(opensslPath)) {
      const tmpDir = path.join(testStorageDir, 'tmp_verify_ts');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

      const contentFile = path.join(tmpDir, 'content.bin');
      const cmsFile = path.join(tmpDir, 'signature_ts.der');
      const certFile = path.join(tmpDir, 'signer.pem');

      fs.writeFileSync(contentFile, rawData);
      fs.writeFileSync(cmsFile, result.cmsDer);
      fs.writeFileSync(certFile, signerCertPem);

      const cmd = `"${opensslPath}" cms -verify -inform DER -in "${cmsFile}" -content "${contentFile}" -CAfile "${certFile}" -binary`;
      const out = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      expect(out).toBe(rawData.toString('utf-8'));
    }
  });

  it('6. Thất bại có kiểm soát (Fail Closed) khi yêu cầu TSA bắt buộc mà TSA gặp sự cố', async () => {
    const rawData = Buffer.from('Dữ liệu yêu cầu timestamp bắt buộc', 'utf-8');
    const messageDigest = crypto.createHash('sha256').update(rawData).digest();
    const brokenTsa = new DevTestTsaProvider({ simulateFailure: true });

    await expect(
      CmsSignatureBuilder.buildDetachedSignature({
        messageDigest,
        keyAlias,
        keyProvider: provider,
        signerCertificatePem: signerCertPem,
        tsaProvider: brokenTsa,
        requireTimestamp: true,
      })
    ).rejects.toThrow(/Đóng dấu thời gian RFC 3161 thất bại trong chế độ ký bắt buộc timestamp/);
  });
});
