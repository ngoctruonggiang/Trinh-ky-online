import { ISigningKeyProvider, SigningAlgorithm } from './signing-key-provider.interface';

export type RemoteProviderType =
  | 'AWS_KMS'
  | 'GCP_CLOUD_KMS'
  | 'AZURE_KEY_VAULT'
  | 'VNPT_SMART_CA'
  | 'VIETTEL_CA';

export interface RemoteKmsConfig {
  providerType: RemoteProviderType;
  endpoint?: string;
  region?: string;
  keyArnOrId: string;
  credentialsRef?: string; // Tên secret hoặc IAM role tham chiếu, không lưu plain text credentials
}

/**
 * Interface mở rộng cho các nhà cung cấp khóa ký từ xa (Cloud KMS / HSM / SmartCA).
 * Trong kiến trúc Production:
 * - Khóa riêng (Private Key) được bảo vệ vĩnh viễn trong thiết bị phần cứng HSM đạt chuẩn FIPS 140-2 Level 3.
 * - Khóa riêng KHÔNG BAO GIỜ có thể xuất (non-exportable) ra ngoài đám mây hay môi trường ứng dụng.
 * - Ứng dụng chỉ gửi bản băm (Digest) qua kênh kết nối bảo mật mTLS/HTTPS để nhận lại chữ ký số.
 */
export interface IRemoteSigningProvider extends ISigningKeyProvider {
  readonly providerType: RemoteProviderType;
  getRemoteKeyInfo(keyAlias: string): Promise<RemoteKmsConfig>;
}
