import { describe, expect, it } from 'vitest';
import { SsrfProtectionUtil } from '../../src/modules/signing/revocation/ssrf-protection.util.js';

describe('SsrfProtectionUtil (Unit Tests)', () => {
  it('1. Nhận diện chính xác các địa chỉ IP nội bộ / Loopback / Private IP', () => {
    // Loopback
    expect(SsrfProtectionUtil.isPrivateIp('127.0.0.1')).toBe(true);
    expect(SsrfProtectionUtil.isPrivateIp('127.255.255.255')).toBe(true);
    expect(SsrfProtectionUtil.isPrivateIp('::1')).toBe(true);

    // Class A Private (10.0.0.0/8)
    expect(SsrfProtectionUtil.isPrivateIp('10.0.0.1')).toBe(true);
    expect(SsrfProtectionUtil.isPrivateIp('10.255.255.254')).toBe(true);

    // Class B Private (172.16.0.0/12)
    expect(SsrfProtectionUtil.isPrivateIp('172.16.0.1')).toBe(true);
    expect(SsrfProtectionUtil.isPrivateIp('172.31.255.255')).toBe(true);
    expect(SsrfProtectionUtil.isPrivateIp('172.32.0.1')).toBe(false); // Public IP

    // Class C Private (192.168.0.0/16)
    expect(SsrfProtectionUtil.isPrivateIp('192.168.1.1')).toBe(true);
    expect(SsrfProtectionUtil.isPrivateIp('192.168.100.254')).toBe(true);

    // Link-local / Cloud Metadata (169.254.169.254)
    expect(SsrfProtectionUtil.isPrivateIp('169.254.169.254')).toBe(true);

    // Public IP hợp lệ
    expect(SsrfProtectionUtil.isPrivateIp('8.8.8.8')).toBe(false);
    expect(SsrfProtectionUtil.isPrivateIp('1.1.1.1')).toBe(false);
    expect(SsrfProtectionUtil.isPrivateIp('142.250.190.46')).toBe(false);
  });

  it('2. Từ chối các URL có giao thức không được phép (ftp, file, gopher, ldap)', async () => {
    await expect(SsrfProtectionUtil.assertSafeUrl('file:///etc/passwd')).rejects.toThrow(
      /Giao thức không được phép/
    );
    await expect(SsrfProtectionUtil.assertSafeUrl('ftp://example.com/crl.crl')).rejects.toThrow(
      /Giao thức không được phép/
    );
    await expect(SsrfProtectionUtil.assertSafeUrl('gopher://127.0.0.1:70/')).rejects.toThrow(
      /Giao thức không được phép/
    );
  });

  it('3. Chặn các tên miền cục bộ localhost, .local, .internal', async () => {
    await expect(SsrfProtectionUtil.assertSafeUrl('http://localhost:8080/ocsp')).rejects.toThrow(
      /bị chặn bởi chính sách Anti-SSRF/
    );
    await expect(SsrfProtectionUtil.assertSafeUrl('http://server.local/ocsp')).rejects.toThrow(
      /bị chặn bởi chính sách Anti-SSRF/
    );
    await expect(SsrfProtectionUtil.assertSafeUrl('http://metadata.internal/crl')).rejects.toThrow(
      /bị chặn bởi chính sách Anti-SSRF/
    );
  });

  it('4. Chặn các URL trỏ tới dải IP private qua DNS (127.0.0.1, 10.0.0.1)', async () => {
    await expect(SsrfProtectionUtil.assertSafeUrl('http://127.0.0.1/ocsp')).rejects.toThrow(
      /phân giải tới địa chỉ IP nội bộ bị cấm/
    );
    await expect(SsrfProtectionUtil.assertSafeUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow(
      /phân giải tới địa chỉ IP nội bộ bị cấm/
    );
  });

  it('5. Cho phép localhost khi bật cờ allowLocalhostForTesting trong môi trường test', async () => {
    await expect(
      SsrfProtectionUtil.assertSafeUrl('http://127.0.0.1:4000/ocsp', true)
    ).resolves.not.toThrow();
  });
});
