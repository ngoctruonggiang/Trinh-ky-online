import { createHmac, timingSafeEqual } from 'crypto';

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

export interface JwtSignPayload {
  sub: string;
  email: string;
  fullName: string;
  role: string;
  organizationId?: string | null;
  departmentId?: string | null;
  [key: string]: any;
}

export interface JwtPayload extends JwtSignPayload {
  iat?: number;
  exp?: number;
}

export class JwtUtil {
  /**
   * Tạo JWT Token sử dụng thuật toán HMAC-SHA256 (HS256)
   */
  public static sign(
    payload: JwtSignPayload,
    secret: string,
    expiresInSeconds = 86400
  ): string {
    const now = Math.floor(Date.now() / 1000);
    const fullPayload: JwtPayload = {
      sub: payload.sub,
      email: payload.email,
      fullName: payload.fullName,
      role: payload.role,
      organizationId: payload.organizationId,
      departmentId: payload.departmentId,
      ...payload,
      iat: now,
      exp: now + expiresInSeconds,
    };

    const header = { alg: 'HS256', typ: 'JWT' };
    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));

    const signature = createHmac('sha256', secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest();
    const encodedSignature = base64UrlEncode(signature.toString('base64'));

    return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
  }

  /**
   * Xác thực và giải mã JWT Token
   */
  public static verify(
    token: string,
    secret: string
  ): { valid: boolean; payload?: JwtPayload; error?: string } {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return { valid: false, error: 'Cấu trúc token không đúng định dạng JWT.' };
      }

      const [encodedHeader, encodedPayload, encodedSignature] = parts;

      // 1. Kiểm tra chữ ký mật mã (Cryptographic Signature Verification)
      const expectedSignature = createHmac('sha256', secret)
        .update(`${encodedHeader}.${encodedPayload}`)
        .digest();
      const expectedEncodedSignature = base64UrlEncode(expectedSignature.toString('base64'));

      // Dùng timingSafeEqual để chống tấn công Timing Attack
      const sigBuffer = Buffer.from(encodedSignature);
      const expectedBuffer = Buffer.from(expectedEncodedSignature);

      if (
        sigBuffer.length !== expectedBuffer.length ||
        !timingSafeEqual(sigBuffer, expectedBuffer)
      ) {
        return { valid: false, error: 'Chữ ký JWT không hợp lệ (Signature mismatch).' };
      }

      // 2. Giải mã Payload
      const payload: JwtPayload = JSON.parse(base64UrlDecode(encodedPayload));

      // 3. Kiểm tra hạn sử dụng (Expiration Verification)
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        return { valid: false, error: 'Token đã hết hạn sử dụng (Token expired).' };
      }

      return { valid: true, payload };
    } catch (e: any) {
      return { valid: false, error: `Lỗi giải mã token: ${e.message}` };
    }
  }
}
