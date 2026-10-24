import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as forge from 'node-forge';
import { DevLocalKeystoreProvider } from './providers/dev-local-keystore.provider';
import { DevKeystoreGenerator } from './dev-keystore-generator';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';

describe('DevLocalKeystoreProvider (Unit Tests)', () => {
  let provider: DevLocalKeystoreProvider;
  const testAlias = 'test_key_alias_unit';
  const testPassphrase = 'TestPassphrase2026!Secure';

  beforeEach(() => {
    provider = new DevLocalKeystoreProvider();
    provider.clearCache();
  });

  it('1. Khởi tạo và import tệp PKCS#12 hợp lệ thành công', () => {
    const generated = DevKeystoreGenerator.generateSelfSignedKeystore({
      commonName: 'Nguyen Van A',
      organizationName: 'VinaGroup Test',
      passphrase: testPassphrase,
      validityDays: 365,
    });

    const meta = provider.importKeystore(testAlias, generated.p12Buffer, testPassphrase);

    expect(meta.subjectDn).toContain('Nguyen Van A');
    expect(meta.subjectDn).toContain('DEV TEST ONLY');
    expect(meta.issuerDn).toContain('Nguyen Van A');
    expect(meta.serialNumber).toBeDefined();
    expect(meta.fingerprintSha256).toBe(generated.fingerprintSha256);
    expect(meta.certificatePem).toContain('BEGIN CERTIFICATE');
    expect(meta.publicKeyPem).toContain('BEGIN PUBLIC KEY');
    expect(meta.validFrom).toBeInstanceOf(Date);
    expect(meta.validTo).toBeInstanceOf(Date);
  });

  it('2. Từ chối tệp PKCS#12 khi sai mật khẩu giải mã (UnauthorizedException)', () => {
    const generated = DevKeystoreGenerator.generateSelfSignedKeystore({
      commonName: 'Wrong Pass User',
      passphrase: 'CorrectPassword123!',
    });

    expect(() => {
      provider.parsePkcs12Buffer('wrong_pass_key', generated.p12Buffer, 'INCORRECT_PASSWORD!');
    }).toThrow(UnauthorizedException);
  });

  it('3. Ký dữ liệu thô (signData) và xác minh độc lập bằng Public Key thành công', async () => {
    const generated = DevKeystoreGenerator.generateSelfSignedKeystore({
      commonName: 'Signer Alpha',
      passphrase: testPassphrase,
    });
    provider.importKeystore('signer_alpha', generated.p12Buffer, testPassphrase);

    const testPayload = Buffer.from('Văn bản hợp đồng kinh tế nội bộ - Cần ký số xác nhận', 'utf8');
    const result = await provider.signData('signer_alpha', testPayload);

    expect(result.signatureBytes).toBeInstanceOf(Buffer);
    expect(result.signatureBytes.length).toBe(256); // 2048-bit RSA signature = 256 bytes
    expect(result.algorithm).toBe('RSA-SHA256');
    expect(result.keyAlias).toBe('signer_alpha');
    expect(result.certificatePem).toContain('BEGIN CERTIFICATE');

    // Xác minh độc lập bằng public key từ certificate công khai
    const x509 = new crypto.X509Certificate(result.certificatePem);
    const isVerified = crypto.verify('sha256', testPayload, x509.publicKey, result.signatureBytes);
    expect(isVerified).toBe(true);

    // Xác minh khi payload bị sửa đổi -> Phải trả về false
    const tamperedPayload = Buffer.from('Văn bản hợp đồng đã bị hacker sửa đổi nội dung!', 'utf8');
    const isTamperedVerified = crypto.verify('sha256', tamperedPayload, x509.publicKey, result.signatureBytes);
    expect(isTamperedVerified).toBe(false);
  });

  it('4. Ký mã băm (signDigest) chuẩn RSASSA-PKCS1-v1_5 với Digest 32 bytes', async () => {
    const generated = DevKeystoreGenerator.generateSelfSignedKeystore({
      commonName: 'Digest Signer',
      passphrase: testPassphrase,
    });
    provider.importKeystore('digest_signer', generated.p12Buffer, testPassphrase);

    const rawDocument = Buffer.from('Nội dung tài liệu PDF thô để tính byte range digest');
    const digest32 = crypto.createHash('sha256').update(rawDocument).digest();

    expect(digest32.length).toBe(32);

    const result = await provider.signDigest('digest_signer', digest32);

    expect(result.signatureBytes.length).toBe(256);

    // Chuẩn xác minh: Signature tạo từ signDigest(digest32) PHẢI khớp hoàn hảo với xác minh sha256 trên rawDocument!
    const x509 = new crypto.X509Certificate(result.certificatePem);
    const isVerified = crypto.verify('sha256', rawDocument, x509.publicKey, result.signatureBytes);
    expect(isVerified).toBe(true);
  });

  it('5. Từ chối bản băm có kích thước sai lệch (không phải 32 bytes của SHA-256)', async () => {
    const generated = DevKeystoreGenerator.generateSelfSignedKeystore({
      commonName: 'Invalid Digest Signer',
      passphrase: testPassphrase,
    });
    provider.importKeystore('invalid_digest_key', generated.p12Buffer, testPassphrase);

    // 16 bytes (MD5) hoặc 64 bytes (SHA-512)
    const invalidDigest16 = Buffer.alloc(16);
    const invalidDigest64 = Buffer.alloc(64);

    await expect(provider.signDigest('invalid_digest_key', invalidDigest16)).rejects.toThrow(BadRequestException);
    await expect(provider.signDigest('invalid_digest_key', invalidDigest64)).rejects.toThrow(BadRequestException);
  });

  it('6. Phát hiện và chặn xung đột khi Certificate và Private Key không thuộc cùng một cặp khóa', () => {
    const pki = forge.pki;
    // Cặp khóa 1
    const pair1 = pki.rsa.generateKeyPair({ bits: 1024, workers: -1 });
    const cert1 = pki.createCertificate();
    cert1.publicKey = pair1.publicKey;
    cert1.serialNumber = '01';
    cert1.validity.notBefore = new Date();
    cert1.validity.notAfter = new Date();
    cert1.validity.notAfter.setFullYear(cert1.validity.notBefore.getFullYear() + 1);
    cert1.setSubject([{ name: 'commonName', value: 'User 1' }]);
    cert1.setIssuer([{ name: 'commonName', value: 'User 1' }]);
    cert1.sign(pair1.privateKey, forge.md.sha256.create());

    // Cặp khóa 2 (Không liên quan)
    const pair2 = pki.rsa.generateKeyPair({ bits: 1024, workers: -1 });

    // Đóng gói Certificate của pair1 nhưng với Private Key của pair2!
    const mismatchedP12 = forge.pkcs12.toPkcs12Asn1(pair2.privateKey, [cert1], 'testPass');
    const p12Buffer = Buffer.from(forge.asn1.toDer(mismatchedP12).getBytes(), 'binary');

    expect(() => {
      provider.parsePkcs12Buffer('mismatched_key', p12Buffer, 'testPass');
    }).toThrow(BadRequestException);
  });

  it('7. Chống tấn công Path Traversal trên keyAlias', () => {
    expect(() => provider.resolveKeystorePath('../../etc/passwd')).toThrow(BadRequestException);
    expect(() => provider.resolveKeystorePath('valid/nested/path')).toThrow(BadRequestException);
    expect(() => provider.resolveKeystorePath('key alias with space')).toThrow(BadRequestException);
    expect(() => provider.resolveKeystorePath('key;inject')).toThrow(BadRequestException);
  });

  it('8. Báo lỗi có cấu trúc NotFoundException khi keyAlias không tồn tại', async () => {
    await expect(provider.signData('non_existent_key_999', Buffer.from('test'))).rejects.toThrow(NotFoundException);
  });

  it('9. Kiểm tra isAvailable trả về true khi có tệp và false khi không có tệp', async () => {
    const isAvailableNonExistent = await provider.isAvailable('definitely_not_exist_key');
    expect(isAvailableNonExistent).toBe(false);

    const generated = DevKeystoreGenerator.generateSelfSignedKeystore({
      commonName: 'Available Key',
      passphrase: testPassphrase,
    });
    provider.importKeystore('available_key', generated.p12Buffer, testPassphrase);

    const isAvailableExisting = await provider.isAvailable('available_key');
    expect(isAvailableExisting).toBe(true);
  });
});
