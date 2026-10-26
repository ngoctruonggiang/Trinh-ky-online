import { describe, it, expect, beforeAll } from 'vitest';
import * as crypto from 'crypto';
import * as forge from 'node-forge';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { SandboxKmsSigningProvider } from '../../src/modules/signing/providers/sandbox-kms-signing.provider.js';
import { DevKeystoreGenerator } from '../../src/modules/signing/dev-keystore-generator.js';
import { PdfSignatureAdapter } from '../../src/modules/signing/engine/pdf-signature.adapter.js';
import { PdfSignatureVerifier } from '../../src/modules/signing/engine/pdf-signature.verifier.js';
import { DevTestTsaProvider } from '../../src/modules/signing/timestamp/dev-test-tsa.provider.js';

describe('Hạng mục D: Production Signing Provider Architecture & Swappability (Unit/Sandbox Tests)', () => {
  let kmsProvider: SandboxKmsSigningProvider;
  let testKeyAlias: string;
  let testCertPem: string;
  let testKeyArn: string;
  let samplePdfBuffer: Buffer;
  let tsaProvider: DevTestTsaProvider;

  beforeAll(() => {
    kmsProvider = new SandboxKmsSigningProvider();
    tsaProvider = new DevTestTsaProvider();

    // 1. Tạo cặp khóa RSA và chứng thư số thử nghiệm
    const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '1001';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);

    const attrs = [
      { name: 'commonName', value: 'Alpha Cloud KMS Signing Key' },
      { name: 'organizationName', value: 'Alpha Corp KMS' },
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(keys.privateKey, forge.md.sha256.create());

    testKeyAlias = 'kms-key-alpha-prod-alias';
    testKeyArn = 'arn:aws:kms:ap-southeast-1:123456789012:key/550e8400-e29b-41d4-a716-446655440000';
    testCertPem = forge.pki.certificateToPem(cert);
    const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);

    kmsProvider.registerSandboxKey({
      keyAlias: testKeyAlias,
      keyArn: testKeyArn,
      certificatePem: testCertPem,
      privateKeyPem,
      algorithm: 'RSA-SHA256',
      enabled: true,
      version: 1,
    });

    // 2. Tạo một tệp PDF đơn giản để kiểm thử
    samplePdfBuffer = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n' +
      'xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n' +
      'trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n190\n%%EOF\n',
      'latin1'
    );
  });

  it('1. Swappability: PdfSignatureAdapter thực hiện ký số hoàn hảo qua SandboxKmsSigningProvider mà không đổi logic lõi', async () => {
    const signingResult = await PdfSignatureAdapter.signPdf({
      unsignedPdfBuffer: samplePdfBuffer,
      keyAlias: testKeyAlias,
      keyProvider: kmsProvider,
      signerCertificatePem: testCertPem,
      reason: 'Ký duyệt số thông qua Cloud KMS Provider',
      signerName: 'Ban Lãnh Đạo Alpha',
      location: 'Hà Nội',
      tsaProvider,
      requireTimestamp: true,
    });

    expect(signingResult).toBeDefined();
    expect(signingResult.signedPdfBuffer).toBeDefined();
    expect(signingResult.hasTimestamp).toBe(true);
    expect(signingResult.byteRange.length).toBe(4);

    // Xác minh tệp PDF đã ký
    const verifyResult = PdfSignatureVerifier.verify(signingResult.signedPdfBuffer);
    expect(verifyResult.isValid).toBe(true);
    expect(verifyResult.isTampered).toBe(false);
    expect(verifyResult.hasTimestamp).toBe(true);
    expect(verifyResult.isTimestampValid).toBe(true);
  });

  it('2. Chặn lỗi định dạng: Từ chối digest có kích thước sai lệch (không phải đúng 32 bytes)', async () => {
    const invalidDigest16 = crypto.randomBytes(16);
    const invalidDigest64 = crypto.randomBytes(64);

    await expect(kmsProvider.signDigest(testKeyAlias, invalidDigest16)).rejects.toThrow(
      BadRequestException
    );

    await expect(kmsProvider.signDigest(testKeyAlias, invalidDigest64)).rejects.toThrow(
      BadRequestException
    );
  });

  it('3. Không bao giờ lộ private key trong kết quả trả về của Provider', async () => {
    const hash32 = crypto.createHash('sha256').update('test-payload').digest();
    const result = await kmsProvider.signDigest(testKeyAlias, hash32);

    expect(result.signatureBytes).toBeInstanceOf(Buffer);
    expect((result as any).privateKey).toBeUndefined();
    expect((result as any).privateKeyPem).toBeUndefined();
    expect(result.certificatePem).toBe(testCertPem);
  });

  it('4. Phục hồi qua Retry và Backoff khi gặp lỗi mạng tạm thời (Transient Rate Limit/Throttling)', async () => {
    // Tạo một provider với tỷ lệ lỗi mạng tạm thời 50% nhưng có 3 lần retry
    const flakyProvider = new SandboxKmsSigningProvider({
      failureRate: 0.5,
      maxRetries: 3,
    });

    const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '2002';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);
    cert.setSubject([{ name: 'commonName', value: 'Flaky KMS' }]);
    cert.setIssuer([{ name: 'commonName', value: 'Flaky KMS' }]);
    cert.sign(keys.privateKey, forge.md.sha256.create());

    flakyProvider.registerSandboxKey({
      keyAlias: 'flaky-key',
      keyArn: 'arn:aws:kms:flaky',
      certificatePem: forge.pki.certificateToPem(cert),
      privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
      algorithm: 'RSA-SHA256',
      enabled: true,
      version: 1,
    });

    const hash32 = crypto.createHash('sha256').update('retry-test').digest();
    const result = await flakyProvider.signDigest('flaky-key', hash32);

    expect(result).toBeDefined();
    expect(result.signatureBytes.length).toBeGreaterThan(0);
  });

  it('5. Fail-Closed khi khóa bị vô hiệu hóa hoặc không tồn tại trong Cloud KMS', async () => {
    await expect(
      kmsProvider.signDigest('non-existent-kms-key-id', crypto.randomBytes(32))
    ).rejects.toThrow(ServiceUnavailableException);

    expect(await kmsProvider.isAvailable('non-existent-kms-key-id')).toBe(false);
  });

  it('6. Lấy siêu dữ liệu chứng thư và thông tin cấu hình từ xa không làm lộ secret', async () => {
    const certMeta = await kmsProvider.getCertificate(testKeyAlias);
    expect(certMeta.subjectDn).toContain('Alpha Cloud KMS');
    expect(certMeta.publicKeyPem).toBeDefined();
    expect(certMeta.fingerprintSha256.length).toBe(64);

    const remoteInfo = await kmsProvider.getRemoteKeyInfo(testKeyAlias);
    expect(remoteInfo.keyArnOrId).toBe(testKeyArn);
    expect(remoteInfo.providerType).toBe('AWS_KMS');
    expect(remoteInfo.credentialsRef).toContain('TrinhKySigningRole');
    expect((remoteInfo as any).accessKeyId).toBeUndefined();
    expect((remoteInfo as any).secretAccessKey).toBeUndefined();
  });
});
