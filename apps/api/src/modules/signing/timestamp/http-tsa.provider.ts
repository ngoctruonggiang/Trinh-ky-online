import { Logger } from '@nestjs/common';
import {
  ITimestampAuthorityProvider,
  TimestampRequestOptions,
  TimestampTokenResult,
} from './timestamp.interface.js';
import {
  Rfc3161TimestampClient,
  Rfc3161ClientConfig,
} from './rfc3161-timestamp.client.js';

export interface HttpTsaConfig extends Rfc3161ClientConfig {
  maxRetries?: number;
  retryDelayMs?: number;
}

/**
 * Triển khai ITimestampAuthorityProvider kết nối tới máy chủ RFC 3161 TSA thực tế qua HTTP/HTTPS
 */
export class HttpTsaProvider implements ITimestampAuthorityProvider {
  private readonly logger = new Logger(HttpTsaProvider.name);
  private readonly client: Rfc3161TimestampClient;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly tsaUrl: string;

  constructor(config: HttpTsaConfig) {
    this.tsaUrl = config.tsaUrl;
    this.client = new Rfc3161TimestampClient(config);
    this.maxRetries = config.maxRetries !== undefined ? config.maxRetries : 2;
    this.retryDelayMs = config.retryDelayMs || 500;
  }

  public async getTimestampToken(
    digest32Bytes: Buffer,
    options: TimestampRequestOptions = {}
  ): Promise<TimestampTokenResult> {
    let lastError: any = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          this.logger.warn(
            `Thử lại kết nối TSA lần ${attempt}/${this.maxRetries} tới ${this.tsaUrl} sau ${this.retryDelayMs * attempt}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs * attempt));
        }

        return await this.client.requestTimestamp(digest32Bytes, options);
      } catch (err: any) {
        lastError = err;

        // Nếu là lỗi từ chối PKIStatus từ TSA hoặc lỗi tính toàn vẹn mật mã thì KHÔNG thử lại (fail fast)
        if (
          err.message &&
          (err.message.includes('Mã trạng thái RFC 3161') ||
            err.message.includes('không vượt qua kiểm tra toàn vẹn mật mã') ||
            err.message.includes('Extended Key Usage') ||
            err.message.includes('digest32Bytes không hợp lệ'))
        ) {
          this.logger.error(`Lỗi nghiệp vụ/mật mã từ TSA (không thử lại): ${err.message}`);
          throw err;
        }

        this.logger.warn(`Lỗi khi gọi TSA (lần thử ${attempt + 1}/${this.maxRetries + 1}): ${err.message}`);
      }
    }

    this.logger.error(`Đã vượt quá số lần thử lại tối đa (${this.maxRetries}) tới TSA: ${this.tsaUrl}`);
    throw lastError || new Error(`Không thể nhận TimeStampToken từ máy chủ TSA: ${this.tsaUrl}`);
  }

  public async isAvailable(): Promise<boolean> {
    try {
      // Kiểm tra URL hợp lệ
      const url = new URL(this.tsaUrl);
      return !!url.protocol && !!url.host;
    } catch {
      return false;
    }
  }
}
