import { describe, it, expect } from 'vitest';
import * as crypto from 'crypto';
import { TimestampTokenVerifier } from './timestamp-token.verifier.js';
import { DevTestTsaProvider } from './dev-test-tsa.provider.js';

describe('TimestampTokenVerifier & DevTestTsaProvider (Cryptographic Unit Tests)', () => {
  const tsaProvider = new DevTestTsaProvider({
    commonName: 'Test Lab TSA Authority',
    organizationName: 'Trinh Ky Online Test Organization',
  });

  it('1. Cấp và xác minh thành công TimeStampToken chuẩn RFC 3161', async () => {
    // Giả lập SHA-256 của chữ ký người ký (SignerInfo signatureValue)
    const fakeSignatureBytes = crypto.randomBytes(256);
    const expectedDigest = crypto.createHash('sha256').update(fakeSignatureBytes).digest();
    const nonce = crypto.randomBytes(8).toString('hex');

    const tokenResult = await tsaProvider.getTimestampToken(expectedDigest, { nonce });

    expect(tokenResult).toBeDefined();
    expect(tokenResult.tokenDer).toBeInstanceOf(Buffer);
    expect(tokenResult.genTime).toBeInstanceOf(Date);
    expect(tokenResult.serialNumber).toBeDefined();
    expect(tokenResult.policyOid).toBe('1.3.6.1.4.1.61498.1.1');
    expect(tokenResult.tsaSubjectDn).toContain('CN=Test Lab TSA Authority');
    expect(tokenResult.tsaCertificatePem).toContain('BEGIN CERTIFICATE');

    // Xác minh độc lập bằng TimestampTokenVerifier
    const verifyResult = TimestampTokenVerifier.verifyToken(
      tokenResult.tokenDer,
      expectedDigest,
      nonce
    );

    expect(verifyResult.isValid).toBe(true);
    expect(verifyResult.isDigestValid).toBe(true);
    expect(verifyResult.isSignatureValid).toBe(true);
    expect(verifyResult.isEkuValid).toBe(true);
    expect(verifyResult.genTime).toBeInstanceOf(Date);
    expect(verifyResult.tsaSubjectDn).toContain('Test Lab TSA Authority');
    expect(verifyResult.errorMessage).toBeUndefined();
  });

  it('2. Từ chối TimeStampToken khi mã băm messageImprint không khớp (Digest Mismatch)', async () => {
    const fakeSignatureBytes = crypto.randomBytes(256);
    const actualDigest = crypto.createHash('sha256').update(fakeSignatureBytes).digest();
    const wrongDigest = crypto.createHash('sha256').update(Buffer.from('tampered_data')).digest();

    const tokenResult = await tsaProvider.getTimestampToken(actualDigest);

    // Xác minh với wrongDigest
    const verifyResult = TimestampTokenVerifier.verifyToken(tokenResult.tokenDer, wrongDigest);

    expect(verifyResult.isValid).toBe(false);
    expect(verifyResult.isDigestValid).toBe(false);
    expect(verifyResult.errorMessage).toContain('không khớp với mã băm chữ ký');
  });

  it('3. Từ chối TimeStampToken khi Nonce không khớp (Chống Replay Attack)', async () => {
    const fakeSignatureBytes = crypto.randomBytes(256);
    const digest = crypto.createHash('sha256').update(fakeSignatureBytes).digest();
    const requestNonce = 'aabbccdd11223344';
    const wrongNonce = 'ffffffff00000000';

    const tokenResult = await tsaProvider.getTimestampToken(digest, { nonce: requestNonce });

    const verifyResult = TimestampTokenVerifier.verifyToken(
      tokenResult.tokenDer,
      digest,
      wrongNonce
    );

    expect(verifyResult.isValid).toBe(false);
    expect(verifyResult.isDigestValid).toBe(true);
    expect(verifyResult.errorMessage).toContain('không khớp với request nonce');
    expect(verifyResult.errorMessage).toContain('Replay Attack');
  });

  it('4. Từ chối TimeStampToken khi chứng thư TSA thiếu Extended Key Usage id-kp-timeStamping', async () => {
    const badEkuTsa = new DevTestTsaProvider({
      commonName: 'Bad TSA Without EKU',
      simulateMissingEku: true,
    });

    const fakeSignatureBytes = crypto.randomBytes(256);
    const digest = crypto.createHash('sha256').update(fakeSignatureBytes).digest();

    // DevTestTsaProvider tự xác minh khi tạo và sẽ phát hiện lỗi EKU ngay
    await expect(badEkuTsa.getTimestampToken(digest)).rejects.toThrow(
      /Extended Key Usage id-kp-timeStamping/
    );
  });

  it('5. Phát hiện can thiệp nhị phân trên TSTInfo hoặc Chữ ký TSA (Tamper Detection)', async () => {
    const fakeSignatureBytes = crypto.randomBytes(256);
    const digest = crypto.createHash('sha256').update(fakeSignatureBytes).digest();

    const tokenResult = await tsaProvider.getTimestampToken(digest);

    // Sao chép buffer và làm sai lệch byte trong chữ ký RSA của TSA
    const tamperedDer = Buffer.from(tokenResult.tokenDer);
    tamperedDer[tamperedDer.length - 15] = tamperedDer[tamperedDer.length - 15] ^ 0xff;

    const verifyResult = TimestampTokenVerifier.verifyToken(tamperedDer, digest);

    expect(verifyResult.isValid).toBe(false);
    // Can thiệp sẽ làm hỏng ASN.1 parsing hoặc làm hỏng chữ ký RSA
    expect(verifyResult.errorMessage).toBeDefined();
  });

  it('6. Từ chối Buffer rỗng hoặc ASN.1 không đúng định dạng', () => {
    const emptyResult = TimestampTokenVerifier.verifyToken(
      Buffer.alloc(0),
      crypto.randomBytes(32)
    );
    expect(emptyResult.isValid).toBe(false);
    expect(emptyResult.errorMessage).toContain('nhị phân rỗng');

    const malformedResult = TimestampTokenVerifier.verifyToken(
      Buffer.from('not an asn1 structure'),
      crypto.randomBytes(32)
    );
    expect(malformedResult.isValid).toBe(false);
  });

  it('7. DevTestTsaProvider hỗ trợ mô phỏng lỗi ngừng phục vụ (Fail Closed)', async () => {
    const failingTsa = new DevTestTsaProvider({ simulateFailure: true });
    expect(await failingTsa.isAvailable()).toBe(false);

    const digest = crypto.randomBytes(32);
    await expect(failingTsa.getTimestampToken(digest)).rejects.toThrow(
      'Máy chủ TSA giả lập đang ở trạng thái ngừng phục vụ'
    );
  });
});
