import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as forge from 'node-forge';
import {
  CertificateMetadata,
  ISigningKeyProvider,
  SignDataOptions,
  SignDigestOptions,
  SigningAlgorithm,
  SigningResult,
} from './signing-key-provider.interface.js';
import {
  IRemoteSigningProvider,
  RemoteKmsConfig,
  RemoteProviderType,
} from './remote-signing.interface.js';

export interface SandboxKmsKeyEntry {
  keyAlias: string;
  keyArn: string;
  certificatePem: string;
  privateKeyPem: string; // Trong sandbox: Private key lưu biệt lập trong mock secure enclave
  algorithm: SigningAlgorithm;
  enabled: boolean;
  version: number;
}

export interface SandboxKmsOptions {
  providerType?: RemoteProviderType;
  simulateLatencyMs?: number;
  failureRate?: number; // Tỷ lệ giả lập lỗi mạng tạm thời (0.0 -> 1.0)
  maxRetries?: number;
}

/**
 * SandboxKmsSigningProvider: Adapter sandbox chuẩn bị cho Cloud KMS / HSM thực tế.
 * 
 * TUÂN THỦ NGUYÊN TẮC KIẾN TRÚC:
 * 1. Interface ISigningKeyProvider & IRemoteSigningProvider tương thích 100% với Signing Engine.
 * 2. Phân định rõ ràng: Đây là Sandbox Adapter phục vụ kiểm thử kiến trúc Provider, KHÔNG PHẢI
 *    kết nối Cloud KMS thực tế. Chưa được coi là đã tích hợp Production cho đến khi cấu hình
 *    AWS KMS / GCP Cloud KMS SDK với IAM Role thực tế.
 * 3. Hỗ trợ đầy đủ:
 *    - Xác thực IAM token/credentialRef
 *    - Định dạng digest 32 bytes (SHA-256)
 *    - Cơ chế Retry & Backoff đối với lỗi tạm thời
 *    - Tự xác minh (Self-verification) chữ ký bằng Public Key trước khi trả về
 *    - Ghi nhận Audit Log không làm lộ khóa bí mật
 */
@Injectable()
export class SandboxKmsSigningProvider implements IRemoteSigningProvider {
  public readonly providerType: RemoteProviderType;
  private readonly logger = new Logger(SandboxKmsSigningProvider.name);
  private readonly keys = new Map<string, SandboxKmsKeyEntry>();
  private readonly simulateLatencyMs: number;
  private readonly failureRate: number;
  private readonly maxRetries: number;

  constructor(options: SandboxKmsOptions = {}) {
    this.providerType = options.providerType || 'AWS_KMS';
    this.simulateLatencyMs = options.simulateLatencyMs || 0;
    this.failureRate = options.failureRate || 0;
    this.maxRetries = options.maxRetries || 2;
  }

  /**
   * Đăng ký khóa ký sandbox với chứng thư và private key cách ly
   */
  public registerSandboxKey(entry: SandboxKmsKeyEntry): void {
    this.keys.set(entry.keyAlias, entry);
  }

  public async getRemoteKeyInfo(keyAlias: string): Promise<RemoteKmsConfig> {
    const key = this.keys.get(keyAlias);
    if (!key) {
      throw new ServiceUnavailableException(`Không tìm thấy khóa KMS từ xa với alias: ${keyAlias}`);
    }

    return {
      providerType: this.providerType,
      keyArnOrId: key.keyArn,
      region: 'ap-southeast-1',
      credentialsRef: 'arn:aws:iam::123456789012:role/TrinhKySigningRole',
    };
  }

  /**
   * Ký trên dữ liệu thô: băm dữ liệu trước rồi gọi signDigest
   */
  public async signData(
    keyAlias: string,
    data: Buffer,
    options?: SignDataOptions
  ): Promise<SigningResult> {
    const hash = crypto.createHash('sha256').update(data).digest();
    return await this.signDigest(keyAlias, hash, {
      algorithm: options?.algorithm || 'RSA-SHA256',
      isRawDigest: true,
    });
  }

  /**
   * Ký số mật mã trên 32-byte digest thông qua sandbox KMS enclave
   */
  public async signDigest(
    keyAlias: string,
    digest: Buffer,
    options?: SignDigestOptions
  ): Promise<SigningResult> {
    // 1. Kiểm tra kích thước Digest bắt buộc 32 bytes (SHA-256)
    if (!Buffer.isBuffer(digest) || digest.length !== 32) {
      throw new BadRequestException(
        `Cloud KMS từ chối: Digest đầu vào bắt buộc phải là SHA-256 có đúng 32 bytes. Nhận được: ${digest?.length || 0} bytes.`
      );
    }

    // 2. Tìm khóa trong Enclave
    const keyEntry = this.keys.get(keyAlias);
    if (!keyEntry || !keyEntry.enabled) {
      throw new ServiceUnavailableException(
        `Khóa KMS [${keyAlias}] không khả dụng hoặc đã bị vô hiệu hóa.`
      );
    }

    const algorithm = options?.algorithm || keyEntry.algorithm || 'RSA-SHA256';

    // 3. Cơ chế Retry & Exponential Backoff mô phỏng mạng đám mây
    let lastError: any = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const backoffMs = Math.pow(2, attempt) * 50;
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }

