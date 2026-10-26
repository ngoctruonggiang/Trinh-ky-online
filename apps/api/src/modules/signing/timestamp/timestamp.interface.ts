export const TIMESTAMP_AUTHORITY_PROVIDER = 'ITimestampAuthorityProvider';

export interface TimestampRequestOptions {
  /** Thuật toán băm (mặc định sha256) */
  hashAlgorithm?: 'sha256' | 'sha384' | 'sha512';
  /** OID chính sách TSA (tùy chọn) */
  reqPolicy?: string;
  /** Nonce ngẫu nhiên để chống tấn công phát lại (Replay Attack) */
  nonce?: string;
  /** Yêu cầu TSA gửi kèm chứng thư ký trong token (mặc định true) */
  certReq?: boolean;
  /** Thời gian chờ tối đa (ms) */
  timeoutMs?: number;
}

export interface TimestampTokenResult {
  /** Chuỗi ASN.1 DER của TimeStampToken (ContentInfo) */
  tokenDer: Buffer;
  /** Thời điểm cấp dấu thời gian (GeneralizedTime trong TSTInfo) */
  genTime: Date;
  /** Số serial của timestamp token */
  serialNumber: string;
  /** OID của chính sách TSA */
  policyOid: string;
  /** Subject DN của TSA */
  tsaSubjectDn: string;
  /** Issuer DN của TSA */
  tsaIssuerDn: string;
  /** Chuỗi PEM của chứng thư số TSA */
  tsaCertificatePem: string;
  /** Thuật toán băm messageImprint (VD: sha256) */
  hashAlgorithm: string;
  /** Giá trị băm messageImprint dạng hex */
  hashedMessageHex: string;
}

export interface TimestampVerificationResult {
  isValid: boolean;
  isDigestValid: boolean;
  isSignatureValid: boolean;
  isEkuValid: boolean;
  genTime?: Date;
  serialNumber?: string;
  policyOid?: string;
  tsaSubjectDn?: string;
  tsaIssuerDn?: string;
  tsaCertificatePem?: string;
  errorMessage?: string;
}

/**
 * Interface trừu tượng hóa nhà cung cấp Dấu thời gian tin cậy RFC 3161 TSA
 */
export interface ITimestampAuthorityProvider {
  /**
   * Lấy RFC 3161 TimeStampToken cho một message digest (32 byte SHA-256)
   * @param digest32Bytes Mã băm của dữ liệu cần timestamp (đối với chữ ký PDF, đây là SHA-256 của signatureValue)
   * @param options Tùy chọn yêu cầu (nonce, policy, timeout)
   */
  getTimestampToken(
    digest32Bytes: Buffer,
    options?: TimestampRequestOptions
  ): Promise<TimestampTokenResult>;

  /**
   * Kiểm tra tính sẵn sàng hoạt động của TSA
   */
  isAvailable(): Promise<boolean>;
}
