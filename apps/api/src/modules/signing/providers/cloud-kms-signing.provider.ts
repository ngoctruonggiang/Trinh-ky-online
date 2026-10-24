import { Injectable, NotImplementedException, ServiceUnavailableException } from '@nestjs/common';
import {
  CertificateMetadata,
  SignDataOptions,
  SignDigestOptions,
  SigningResult,
} from './signing-key-provider.interface';
import { IRemoteSigningProvider, RemoteKmsConfig, RemoteProviderType } from './remote-signing.interface';

/**
 * Adapter mẫu chuẩn bị cho Remote Signing Provider (AWS KMS / GCP Cloud KMS / VNPT SmartCA).
 * 
 * Tuân thủ nguyên tắc thiết kế bảo mật:
 * - Không giả lập chữ ký thật khi chưa có phần cứng/kết nối KMS thực tế.
 * - Khẳng định rõ ràng ranh giới chưa kết nối môi trường đám mây thay vì tạo chữ ký giả mạo.
 */
@Injectable()
export class CloudKmsSigningProvider implements IRemoteSigningProvider {
  public readonly providerType: RemoteProviderType = 'AWS_KMS';

  async getRemoteKeyInfo(keyAlias: string): Promise<RemoteKmsConfig> {
    throw new ServiceUnavailableException(
      `Remote KMS Provider chưa được cấu hình credentials thực tế cho khóa: ${keyAlias}. ` +
      `Vui lòng sử dụng DevLocalKeystoreProvider trong môi trường phát triển và kiểm thử.`
    );
  }

  async signData(
    keyAlias: string,
    data: Buffer,
    options?: SignDataOptions
  ): Promise<SigningResult> {
    throw new NotImplementedException(
      `Remote KMS signing cho khóa [${keyAlias}] chưa được kích hoạt. ` +
      `Cần cấu hình AWS KMS SDK / Cloud KMS Client với IAM Role phù hợp trong môi trường Production.`
    );
  }

  async signDigest(
    keyAlias: string,
    digest: Buffer,
    options?: SignDigestOptions
  ): Promise<SigningResult> {
    throw new NotImplementedException(
      `Remote KMS digest signing cho khóa [${keyAlias}] chưa được kích hoạt. ` +
      `Yêu cầu kết nối KMS thực tế.`
    );
  }

  async getCertificate(keyAlias: string): Promise<CertificateMetadata> {
    throw new ServiceUnavailableException(
      `Không thể truy xuất chứng thư số từ Remote KMS [${keyAlias}]: Chưa kết nối provider.`
    );
  }

  async getCertificateChain(keyAlias: string): Promise<string[]> {
    throw new ServiceUnavailableException(
      `Không thể lấy chuỗi chứng thư từ Remote KMS [${keyAlias}]: Chưa kết nối provider.`
    );
  }

  async isAvailable(keyAlias: string): Promise<boolean> {
    // Luôn trả về false khi chưa kết nối remote KMS thật để bảo đảm an toàn hệ thống
    return false;
  }
}
