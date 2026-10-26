import { Injectable, Logger } from '@nestjs/common';
import {
  IRevocationInformationProvider,
  RevocationCheckOptions,
  RevocationInfoResult,
} from './revocation.interface.js';
import { DevTestRevocationProvider } from './dev-test-revocation.provider.js';
import { HttpRevocationProvider } from './http-revocation.provider.js';

@Injectable()
export class RevocationService {
  private readonly logger = new Logger(RevocationService.name);
  private readonly provider: IRevocationInformationProvider;
  private readonly devProvider?: DevTestRevocationProvider;

  constructor() {
    const useHttp = process.env.REVOCATION_USE_HTTP === 'true';

    if (useHttp) {
      this.logger.log('Khởi tạo HttpRevocationProvider cho môi trường PKI thực tế (AIA OCSP / CRL DP).');
      this.provider = new HttpRevocationProvider();
    } else {
      this.logger.log('Khởi tạo DevTestRevocationProvider nội bộ cho môi trường dev/test.');
      this.devProvider = new DevTestRevocationProvider();
      this.provider = this.devProvider;
    }
  }

  public getProvider(): IRevocationInformationProvider {
    return this.provider;
  }

  public getDevProvider(): DevTestRevocationProvider | undefined {
    return this.devProvider;
  }

  /**
   * Truy vấn thông tin thu hồi (OCSP hoặc CRL) cho một chứng thư số
   */
  public async getRevocationInfo(
    certPem: string,
    issuerCertPem: string,
    options?: RevocationCheckOptions
  ): Promise<RevocationInfoResult> {
    return this.provider.getRevocationInfo(certPem, issuerCertPem, options);
  }
}
