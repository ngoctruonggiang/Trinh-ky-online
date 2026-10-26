import { describe, expect, it } from 'vitest';
import * as forge from 'node-forge';
import { DevTestRevocationProvider } from '../../src/modules/signing/revocation/dev-test-revocation.provider.js';
import { OcspCrlParserUtil } from '../../src/modules/signing/revocation/ocsp-crl-parser.util.js';

describe('OcspCrlParserUtil & DevTestRevocationProvider (Unit Tests)', () => {
  const devProvider = new DevTestRevocationProvider();
  const caCertPem = devProvider.getCaCertificatePem();

  it('1. Tạo và xác minh thành công OCSP Response với trạng thái GOOD', () => {
    const serialHex = '0x1A2B3C4D';
    const ocspDer = devProvider.generateOcspResponseDer(serialHex, 'GOOD', caCertPem);

    expect(ocspDer).toBeDefined();
    expect(ocspDer.length).toBeGreaterThan(100);

    const parseResult = OcspCrlParserUtil.verifyAndParseOcspResponse(
      ocspDer,
      serialHex,
      caCertPem
    );

    expect(parseResult.status).toBe('GOOD');
    expect(parseResult.sourceType).toBe('OCSP');
    expect(parseResult.isSignatureValid).toBe(true);
    expect(parseResult.thisUpdate).toBeDefined();
    expect(parseResult.nextUpdate).toBeDefined();
  });

  it('2. Tạo và xác minh thành công OCSP Response với trạng thái REVOKED', () => {
    const serialHex = '0x99887766';
    const ocspDer = devProvider.generateOcspResponseDer(serialHex, 'REVOKED', caCertPem);

    const parseResult = OcspCrlParserUtil.verifyAndParseOcspResponse(
      ocspDer,
      serialHex,
      caCertPem
    );

    expect(parseResult.status).toBe('REVOKED');
    expect(parseResult.sourceType).toBe('OCSP');
    expect(parseResult.isSignatureValid).toBe(true);
    expect(parseResult.revocationTime).toBeDefined();
  });

  it('3. Từ chối OCSP Response bị can thiệp nhị phân chữ ký (Tamper Detection)', () => {
    const serialHex = '0x1A2B3C4D';
    const ocspDer = devProvider.generateOcspResponseDer(serialHex, 'GOOD', caCertPem);

    // Can thiệp 1 byte vào chữ ký RSA ở cuối buffer
    const tamperedDer = Buffer.from(ocspDer);
    tamperedDer[tamperedDer.length - 10] ^= 0xff;

    const parseResult = OcspCrlParserUtil.verifyAndParseOcspResponse(
      tamperedDer,
      serialHex,
      caCertPem
    );

    expect(parseResult.status).toBe('UNAVAILABLE');
    expect(parseResult.isSignatureValid).toBe(false);
    expect(parseResult.errorMessage).toContain('không khớp với khóa công khai');
  });

  it('4. Tạo và xác minh thành công CRL với chứng thư không bị thu hồi (GOOD)', () => {
    const serialHex = '0x55443322';
    const crlDer = devProvider.generateCrlDer(['0x99999999'], caCertPem);

    expect(crlDer).toBeDefined();
    expect(crlDer.length).toBeGreaterThan(100);

    const parseResult = OcspCrlParserUtil.verifyAndParseCrl(
      crlDer,
      serialHex,
      caCertPem
    );

    expect(parseResult.status).toBe('GOOD');
    expect(parseResult.sourceType).toBe('CRL');
    expect(parseResult.isSignatureValid).toBe(true);
  });

  it('5. Phát hiện chứng thư bị thu hồi trong danh sách CRL (REVOKED)', () => {
    const revokedSerial = '0xDEADBEEF';
    const crlDer = devProvider.generateCrlDer([revokedSerial], caCertPem);

    const parseResult = OcspCrlParserUtil.verifyAndParseCrl(
      crlDer,
      revokedSerial,
      caCertPem
    );

    expect(parseResult.status).toBe('REVOKED');
    expect(parseResult.sourceType).toBe('CRL');
    expect(parseResult.isSignatureValid).toBe(true);
    expect(parseResult.revocationTime).toBeDefined();
  });

  it('6. Từ chối CRL bị can thiệp nhị phân chữ ký (Tamper Detection)', () => {
    const serialHex = '0x11223344';
    const crlDer = devProvider.generateCrlDer([], caCertPem);

    const tamperedDer = Buffer.from(crlDer);
    tamperedDer[tamperedDer.length - 15] ^= 0xff;

    const parseResult = OcspCrlParserUtil.verifyAndParseCrl(
      tamperedDer,
      serialHex,
      caCertPem
    );

    expect(parseResult.status).toBe('UNAVAILABLE');
    expect(parseResult.isSignatureValid).toBe(false);
    expect(parseResult.errorMessage).toContain('không hợp lệ với khóa công khai');
  });

  it('7. Không bao giờ biến UNKNOWN hoặc UNAVAILABLE thành GOOD', () => {
    const serialHex = '0xUNKNOWN';
    const wrongSerialOcspDer = devProvider.generateOcspResponseDer('0xDIFFERENT', 'GOOD', caCertPem);

    const parseResult = OcspCrlParserUtil.verifyAndParseOcspResponse(
      wrongSerialOcspDer,
      serialHex,
      caCertPem
    );

    expect(parseResult.status).toBe('UNKNOWN');
    expect(parseResult.status).not.toBe('GOOD');
  });
});
