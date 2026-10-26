import * as dns from 'dns';
import { URL } from 'url';

/**
 * Tiện ích phòng chống tấn công Server-Side Request Forgery (SSRF)
 * khi truy vấn các dịch vụ PKI bên ngoài (AIA OCSP và CRL Distribution Points).
 */
export class SsrfProtectionUtil {
  /**
   * Kiểm tra một địa chỉ IP (IPv4 hoặc IPv6) có thuộc dải mạng nội bộ / loopback hay không
   */
  public static isPrivateIp(ip: string): boolean {
    const trimmed = ip.trim().toLowerCase();

    // 1. Kiểm tra IPv6 Loopback & Link-local / Unique-local
    if (
      trimmed === '::1' ||
      trimmed === '0:0:0:0:0:0:0:1' ||
      trimmed === '::' ||
      trimmed.startsWith('fc') ||
      trimmed.startsWith('fd') ||
      trimmed.startsWith('fe80:')
    ) {
      return true;
    }

    // 2. Chuyển đổi IPv4-mapped IPv6 (::ffff:127.0.0.1)
    let ipv4 = trimmed;
    if (trimmed.startsWith('::ffff:')) {
      ipv4 = trimmed.substring(7);
    }

    // 3. Phân tích 4 octets IPv4
    const parts = ipv4.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      // Nếu không parse được thành IPv4 hợp lệ mà cũng không phải IPv6 công khai -> từ chối
      return true;
    }

    const [a, b, c, d] = parts;

    // 127.0.0.0/8 (Loopback)
    if (a === 127) return true;

    // 0.0.0.0/8 (Current network)
    if (a === 0) return true;

    // 10.0.0.0/8 (Private Network Class A)
    if (a === 10) return true;

    // 172.16.0.0/12 (Private Network Class B: 172.16.0.0 - 172.31.255.255)
    if (a === 172 && b >= 16 && b <= 31) return true;

    // 192.168.0.0/16 (Private Network Class C)
    if (a === 192 && b === 168) return true;

    // 169.254.0.0/16 (Link-local / AWS / Azure / GCP Metadata Service 169.254.169.254)
    if (a === 169 && b === 254) return true;

    // 100.64.0.0/10 (Carrier-grade NAT)
    if (a === 100 && b >= 64 && b <= 127) return true;

    // 198.18.0.0/15 (Benchmarking)
    if (a === 198 && (b === 18 || b === 19)) return true;

    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (a >= 224) return true;

    return false;
  }

  /**
   * Thẩm định tính an toàn tuyệt đối của URL trước khi gửi HTTP request.
   * Chặn đứng SSRF, DNS Rebinding và truy cập Cloud Metadata endpoints.
   * 
   * @param targetUrl URL cần kiểm tra
   * @param allowLocalhostForTesting Cho phép localhost nếu ở môi trường kiểm thử giả lập
   */
  public static async assertSafeUrl(
    targetUrl: string,
    allowLocalhostForTesting = false
  ): Promise<void> {
    if (!targetUrl || typeof targetUrl !== 'string') {
      throw new Error('URL truy vấn rỗng hoặc không đúng định dạng chuỗi.');
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      throw new Error(`Cú pháp URL không hợp lệ: ${targetUrl}`);
    }

    // 1. Chỉ chấp nhận giao thức HTTP và HTTPS
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error(
        `Giao thức không được phép (Chỉ chấp nhận http: hoặc https:): ${parsedUrl.protocol}`
      );
    }

    const hostname = parsedUrl.hostname.toLowerCase();

    // 2. Chặn các tên miền cục bộ đặc biệt
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.lan')
    ) {
      if (!allowLocalhostForTesting) {
        throw new Error(`Truy cập tên miền nội bộ bị chặn bởi chính sách Anti-SSRF: ${hostname}`);
      }
    }

    // 3. Phân giải DNS và kiểm tra IP
    try {
      const addresses = await dns.promises.lookup(hostname, { all: true });
      if (!addresses || addresses.length === 0) {
        throw new Error(`Không thể phân giải DNS cho máy chủ: ${hostname}`);
      }

      for (const addr of addresses) {
        if (SsrfProtectionUtil.isPrivateIp(addr.address)) {
          if (allowLocalhostForTesting && (addr.address === '127.0.0.1' || addr.address === '::1')) {
            continue;
          }
          throw new Error(
            `Máy chủ ${hostname} phân giải tới địa chỉ IP nội bộ bị cấm (${addr.address}). Phát hiện nguy cơ SSRF!`
          );
        }
      }
    } catch (dnsErr: any) {
      if (dnsErr.message.includes('phát hiện nguy cơ SSRF') || dnsErr.message.includes('bị chặn')) {
        throw dnsErr;
      }
      throw new Error(`Lỗi phân giải tên miền máy chủ ${hostname}: ${dnsErr.message}`);
    }
  }
}
