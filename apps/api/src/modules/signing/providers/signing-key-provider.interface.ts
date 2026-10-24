/**
 * Interface trừu tượng cho nhà cung cấp khóa ký mật mã (Signing Key Provider)
 * Tuân thủ ADR-03: Provider Adapter Pattern.
 * 
 * NGUYÊN TẮC AN TOÀN TUYỆT ĐỐI:
 * 1. KHÔNG BAO GIỜ xuất private key hoặc đối tượng chứa private key ra ngoài interface này.
 * 2. Mọi thao tác ký mật mã được thực thi bên trong ranh giới an toàn của Provider (Process RAM hoặc HSM/KMS).
 * 3. Ngữ nghĩa đầu vào (Input semantics) giữa dữ liệu thô và digest được phân định rõ ràng.
 */

export type SigningAlgorithm = 'RSA-SHA256' | 'ECDSA-SHA256';

export interface CertificateMetadata {
  subjectDn: string;
  issuerDn: string;
  serialNumber: string;
  fingerprintSha256: string;
  certificatePem: string;
  publicKeyPem: string;
  validFrom: Date;
  validTo: Date;
}

export interface SignDataOptions {
  algorithm?: SigningAlgorithm;
}

export interface SignDigestOptions {
  algorithm?: SigningAlgorithm;
  /**
   * Cho biết đầu vào là mã băm thô 32 bytes của SHA-256 (Mặc định: true).
   * Với RSA PKCS#1 v1.5, Provider sẽ đóng gói DigestInfo ASN.1 tương ứng trước khi mã hóa RSA.
   */
  isRawDigest?: boolean;
}

export interface SigningResult {
  signatureBytes: Buffer;
  algorithm: SigningAlgorithm;
  keyAlias: string;
  certificatePem: string;
  signedAt: Date;
}

export const SIGNING_KEY_PROVIDER = 'SIGNING_KEY_PROVIDER';

export interface ISigningKeyProvider {
  /**
   * Ký số mật mã trên luồng byte dữ liệu thô.
   * Ngữ nghĩa (Semantics):
   * - Đầu vào: `data` là Buffer dữ liệu thô bất kỳ (ví dụ: ASN.1 DER của SignedAttributes trong CMS).
   * - Xử lý: Provider băm `data` bằng thuật toán hash tương ứng (SHA-256) và ký bằng private key.
   * - Đầu ra: Buffer chứa chữ ký số nhị phân.
   */
  signData(
    keyAlias: string,
    data: Buffer,
    options?: SignDataOptions
  ): Promise<SigningResult>;

  /**
   * Ký số mật mã trên mã băm đã tính toán trước (Pre-computed Digest).
   * Ngữ nghĩa (Semantics):
   * - Đầu vào: `digest` BẮT BUỘC là Buffer 32 bytes (đối với SHA-256).
   * - Xử lý: Provider đóng gói ASN.1 DigestInfo (đối với RSA PKCS#1 v1.5) hoặc DER (đối với ECDSA) và thực hiện phép ký.
   * - Chống lỗi: Nếu `digest.length !== 32` với SHA-256, Provider lập tức từ chối và ném lỗi có cấu trúc.
   */
  signDigest(
    keyAlias: string,
    digest: Buffer,
    options?: SignDigestOptions
  ): Promise<SigningResult>;

  /**
   * Lấy chứng thư số công khai X.509 và siêu dữ liệu đã phân tích
   */
  getCertificate(keyAlias: string): Promise<CertificateMetadata>;

  /**
   * Lấy chuỗi chứng thư công khai X.509 (Leaf -> Intermediates -> Root)
   */
  getCertificateChain(keyAlias: string): Promise<string[]>;

  /**
   * Kiểm tra tính sẵn sàng và trạng thái hoạt động của khóa
   */
  isAvailable(keyAlias: string): Promise<boolean>;
}