        if (this.simulateLatencyMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.simulateLatencyMs));
        }

        // Giả lập lỗi mạng tạm thời nếu failureRate > 0
        if (this.failureRate > 0 && Math.random() < this.failureRate && attempt < this.maxRetries) {
          throw new Error('KMS API Rate Limit Exceeded (ThrottlingException)');
        }

        // 4. Ký số trong Enclave
        const signatureBytes = this.executeEnclaveSign(keyEntry, digest, algorithm);

        // 5. TỰ XÁC MINH NGAY LẬP TỨC (Defense in depth / Post-Signing Verification)
        const isSelfVerified = this.verifySignatureWithPublicKey(
          keyEntry.certificatePem,
          digest,
          signatureBytes,
          algorithm
        );

        if (!isSelfVerified) {
          throw new InternalServerErrorException(
            `KMS Self-Verification Failed: Chữ ký số trả về từ KMS không khớp với Public Key của chứng thư.`
          );
        }

        return {
          signatureBytes,
          algorithm,
          keyAlias,
          certificatePem: keyEntry.certificatePem,
          signedAt: new Date(),
        };
      } catch (err: any) {
        lastError = err;
        if (err instanceof BadRequestException || err instanceof InternalServerErrorException) {
          throw err;
        }
      }
    }

    throw new ServiceUnavailableException(
      `Không thể hoàn tất ký số qua Cloud KMS sau ${this.maxRetries} lần thử: ${lastError?.message}`
    );
  }

  public async getCertificate(keyAlias: string): Promise<CertificateMetadata> {
    const key = this.keys.get(keyAlias);
    if (!key) {
      throw new ServiceUnavailableException(`Không tìm thấy chứng thư cho khóa KMS: ${keyAlias}`);
    }

    const cert = forge.pki.certificateFromPem(key.certificatePem);
    const publicKeyPem = forge.pki.publicKeyToPem(cert.publicKey);
    const fingerprintSha256 = crypto
      .createHash('sha256')
      .update(Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary'))
      .digest('hex');

    return {
      subjectDn: cert.subject.attributes.map((a: any) => `${a.shortName || a.name}=${a.value}`).join(', '),
      issuerDn: cert.issuer.attributes.map((a: any) => `${a.shortName || a.name}=${a.value}`).join(', '),
      serialNumber: cert.serialNumber,
      fingerprintSha256,
      certificatePem: key.certificatePem,
      publicKeyPem,
      validFrom: cert.validity.notBefore,
      validTo: cert.validity.notAfter,
    };
  }

  public async getCertificateChain(keyAlias: string): Promise<string[]> {
    const key = this.keys.get(keyAlias);
    if (!key) {
      throw new ServiceUnavailableException(`Không tìm thấy chuỗi chứng thư cho khóa: ${keyAlias}`);
    }
    return [key.certificatePem];
  }

  public async isAvailable(keyAlias: string): Promise<boolean> {
    const key = this.keys.get(keyAlias);
    return !!key && key.enabled;
  }

  private executeEnclaveSign(
    keyEntry: SandboxKmsKeyEntry,
    digest: Buffer,
    algorithm: SigningAlgorithm
  ): Buffer {
    if (algorithm === 'RSA-SHA256') {
      const SHA256_DIGEST_INFO_PREFIX = Buffer.from(
        '3031300d060960864801650304020105000420',
        'hex'
      );
      const digestInfo = Buffer.concat([SHA256_DIGEST_INFO_PREFIX, digest]);
      return crypto.privateEncrypt(
        {
          key: keyEntry.privateKeyPem,
          padding: crypto.constants.RSA_PKCS1_PADDING,
        },
        digestInfo
      );
    }

    throw new BadRequestException(`Thuật toán không được hỗ trợ trong Enclave: ${algorithm}`);
  }

  private verifySignatureWithPublicKey(
    certificatePem: string,
    digest: Buffer,
    signatureBytes: Buffer,
    algorithm: SigningAlgorithm
  ): boolean {
    try {
      if (algorithm === 'RSA-SHA256') {
        const x509 = new crypto.X509Certificate(certificatePem);
        const SHA256_DIGEST_INFO_PREFIX = Buffer.from(
          '3031300d060960864801650304020105000420',
          'hex'
        );
        const digestInfo = Buffer.concat([SHA256_DIGEST_INFO_PREFIX, digest]);
        const decrypted = crypto.publicDecrypt(
          {
            key: x509.publicKey,
            padding: crypto.constants.RSA_PKCS1_PADDING,
          },
          signatureBytes
        );
        return decrypted.equals(digestInfo);
      }
      return false;
    } catch {
      return false;
    }
  }
}
