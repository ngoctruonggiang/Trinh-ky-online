import { describe, it, expect } from 'vitest';
import * as crypto from 'crypto';
import * as forge from 'node-forge';
import { Rfc3161TimestampClient } from './rfc3161-timestamp.client.js';
import { DevTestTsaProvider } from './dev-test-tsa.provider.js';
import { HttpTsaProvider } from './http-tsa.provider.js';

describe('Rfc3161TimestampClient & HttpTsaProvider (Unit Tests)', () => {
  const digest = crypto.createHash('sha256').update(Buffer.from('sample signature bytes')).digest();

  it('1. buildTimeStampReq tạo cấu trúc ASN.1 DER chuẩn RFC 3161', () => {
    const { reqDer, nonceHex } = Rfc3161TimestampClient.buildTimeStampReq(digest, {
      certReq: true,
    });

    expect(reqDer).toBeInstanceOf(Buffer);
    expect(reqDer.length).toBeGreaterThan(0);
    expect(nonceHex).toHaveLength(16); // 8 bytes = 16 hex chars

    // Parse ngược lại DER bằng forge
    const asn1 = forge.asn1;
    const reqAsn1: any = asn1.fromDer(reqDer.toString('binary'));

    expect(reqAsn1.tagClass).toBe(asn1.Class.UNIVERSAL);
    expect(reqAsn1.type).toBe(asn1.Type.SEQUENCE);

    // version 1
    const version = reqAsn1.value[0].value;
    expect(forge.util.bytesToHex(version)).toBe('01');

    // messageImprint
    const msgImprint = reqAsn1.value[1];
    const hashAlgoOid = asn1.derToOid(msgImprint.value[0].value[0].value);
    expect(hashAlgoOid).toBe('2.16.840.1.101.3.4.2.1'); // sha256
    const hashedBytes = Buffer.from(msgImprint.value[1].value, 'binary');
    expect(hashedBytes.equals(digest)).toBe(true);

    // certReq BOOLEAN true (0xff)
    const certReqField = reqAsn1.value[reqAsn1.value.length - 1];
    expect(certReqField.type).toBe(asn1.Type.BOOLEAN);
    expect(certReqField.value.charCodeAt(0)).toBe(0xff);
  });

  it('2. buildTimeStampReq từ chối digest không đúng 32 bytes', () => {
    const invalidDigest = Buffer.from('short');
    expect(() => Rfc3161TimestampClient.buildTimeStampReq(invalidDigest)).toThrow(
      'Yêu cầu chính xác 32 byte SHA-256 digest'
    );
  });

  it('3. parseTimeStampResp phân tích phản hồi thành công (PKIStatus = 0)', async () => {
    const devTsa = new DevTestTsaProvider();
    const tokenResult = await devTsa.getTimestampToken(digest);

    // Xây dựng TimeStampResp chuẩn RFC 3161 bao bọc token
    const asn1 = forge.asn1;
    const pkiStatusInfo = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, String.fromCharCode(0x00)), // status 0 = granted
    ]);
    const tokenAsn1 = asn1.fromDer(tokenResult.tokenDer.toString('binary'));

    const timeStampResp = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      pkiStatusInfo,
      tokenAsn1,
    ]);
    const respDer = Buffer.from(asn1.toDer(timeStampResp).getBytes(), 'binary');

    const parsedResult = Rfc3161TimestampClient.parseTimeStampResp(respDer, digest);
    expect(parsedResult).toBeDefined();
    expect(parsedResult.genTime).toBeInstanceOf(Date);
    expect(parsedResult.tokenDer).toBeInstanceOf(Buffer);
    expect(parsedResult.tsaSubjectDn).toContain('Internal TSA');
  });

  it('4. parseTimeStampResp từ chối phản hồi bị TSA từ chối (PKIStatus = 2 rejection)', () => {
    const asn1 = forge.asn1;
    const pkiStatusInfo = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, String.fromCharCode(0x02)), // status 2 = rejection
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.UTF8, false, 'Yêu cầu không được chấp thuận bởi chính sách TSA'),
      ]),
    ]);

    const timeStampResp = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      pkiStatusInfo,
    ]);
    const respDer = Buffer.from(asn1.toDer(timeStampResp).getBytes(), 'binary');

    expect(() => Rfc3161TimestampClient.parseTimeStampResp(respDer, digest)).toThrow(
      /Máy chủ TSA từ chối yêu cầu đóng dấu thời gian \(Mã trạng thái RFC 3161: 2/
    );
  });

  it('5. HttpTsaProvider cấu hình giới hạn số lần thử lại (Bounded Retries)', async () => {
    const httpTsa = new HttpTsaProvider({
      tsaUrl: 'http://127.0.0.1:59999/non-existent-tsa-endpoint',
      maxRetries: 1,
      retryDelayMs: 50,
      defaultTimeoutMs: 500,
    });

    const isAvail = await httpTsa.isAvailable();
    expect(isAvail).toBe(true);

    const startTime = Date.now();
    await expect(httpTsa.getTimestampToken(digest)).rejects.toThrow();
    const duration = Date.now() - startTime;

    // Phải dừng sau số lần thử giới hạn (không retry vô hạn)
    expect(duration).toBeLessThan(5000);
  });
});
