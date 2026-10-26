import { Injectable, Logger } from '@nestjs/common';
import {
  ITimestampAuthorityProvider,
  TimestampRequestOptions,
  TimestampTokenResult,
  TimestampVerificationResult,
} from './timestamp.interface.js';
import { DevTestTsaProvider } from './dev-test-tsa.provider.js';
import { HttpTsaProvider } from './http-tsa.provider.js';
import { TimestampTokenVerifier } from './timestamp-token.verifier.js';

@Injectable()
export class TimestampService {
  private readonly logger = new Logger(TimestampService.name);
  private provider: ITimestampAuthorityProvider;

  constructor() {
    this.initProvider();
  }

  private initProvider(): void {
    const providerType = process.env.TSA_PROVIDER_TYPE || 'dev';
    const tsaUrl = process.env.TSA_URL;

    if (providerType === 'http' && tsaUrl) {
      const timeoutMs = Number(process.env.TSA_TIMEOUT_MS || 5000);
      const maxRetries = Number(process.env.TSA_MAX_RETRIES || 2);
      this.logger.log(`Khởi tạo HttpTsaProvider với URL: ${tsaUrl}, timeout: ${timeoutMs}ms, retries: ${maxRetries}`);
      this.provider = new HttpTsaProvider({
        tsaUrl,
        defaultTimeoutMs: timeoutMs,
        maxRetries,
      });
    } else {
      this.logger.log('Khởi tạo DevTestTsaProvider nội bộ cho môi trường dev/test.');
      this.provider = new DevTestTsaProvider({
        commonName: 'Trinh Ky Online Internal Trusted TSA',
        organizationName: 'Trinh Ky Online PKI Lab',
      });
    }
  }

  /**
   * Thay thế provider (hữu ích cho kiểm thử giả lập lỗi, mạng, timeout)
   */
  public setProvider(provider: ITimestampAuthorityProvider): void {
    this.provider = provider;
  }

  public getProvider(): ITimestampAuthorityProvider {
    return this.provider;
  }

  /**
   * Lấy dấu thời gian RFC 3161 cho 32 byte hash
   * @param digest32Bytes SHA-256 của chữ ký người ký (SignerInfo signatureValue)
   * @param options Tùy chọn (nonce, policy, timeout)
   */
  public async getTimestampToken(
    digest32Bytes: Buffer,
    options?: TimestampRequestOptions
  ): Promise<TimestampTokenResult> {
    return this.provider.getTimestampToken(digest32Bytes, options);
  }

  /**
   * Xác minh độc lập tính hợp lệ của TimeStampToken
   */
  public verifyTimestampToken(
    tokenDer: Buffer,
    expectedDigest: Buffer,
    expectedNonce?: string
  ): TimestampVerificationResult {
    return TimestampTokenVerifier.verifyToken(tokenDer, expectedDigest, expectedNonce);
  }

  /**
   * Kiểm tra xem TSA hiện tại có sẵn sàng phục vụ không
   */
  public async isTsaAvailable(): Promise<boolean> {
    try {
      return await this.provider.isAvailable();
    } catch {
      return false;
    }
  }
}
